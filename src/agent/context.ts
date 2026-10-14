import { readFileSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { agentEvents, messages, recommendations, restaurants } from "@/db/schema";
import type { ActiveFact } from "./facts";
import { buildActionNote, type ToolCallPayload } from "./tool-summary";
import { RESTAURANT_TIME_ZONE as TIME_ZONE } from "@/lib/restaurants/hours";

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
  const recent = rows.reverse().filter((row) => row.content.trim());
  const firstUser = recent.findIndex((row) => row.role === "user");
  const transcript = recent.slice(Math.max(firstUser, 0));

  const userIds = transcript.filter((row) => row.role === "user").map((row) => row.id);
  const toolCalls = userIds.length
    ? await db
        .select({ turnMessageId: agentEvents.turnMessageId, payload: agentEvents.payload })
        .from(agentEvents)
        .where(and(inArray(agentEvents.turnMessageId, userIds), eq(agentEvents.type, "tool_call")))
        .orderBy(asc(agentEvents.id))
    : [];

  return transcript.flatMap((row, index): Anthropic.Beta.BetaMessageParam[] => {
    const previous = transcript[index - 1];
    if (row.role === "assistant" && previous?.role === "user") {
      const calls = toolCalls.filter((c) => c.turnMessageId === previous.id).map((c) => c.payload as ToolCallPayload);
      const note = buildActionNote(calls);
      // A mid-conversation system note must sit between a user message and an assistant reply, as here.
      if (note) return [{ role: "system", content: note }, { role: "assistant", content: row.content }];
    }
    return [{ role: row.role, content: row.content }];
  });
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
    timeZone: TIME_ZONE,
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
