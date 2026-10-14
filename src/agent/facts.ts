import { and, eq, or } from "drizzle-orm";
import { db } from "@/db/client";
import { userFacts } from "@/db/schema";

/**
 * What the agent may remember, and how long each fact lasts. The model picks a key;
 * the code decides the scope, so "party of 6 tonight" never leaks into next week.
 */
export const FACT_KEYS = {
  name: { scope: "user", description: "What to call them" },
  diet: { scope: "user", description: "The texter's OWN dietary pattern, e.g. vegetarian, vegan, no restrictions" },
  allergies: { scope: "user", description: "The texter's OWN allergies or foods they must avoid" },
  kids: { scope: "user", description: "Whether they usually bring kids, and ages if known" },
  home_area: { scope: "user", description: "Where they live or usually eat" },
  usual_budget: { scope: "user", description: "What they usually like to spend" },
  likes: { scope: "user", description: "Cuisines, dishes, or vibes they enjoy" },
  dislikes: { scope: "user", description: "Cuisines, dishes, or vibes they avoid" },
  party_size: { scope: "conversation", description: "How many people for this outing" },
  party_needs: { scope: "conversation", description: "Diets, allergies, or needs of OTHER people coming this time" },
  timing: { scope: "conversation", description: "When this outing is, e.g. tonight 7pm" },
  area: { scope: "conversation", description: "Where they want to eat this time" },
  budget: { scope: "conversation", description: "Budget for this outing" },
  occasion: { scope: "conversation", description: "Date, birthday, quick lunch, etc." },
  mood: { scope: "conversation", description: "What they are in the mood for right now" },
} as const;

export type FactKey = keyof typeof FACT_KEYS;
export const FACT_KEY_NAMES = Object.keys(FACT_KEYS) as [FactKey, ...FactKey[]];
/** Facts are short labels ("vegetarian", "4 people"), never paragraphs; this also bounds what reaches the context. */
export const MAX_FACT_VALUE_LENGTH = 100;

export interface ActiveFact {
  key: string;
  value: string;
  scope: "user" | "conversation";
}

export interface FactChange {
  action: "added" | "superseded" | "unchanged";
  key: FactKey;
  value: string;
  previousValue: string | null;
  scope: "user" | "conversation";
}

/**
 * Facts in effect for this conversation: durable user facts plus this conversation's situational
 * ones. With no conversation yet (a returning user's empty chat), only the durable facts apply.
 */
export async function loadActiveFacts(userId: string, conversationId: string | null): Promise<ActiveFact[]> {
  const inScope = conversationId
    ? or(eq(userFacts.scope, "user"), eq(userFacts.conversationId, conversationId))
    : eq(userFacts.scope, "user");
  return db
    .select({ key: userFacts.key, value: userFacts.value, scope: userFacts.scope })
    .from(userFacts)
    .where(and(eq(userFacts.userId, userId), eq(userFacts.status, "active"), inScope))
    .orderBy(userFacts.createdAt);
}

/**
 * Records a fact. If there is already a different active value for the key in the same scope
 * (the user's durable facts, or this conversation's situational ones), the old row is marked
 * superseded and the new row points back at it, in one transaction. The partial unique indexes
 * make a concurrent double-write fail instead of silently leaving two current values.
 */
export async function rememberFact(input: {
  userId: string;
  conversationId: string;
  sourceMessageId: string;
  key: FactKey;
  value: string;
}): Promise<FactChange> {
  const { userId, conversationId, sourceMessageId, key } = input;
  const value = input.value.trim();
  const scope = FACT_KEYS[key].scope;

  // Situational facts belong to one conversation; "party of 4" here must not touch another chat's value.
  const sameScope =
    scope === "conversation"
      ? and(eq(userFacts.scope, "conversation"), eq(userFacts.conversationId, conversationId))
      : eq(userFacts.scope, "user");
  const [current] = await db
    .select({ id: userFacts.id, value: userFacts.value })
    .from(userFacts)
    .where(and(eq(userFacts.userId, userId), eq(userFacts.key, key), eq(userFacts.status, "active"), sameScope));

  if (current && current.value.toLowerCase() === value.toLowerCase()) {
    return { action: "unchanged", key, value, previousValue: current.value, scope };
  }

  const newFact = { userId, conversationId, sourceMessageId, key, value, scope, supersedes: current?.id ?? null };
  if (!current) {
    await db.insert(userFacts).values(newFact);
    return { action: "added", key, value, previousValue: null, scope };
  }

  await db.batch([
    db.update(userFacts).set({ status: "superseded" }).where(eq(userFacts.id, current.id)),
    db.insert(userFacts).values(newFact),
  ]);
  return { action: "superseded", key, value, previousValue: current.value, scope };
}
