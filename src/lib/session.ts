import { and, desc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/db/client";
import { conversations, messages, users } from "@/db/schema";

const USER_COOKIE = "nearby_uid";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** The visitor's user id from the cookie, or null if they have none (or it points at no user). Never writes. */
export async function getUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const existing = z.uuid().safeParse(cookieStore.get(USER_COOKIE)?.value);
  if (!existing.success) return null;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, existing.data));
  return user?.id ?? null;
}

/**
 * Anonymous identity: a random user id in an httpOnly cookie. Only actions (chatting, voting)
 * create a user, and those routes are rate-limited by IP first, so page views can't fill the table.
 */
export async function getOrCreateUserId(): Promise<string> {
  const existing = await getUserId();
  if (existing) return existing;

  const cookieStore = await cookies();
  const [user] = await db.insert(users).values({}).returning({ id: users.id });
  cookieStore.set(USER_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
  });
  return user.id;
}

/** True only if the conversation exists and belongs to this user, so ids can't be used to read others' chats. */
export async function ownsConversation(userId: string, conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
  return Boolean(row);
}

/** Longer than any turn can run (the chat route's maxDuration is 60s). */
const TURN_IN_PROGRESS_MS = 70_000;

/**
 * True while the conversation's latest message is a recent user message with no reply yet. Every
 * finished turn stores a reply (or a failure placeholder), so this means a turn is still running,
 * e.g. the same chat open in two tabs. Two requests in the same instant can both pass; that window
 * is small and the cost is one out-of-order turn.
 */
export async function hasTurnInProgress(conversationId: string, now = new Date()): Promise<boolean> {
  const [latest] = await db
    .select({ role: messages.role, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return latest?.role === "user" && now.getTime() - latest.createdAt.getTime() < TURN_IN_PROGRESS_MS;
}
