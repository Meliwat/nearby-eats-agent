import { readFileSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { messages, recommendations, restaurants } from "@/db/schema";
import type { ActiveFact } from "./facts";
import { TIME_ZONE } from "./tools";

/** Read once per server instance. next.config.ts includes prompts/ in the deployed function. */
export const SYSTEM_PROMPT = readFileSync(path.join(process.cwd(), "prompts/system-prompt.md"), "utf8");

/** The visible transcript so far, oldest first, as API messages. */
export async function loadTranscript(conversationId: string): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
  return rows.map((row) => ({ role: row.role, content: row.content }));
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
