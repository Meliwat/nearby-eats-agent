import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against the real database: these are the access checks every conversation route relies on.
describe.skipIf(!process.env.DATABASE_URL)("conversation checks (database)", () => {
  let db: typeof import("@/db/client").db;
  let schema: typeof import("@/db/schema");
  let session: typeof import("./session");
  let owner: string;
  let stranger: string;
  let conversationId: string;

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    session = await import("./session");
    [{ id: owner }, { id: stranger }] = await db.insert(schema.users).values([{}, {}]).returning();
    [{ id: conversationId }] = await db.insert(schema.conversations).values({ userId: owner }).returning();
  });

  afterAll(async () => {
    for (const id of [owner, stranger].filter(Boolean)) await db.delete(schema.users).where(eq(schema.users.id, id));
  });

  it("lets only the owner reach a conversation", async () => {
    expect(await session.ownsConversation(owner, conversationId)).toBe(true);
    expect(await session.ownsConversation(stranger, conversationId)).toBe(false);
    expect(await session.ownsConversation(owner, crypto.randomUUID())).toBe(false);
  });

  it("reports a turn in progress only while the latest message is a recent, unanswered user message", async () => {
    expect(await session.hasTurnInProgress(conversationId)).toBe(false);
    await db.insert(schema.messages).values({ conversationId, role: "user", content: "tacos?" });
    expect(await session.hasTurnInProgress(conversationId)).toBe(true);
    expect(await session.hasTurnInProgress(conversationId, new Date(Date.now() + 5 * 60_000))).toBe(false);
    await db.insert(schema.messages).values({ conversationId, role: "assistant", content: "Casa Verde" });
    expect(await session.hasTurnInProgress(conversationId)).toBe(false);
  });
});
