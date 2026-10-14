import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/db/client";
import { conversations, users } from "@/db/schema";

const USER_COOKIE = "nearby_uid";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Anonymous identity: a random user id in an httpOnly cookie. Creates the user on first visit,
 * or again if the cookie points at a user that no longer exists.
 */
export async function getOrCreateUserId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = z.uuid().safeParse(cookieStore.get(USER_COOKIE)?.value);
  if (existing.success) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, existing.data));
    if (user) return user.id;
  }

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
