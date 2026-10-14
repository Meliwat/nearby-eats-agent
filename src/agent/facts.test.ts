import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against the real database (the partial unique index is part of what's tested).
// Each run creates a throwaway user and deletes it afterward; deletes cascade to everything else.
describe.skipIf(!process.env.DATABASE_URL)("rememberFact (database)", () => {
  let db: typeof import("@/db/client").db;
  let schema: typeof import("@/db/schema");
  let facts: typeof import("./facts");
  let userId: string;
  let conversationId: string;
  let messageId: string;

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    facts = await import("./facts");
    [{ id: userId }] = await db.insert(schema.users).values({}).returning();
    [{ id: conversationId }] = await db.insert(schema.conversations).values({ userId }).returning();
    [{ id: messageId }] = await db
      .insert(schema.messages)
      .values({ conversationId, role: "user", content: "test" })
      .returning();
  });

  afterAll(async () => {
    if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  const remember = (key: "diet" | "party_size", value: string) =>
    facts.rememberFact({ userId, conversationId, sourceMessageId: messageId, key, value });

  it("adds, then supersedes on a change of mind, keeping history", async () => {
    expect(await remember("diet", "vegetarian")).toMatchObject({ action: "added", previousValue: null });
    expect(await remember("diet", "vegan")).toMatchObject({ action: "superseded", previousValue: "vegetarian" });

    const rows = await db.select().from(schema.userFacts).where(eq(schema.userFacts.key, "diet"));
    const mine = rows.filter((row) => row.userId === userId);
    const old = mine.find((row) => row.value === "vegetarian")!;
    const current = mine.find((row) => row.value === "vegan")!;
    expect(old.status).toBe("superseded");
    expect(current).toMatchObject({ status: "active", supersedes: old.id, sourceMessageId: messageId });
  });

  it("writes nothing when the value is the same (ignoring case)", async () => {
    expect(await remember("diet", "Vegan")).toMatchObject({ action: "unchanged" });
    const active = await db
      .select()
      .from(schema.userFacts)
      .where(and(eq(schema.userFacts.userId, userId), eq(schema.userFacts.key, "diet")));
    expect(active).toHaveLength(2);
  });

  it("lets the database reject a second active value for the same key", async () => {
    const duplicate = db.insert(schema.userFacts).values({
      userId,
      conversationId,
      sourceMessageId: messageId,
      key: "diet",
      value: "pescatarian",
      scope: "user",
    });
    await expect(duplicate).rejects.toThrow();
  });

  it("keeps conversation-scoped facts out of other conversations", async () => {
    await remember("party_size", "6 people");
    const [{ id: nextConversation }] = await db.insert(schema.conversations).values({ userId }).returning();

    const here = await facts.loadActiveFacts(userId, conversationId);
    const there = await facts.loadActiveFacts(userId, nextConversation);
    expect(here.map((f) => f.key).sort()).toEqual(["diet", "party_size"]);
    expect(there.map((f) => f.key)).toEqual(["diet"]);
  });
});
