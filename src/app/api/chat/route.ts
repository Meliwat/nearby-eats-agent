import { z } from "zod";
import { db } from "@/db/client";
import { conversations } from "@/db/schema";
import type { StreamMessage } from "@/agent/events";
import { runTurn } from "@/agent/loop";
import { clientIp, LIMITS, noNulBytes, rejectCrossSite, rejectLargeBody, tooManyRequests } from "@/lib/rate-limit";
import { consumeLimits, deleteExpiredCounters } from "@/lib/rate-limit-store";
import { getOrCreateUserId, hasTurnInProgress, ownsConversation } from "@/lib/session";

/** A turn is a handful of model calls; leave headroom over the usual few seconds. */
export const maxDuration = 60;

const chatRequest = z.strictObject({
  conversationId: z.uuid().nullable(),
  message: z.string().trim().min(1).max(2000).refine(noNulBytes, "Message contains invalid characters"),
});

/** Runs one turn and streams it back as NDJSON: one StreamMessage per line. */
export async function POST(request: Request) {
  const crossSite = rejectCrossSite(request) ?? rejectLargeBody(request);
  if (crossSite) return crossSite;
  const body = chatRequest.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: z.prettifyError(body.error) }, { status: 400 });

  // Narrowest limit first, and each stage only runs if the previous one passed, so a single IP or
  // user over its limit never uses up the global budget everyone shares. The IP check also comes
  // before user creation, so a flood of cookieless requests can't fill the users table.
  const perIp = await consumeLimits([{ limit: LIMITS.chatPerIp, key: clientIp(request) }]);
  if (!perIp.allowed) return tooManyRequests(perIp, "Lots of messages from your network. Try again in a bit.");

  const userId = await getOrCreateUserId();
  const perUser = await consumeLimits([{ limit: LIMITS.chatPerUser, key: userId }]);
  if (!perUser.allowed) return tooManyRequests(perUser, "You're texting faster than I can find tables. Give it a minute.");

  // Reject requests for someone else's conversation, or while a turn is still running, before they
  // count against the daily budget everyone shares.
  let conversationId = body.data.conversationId;
  if (conversationId !== null) {
    if (!(await ownsConversation(userId, conversationId))) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }
    if (await hasTurnInProgress(conversationId)) {
      return Response.json({ error: "Still working on your last message. One moment." }, { status: 409 });
    }
  }

  const global = await consumeLimits([
    { limit: LIMITS.chatGlobal, key: "all" },
    { limit: LIMITS.tokensGlobal, key: "all", amount: 0 },
  ]);
  if (!global.allowed) return tooManyRequests(global, "Nearby is at capacity for today. Try again tomorrow.");
  // The first chat of a new day is a cheap, predictable moment to clear out old counters.
  if (global.counts[0] === 1) await deleteExpiredCounters();

  conversationId ??= (await db.insert(conversations).values({ userId }).returning({ id: conversations.id }))[0].id;

  const encoder = new TextEncoder();
  const turn = { userId, conversationId, text: body.data.message };
  // If the browser goes away mid-turn (tab closed, phone locked), the turn keeps running and saves
  // its reply; only the sending stops. The user sees the reply when they come back.
  let clientGone = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let tokensUsed = 0;
      const emit = (message: StreamMessage) => {
        if (message.kind === "event" && message.event.type === "model_call") {
          // Cache reads are billed at a fraction of normal input, so the budget counts what costs real money.
          const { inputTokens, cacheWriteTokens, outputTokens } = message.event.payload;
          tokensUsed += inputTokens + cacheWriteTokens + outputTokens;
        }
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
        } catch {
          clientGone = true;
        }
      };
      try {
        await runTurn(turn, emit);
      } catch (error) {
        // runTurn already logged the error to agent_events and told the user; this is for server logs.
        console.error("chat turn failed", { conversationId: turn.conversationId, error });
      } finally {
        await consumeLimits([{ limit: LIMITS.tokensGlobal, key: "all", amount: tokensUsed }]).catch((error) =>
          console.error("failed to record token usage", error),
        );
        if (!clientGone) controller.close();
      }
    },
    cancel() {
      clientGone = true;
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
