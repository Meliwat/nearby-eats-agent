import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against the real database: the carry-over reads a search's applied constraints back out of jsonb.
describe.skipIf(!process.env.DATABASE_URL)("loadCarriedConstraints (database)", () => {
  let db: typeof import("@/db/client").db;
  let schema: typeof import("@/db/schema");
  let context: typeof import("./context");
  let userId: string;
  let conversationId: string;
  let turnMessageId: string;

  const searchEvent = (output: unknown, isError = false) => ({
    conversationId,
    turnMessageId,
    type: "tool_call" as const,
    durationMs: 1,
    payload: { toolUseId: "t", name: "search_restaurants", input: {}, output, isError },
  });

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    context = await import("./context");
    [{ id: userId }] = await db.insert(schema.users).values({}).returning();
    [{ id: conversationId }] = await db.insert(schema.conversations).values({ userId }).returning();
    [{ id: turnMessageId }] = await db
      .insert(schema.messages)
      .values({ conversationId, role: "user", content: "dinner, I'm vegetarian" })
      .returning();
  });

  afterAll(async () => {
    if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("starts a conversation with no constraints", async () => {
    expect(await context.loadCarriedConstraints(conversationId)).toEqual({
      diets: [],
      with_kids: false,
      party_size: null,
      max_price_tier: null,
      avoid_cash_only: false,
    });
  });

  it("carries the latest successful search's applied constraints, ignoring later failed ones", async () => {
    const applied = { diets: ["vegetarian"], with_kids: true, party_size: 4, max_price_tier: 2, avoid_cash_only: false };
    await db.insert(schema.agentEvents).values(searchEvent({ arrival: "Wed 7pm", applied_constraints: applied }));
    await db.insert(schema.agentEvents).values(searchEvent({ error: "Invalid input" }, true));
    expect(await context.loadCarriedConstraints(conversationId)).toEqual(applied);
  });
});
