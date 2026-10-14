import { z } from "zod";
import { db } from "@/db/client";
import { conversations } from "@/db/schema";
import type { StreamMessage } from "@/agent/events";
import { runTurn } from "@/agent/loop";
import { clientIp, consumeLimits, LIMITS, tooManyRequests } from "@/lib/rate-limit";
import { getOrCreateUserId, ownsConversation } from "@/lib/session";

/** A turn is a handful of model calls; leave headroom over the usual few seconds. */
export const maxDuration = 60;

const chatRequest = z.strictObject({
  conversationId: z.uuid().nullable(),
  message: z.string().trim().min(1).max(2000),
});

/** Runs one turn and streams it back as NDJSON: one StreamMessage per line. */
export async function POST(request: Request) {
  const body = chatRequest.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: z.prettifyError(body.error) }, { status: 400 });

  // IP and global limits come first, so a flood of cookieless requests can't even create users.
  const ip = clientIp(request);
  const shared = await consumeLimits([
    { limit: LIMITS.chatPerIp, key: ip },
    { limit: LIMITS.chatGlobal, key: "all" },
  ]);
  if (!shared.allowed) return tooManyRequests(shared, "Nearby is getting a lot of messages right now. Try again in a bit.");

  const userId = await getOrCreateUserId();
  const personal = await consumeLimits([{ limit: LIMITS.chatPerUser, key: userId }]);
  if (!personal.allowed) return tooManyRequests(personal, "You're texting faster than I can find tables. Give it a minute.");

  let conversationId = body.data.conversationId;
  if (conversationId === null) {
    [{ id: conversationId }] = await db.insert(conversations).values({ userId }).returning({ id: conversations.id });
  } else if (!(await ownsConversation(userId, conversationId))) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const turn = { userId, conversationId, text: body.data.message };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (message: StreamMessage) => controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
      try {
        await runTurn(turn, emit);
      } catch (error) {
        // runTurn already logged the error to agent_events and told the user; this is for server logs.
        console.error("chat turn failed", { conversationId: turn.conversationId, error });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
