import { readFileSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { agentEvents, messages, recommendations, restaurants } from "@/db/schema";
import { appliedConstraintsSchema, NO_CONSTRAINTS, type AppliedConstraints } from "./constraints";
import type { ActiveFact } from "./facts";
import type { ToolCallPayload } from "./tool-summary";
import { trimTranscript, withActionNotes } from "./transcript";
import { RESTAURANT_TIME_ZONE } from "@/lib/restaurants/hours";

/** Read once per server instance. next.config.ts includes prompts/ in the deployed function. */
export const SYSTEM_PROMPT = readFileSync(path.join(process.cwd(), "prompts/system-prompt.md"), "utf8");

/** How much of the chat the model re-reads each turn; older context lives on in remembered facts. */
export const MAX_TRANSCRIPT_MESSAGES = 30;

/**
 * The most recent conversation, oldest first, as API messages: starts with a user message and
 * skips empty rows. Before each past reply goes a short system note of what the agent did in that
 * turn, built from agent_events, so the model remembers its own actions (not just its words).
 */
export async function loadTranscript(conversationId: string): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const rows = await db
    .select({ id: messages.id, role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(MAX_TRANSCRIPT_MESSAGES);
  const transcript = trimTranscript(rows);

  const userIds = transcript.filter((row) => row.role === "user").map((row) => row.id);
  const toolCalls = userIds.length
    ? await db
        .select({ turnMessageId: agentEvents.turnMessageId, payload: agentEvents.payload })
        .from(agentEvents)
        .where(
          and(
            eq(agentEvents.conversationId, conversationId),
            inArray(agentEvents.turnMessageId, userIds),
            eq(agentEvents.type, "tool_call"),
          ),
        )
        .orderBy(asc(agentEvents.id))
    : [];

  return withActionNotes(
    transcript,
    toolCalls.map((call) => ({ turnMessageId: call.turnMessageId, payload: call.payload as ToolCallPayload })),
  );
}

export interface RecommendationSummary {
  restaurantId: number;
  name: string;
  status: "suggested" | "accepted" | "rejected";
}

export async function loadRecommendations(conversationId: string): Promise<RecommendationSummary[]> {
  return db
    .select({ restaurantId: recommendations.restaurantId, name: restaurants.name, status: recommendations.status })
    .from(recommendations)
    .innerJoin(restaurants, eq(restaurants.id, recommendations.restaurantId))
    .where(eq(recommendations.conversationId, conversationId))
    .orderBy(asc(recommendations.createdAt));
}

/**
 * The per-turn state message, sent as a mid-conversation system message right after the
 * user's newest message. Keeping volatile state here (not in SYSTEM_PROMPT) keeps the
 * system prompt byte-identical across turns, so it stays cached.
 */
export function buildContextMessage(
  now: Date,
  facts: ActiveFact[],
  recs: RecommendationSummary[],
  polls: string[],
): string {
  const localTime = now.toLocaleString("en-US", {
    timeZone: RESTAURANT_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const factLines = facts.length
    ? facts.map((f) => `- ${f.key}: ${f.value}${f.scope === "conversation" ? " (this outing)" : ""}`)
    : ["- nothing yet"];
  const recLines = recs.length ? recs.map((r) => `- ${r.name} (id ${r.restaurantId}): ${r.status}`) : ["- none yet"];

  return [
    "Current context",
    `Local time in Orange County: ${localTime}`,
    "Known facts about this person:",
    ...factLines,
    "Recommendations so far in this conversation:",
    ...recLines,
    "Group polls in this conversation (votes per option):",
    ...(polls.length ? polls.map((p) => `- ${p}`) : ["- none"]),
  ].join("\n");
}

/** The hard constraints the conversation's most recent successful search applied, to carry into this turn. */
export async function loadCarriedConstraints(conversationId: string): Promise<AppliedConstraints> {
  const [latest] = await db
    .select({ payload: agentEvents.payload })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.conversationId, conversationId),
        eq(agentEvents.type, "tool_call"),
        sql`${agentEvents.payload}->>'name' = 'search_restaurants'`,
        sql`${agentEvents.payload}->>'isError' = 'false'`,
      ),
    )
    .orderBy(desc(agentEvents.id))
    .limit(1);
  const payload = latest?.payload as { input?: unknown; output?: { applied_constraints?: unknown } } | undefined;
  // Searches logged before applied_constraints existed carry what the model asked for instead.
  const parsed = appliedConstraintsSchema.safeParse(payload?.output?.applied_constraints ?? payload?.input);
  return parsed.success ? parsed.data : NO_CONSTRAINTS;
}
