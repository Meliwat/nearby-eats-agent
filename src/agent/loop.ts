import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db/client";
import { agentEvents, messages } from "@/db/schema";
import { loadCatalog } from "@/lib/restaurants/load-catalog";
import { buildContextMessage, loadRecommendations, loadTranscript, SYSTEM_PROMPT } from "./context";
import { agentEventSchema, type AgentEvent, type StreamMessage } from "./events";
import { loadActiveFacts } from "./facts";
import { buildTools, executeTool, type ToolContext } from "./tools";

export const MODEL = "claude-sonnet-5-5";
/** Chat replies need speed more than deep reasoning; hard constraints are enforced in code. */
const EFFORT = "low";
/** Upper bound on model calls per user message, so a confused loop can't run up cost. */
const MAX_STEPS = 8;
const MAX_TOKENS = 16_000;

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

  try {
    const now = new Date();
    const [catalog, transcript, facts, recs] = await Promise.all([
      loadCatalog(),
      loadTranscript(conversationId),
      loadActiveFacts(userId, conversationId),
      loadRecommendations(conversationId),
    ]);
    const { definitions, schemas } = buildTools(catalog);
    const ctx: ToolContext = {
      userId,
      conversationId,
      turnMessageId: userMessage.id,
      now,
      catalog,
      rejectedIds: new Set(recs.filter((r) => r.status === "rejected").map((r) => r.restaurantId)),
      lastSearch: null,
    };

    // Append-only within the turn: the model's own content blocks go back exactly as received.
    const conversation: Anthropic.Beta.BetaMessageParam[] = [
      ...transcript,
      { role: "system", content: buildContextMessage(now, facts, recs) },
    ];

    let reply = "";
    for (let step = 1; step <= MAX_STEPS; step++) {
      const started = Date.now();
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: definitions,
        messages: conversation,
        output_config: { effort: EFFORT },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      stream.on("text", (delta) => emit({ kind: "text", delta }));
      const message = await stream.finalMessage();

      await record({
        type: "model_call",
        durationMs: Date.now() - started,
        payload: {
          model: message.model,
          stopReason: message.stop_reason,
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        },
      });

      if (message.stop_reason === "refusal") {
        reply = "Sorry, I can't help with that one. Want a restaurant pick instead?";
        break;
      }

      reply += message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      const toolUses = message.content.filter((block) => block.type === "tool_use");
      if (toolUses.length === 0) break;
      if (message.stop_reason === "max_tokens") throw new Error("Tool input was cut off by max_tokens");

      conversation.push({ role: "assistant", content: message.content });
      const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const toolStarted = Date.now();
        const outcome = await executeTool(toolUse.name, toolUse.input, schemas, ctx);
        await record({
          type: "tool_call",
          durationMs: Date.now() - toolStarted,
          payload: { toolUseId: toolUse.id, name: toolUse.name, input: toolUse.input, output: outcome.output, isError: outcome.isError },
        });
        for (const change of outcome.factChanges) await record({ type: "fact_change", durationMs: null, payload: change });
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(outcome.output),
          is_error: outcome.isError,
        });
      }
      // All results for one assistant message go back in a single user message.
      conversation.push({ role: "user", content: toolResults });

      if (step === MAX_STEPS) {
        await record({ type: "error", durationMs: null, payload: { stage: "loop", message: `Stopped after ${MAX_STEPS} steps` } });
        reply ||= "Sorry, I got tangled up there. Can you tell me again what you're looking for?";
      }
    }

    const [assistantMessage] = await db
      .insert(messages)
      .values({ conversationId, role: "assistant", content: reply })
      .returning({ id: messages.id });
    emit({ kind: "context", facts: await loadActiveFacts(userId, conversationId) });
    emit({ kind: "done", assistantMessageId: assistantMessage.id, text: reply });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await record({ type: "error", durationMs: null, payload: { stage: "turn", message } }).catch(() => {
      // The database itself may be what failed; the stream error below still reaches the user.
    });
    emit({ kind: "error", message: "Something went wrong on my end. Try that again?" });
    throw error;
  }
}
