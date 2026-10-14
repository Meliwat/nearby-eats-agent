import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db/client";
import { inArray } from "drizzle-orm";
import { agentEvents, groupPolls, messages, recommendations } from "@/db/schema";
import { loadCatalog } from "@/lib/restaurants/load-catalog";
import { buildContextMessage, loadCarriedConstraints, loadRecommendations, loadTranscript, SYSTEM_PROMPT } from "./context";
import { agentEventSchema, type AgentEvent, type StreamMessage } from "./events";
import { loadActiveFacts } from "./facts";
import { conversationReadPollResults, summarizePolls } from "./polls";
import { buildTools, executeTool, type ToolContext, type ToolSchemas } from "./tools";

export const MODEL = "claude-sonnet-5-5";
/** Chat replies need speed more than deep reasoning; hard constraints are enforced in code. */
export const EFFORT = "low";
/** Upper bound on model calls per user message, so a confused loop can't run up cost. */
export const MAX_STEPS = 8;
/** Thinking and the reply share this budget; a texting-length reply plus low-effort thinking fits easily. */
const MAX_TOKENS = 4_000;
/** The chat route's maxDuration is 60s; past this, the model is asked to wrap up without more tools. */
export const TURN_BUDGET_MS = 40_000;
/**
 * A model call still running at this point is aborted, so the turn fails through the normal error
 * path (logged, placeholder reply saved) instead of being killed by the platform at 60s with nothing saved.
 */
const TURN_HARD_LIMIT_MS = 52_000;

const FALLBACK_REPLY = "Sorry, I lost my train of thought there. What are you in the mood for?";
const FAILURE_REPLY = "Sorry, something went wrong on my end. Try that again?";
const REFUSAL_REPLY = "Sorry, I can't help with that one. Want a restaurant pick instead?";

const client = new Anthropic();

export interface TurnInput {
  userId: string;
  conversationId: string;
  text: string;
}

/**
 * Runs one user turn: store the message, rebuild context from the database, then loop
 * model call -> tool calls -> model call until the model answers without tools.
 * Every model call, tool call, and fact change is stored in agent_events and streamed via `emit`.
 */
export async function runTurn(input: TurnInput, emit: (message: StreamMessage) => void): Promise<void> {
  const { userId, conversationId } = input;
  const [userMessage] = await db
    .insert(messages)
    .values({ conversationId, role: "user", content: input.text })
    .returning({ id: messages.id });
  emit({ kind: "turn_started", conversationId, userMessageId: userMessage.id });

  const record = async (event: AgentEvent) => {
    const valid = agentEventSchema.parse(event);
    const [stored] = await db
      .insert(agentEvents)
      .values({ conversationId, turnMessageId: userMessage.id, ...valid })
      .returning({ id: agentEvents.id, createdAt: agentEvents.createdAt });
    emit({ kind: "event", event: { ...valid, id: stored.id, createdAt: stored.createdAt.toISOString() } });
  };

  const turnStarted = Date.now();
  let replyStored = false;
  const madeThisTurn = { recommendationIds: [] as string[], pollIds: [] as string[] };
  try {
    const now = new Date();
    const [catalog, transcript, facts, recs, polls, readPollNotesEarlier, carriedConstraints] = await Promise.all([
      loadCatalog(),
      loadTranscript(conversationId),
      loadActiveFacts(userId, conversationId),
      loadRecommendations(conversationId),
      summarizePolls(conversationId),
      conversationReadPollResults(conversationId),
      loadCarriedConstraints(conversationId),
    ]);
    const { definitions, schemas } = buildTools(catalog);
    const ctx: ToolContext = {
      userId,
      conversationId,
      turnMessageId: userMessage.id,
      now,
      catalog,
      rejectedIds: new Set(recs.filter((r) => r.status === "rejected").map((r) => r.restaurantId)),
      readThirdPartyText: false,
      madeThisTurn,
      conversationReadThirdPartyText: readPollNotesEarlier,
      constraints: carriedConstraints,
      lastSearch: null,
    };

    // Append-only within the turn: the model's own content blocks go back exactly as received.
    const conversation: Anthropic.Beta.BetaMessageParam[] = [
      ...transcript,
      { role: "system", content: buildContextMessage(now, facts, recs, polls) },
    ];

    let reply = "";
    for (let step = 1; step <= MAX_STEPS; step++) {
      // On the last allowed step, or once the turn runs long, the model must answer in words.
      // That way it reports what its tools already did instead of ending mid-task.
      const mustAnswer = step === MAX_STEPS || Date.now() - turnStarted > TURN_BUDGET_MS;
      if (mustAnswer && step > 1) {
        await record({
          type: "error",
          durationMs: null,
          payload: { stage: "loop", message: `Wrapping up at step ${step}: asked for a final answer without tools` },
        });
      }
      const started = Date.now();
      const timeLeftMs = Math.max(turnStarted + TURN_HARD_LIMIT_MS - Date.now(), 1_000);
      const message = await callModel(conversation, definitions, mustAnswer, timeLeftMs);

      await record({
        type: "model_call",
        durationMs: Date.now() - started,
        payload: {
          model: message.model,
          stopReason: message.stop_reason,
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        },
      });

      if (message.stop_reason === "refusal") {
        reply = REFUSAL_REPLY;
        await discardTurnPicks(madeThisTurn);
        break;
      }

      // Only the step that ends the turn speaks to the user. Text written alongside tool calls (say,
      // "Try Hearth & Hen!" next to a recommend call that then gets refused) is never shown or saved,
      // so the reply is always written after every check has passed.
      const toolUses = message.content.filter((block) => block.type === "tool_use");
      if (toolUses.length === 0) {
        reply = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
        break;
      }
      if (message.stop_reason === "max_tokens") throw new Error("Tool input was cut off by max_tokens");

      conversation.push({ role: "assistant", content: message.content });
      // All results for one assistant message go back in a single user message.
      conversation.push({ role: "user", content: await runToolCalls(toolUses, schemas, ctx, record, emit) });
    }

    // An empty assistant message would make every later request in this conversation fail.
    if (!reply.trim()) {
      await record({ type: "error", durationMs: null, payload: { stage: "fallback", message: "Model returned no text; sent a stock reply" } });
      reply = FALLBACK_REPLY;
      await discardTurnPicks(madeThisTurn);
    }

    const [assistantMessage] = await db
      .insert(messages)
      .values({ conversationId, role: "assistant", content: reply })
      .returning({ id: messages.id });
    replyStored = true;
    // The reply is saved; failing to refresh the facts panel must not turn that into an error.
    const factsAfterTurn = await loadActiveFacts(userId, conversationId).catch(() => null);
    if (factsAfterTurn) emit({ kind: "context", facts: factsAfterTurn });
    emit({ kind: "done", assistantMessageId: assistantMessage.id, text: reply });
  } catch (error) {
    // Full details go to server logs only; the stored event (which the inspector shows) says what kind of failure it was.
    await record({ type: "error", durationMs: null, payload: { stage: "turn", message: describeError(error) } }).catch(() => {
      // The database itself may be what failed; the stream error below still reaches the user.
    });
    await discardTurnPicks(madeThisTurn).catch(() => {});
    // Keep the transcript alternating user/assistant, so the next turn isn't answering two messages at once.
    if (!replyStored) {
      await db
        .insert(messages)
        .values({ conversationId, role: "assistant", content: FAILURE_REPLY })
        .catch(() => {});
    }
    emit({ kind: "error", message: FAILURE_REPLY });
    throw error;
  }
}

