import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { agentEvents, messages } from "@/db/schema";
import { agentEventSchema, type StoredAgentEvent } from "@/agent/events";
import { loadActiveFacts } from "@/agent/facts";
import { getOrCreateUserId, ownsConversation } from "@/lib/session";

export interface ConversationState {
  conversationId: string | null;
  messages: { id: string; role: "user" | "assistant"; content: string }[];
  /** Agent events grouped by the user message whose turn produced them. */
  eventsByTurn: Record<string, StoredAgentEvent[]>;
  facts: Awaited<ReturnType<typeof loadActiveFacts>>;
}

/**
 * Everything the page needs to render a conversation after a reload: transcript, the full
 * agent event log, and current facts. With no conversation id, returns a returning user's
 * durable facts so the inspector shows what Nearby already remembers.
 */
export async function GET(request: Request) {
  const userId = await getOrCreateUserId();
  const requested = new URL(request.url).searchParams.get("conversationId");
  const conversationId = requested && z.uuid().safeParse(requested).success ? requested : null;

  if (conversationId === null || !(await ownsConversation(userId, conversationId))) {
    const state: ConversationState = {
      conversationId: null,
      messages: [],
      eventsByTurn: {},
      facts: await loadActiveFacts(userId, null),
    };
    return Response.json(state);
  }

  const [messageRows, eventRows, facts] = await Promise.all([
    db
      .select({ id: messages.id, role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt)),
    db.select().from(agentEvents).where(eq(agentEvents.conversationId, conversationId)).orderBy(asc(agentEvents.id)),
    loadActiveFacts(userId, conversationId),
  ]);

  const eventsByTurn: Record<string, StoredAgentEvent[]> = {};
  for (const row of eventRows) {
    const event = agentEventSchema.parse({ type: row.type, payload: row.payload, durationMs: row.durationMs });
    (eventsByTurn[row.turnMessageId] ??= []).push({ ...event, id: row.id, createdAt: row.createdAt.toISOString() });
  }

  const state: ConversationState = { conversationId, messages: messageRows, eventsByTurn, facts };
  return Response.json(state);
}