/**
 * Picks and polls from a turn that ended in a refusal, a stock reply, or a failure were never shown
 * (their cards are hidden), so they're removed instead of counting as suggestions next turn.
 */
async function discardTurnPicks(made: { recommendationIds: string[]; pollIds: string[] }): Promise<void> {
  await Promise.all([
    made.recommendationIds.length > 0 && db.delete(recommendations).where(inArray(recommendations.id, made.recommendationIds)),
    made.pollIds.length > 0 && db.delete(groupPolls).where(inArray(groupPolls.id, made.pollIds)),
  ]);
}

/** One streamed model call. With `mustAnswer`, tools are withheld so the model has to reply in words. */
function callModel(
  conversation: Anthropic.Beta.BetaMessageParam[],
  tools: Anthropic.Beta.BetaTool[],
  mustAnswer: boolean,
  timeLeftMs: number,
) {
  const stream = client.beta.messages.stream(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Adaptive is this model's default; stated explicitly so the request shows what runs.
      thinking: { type: "adaptive" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      // Also cache the growing conversation, so each step in a turn re-reads earlier steps from cache.
      cache_control: { type: "ephemeral" },
      tools,
      tool_choice: mustAnswer ? { type: "none" } : { type: "auto" },
      messages: conversation,
      output_config: { effort: EFFORT },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    },
    { signal: AbortSignal.timeout(timeLeftMs) },
  );
  return stream.finalMessage();
}

/**
 * Runs one assistant message's tool calls in order (a later call may depend on an earlier one,
 * e.g. search then recommend), logging each call and any fact changes it made.
 */
async function runToolCalls(
  toolUses: Anthropic.Beta.BetaToolUseBlock[],
  schemas: ToolSchemas,
  ctx: ToolContext,
  record: (event: AgentEvent) => Promise<void>,
  emit: (message: StreamMessage) => void,
): Promise<Anthropic.Beta.BetaToolResultBlockParam[]> {
  const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
  for (const toolUse of toolUses) {
    emit({ kind: "tool_started", name: toolUse.name });
    const started = Date.now();
    const outcome = await executeTool(toolUse.name, toolUse.input, schemas, ctx);
    await record({
      type: "tool_call",
      durationMs: Date.now() - started,
      payload: { toolUseId: toolUse.id, name: toolUse.name, input: toolUse.input, output: outcome.output, isError: outcome.isError },
    });
    for (const change of outcome.factChanges) await record({ type: "fact_change", durationMs: null, payload: change });
    results.push({
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: JSON.stringify(outcome.output),
      is_error: outcome.isError,
    });
  }
  return results;
}

/** A short, safe description of a failure: the kind of error, never raw messages that might include SQL or internals. */
function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIUserAbortError) return "Turn ran out of time (model call aborted)";
  if (error instanceof Anthropic.APIError) return `Claude API error${error.status ? ` (HTTP ${error.status})` : ""}`;
  if (error instanceof Error) return `${error.name} (details in server logs)`;
  return "Unknown error (details in server logs)";
}
