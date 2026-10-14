import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { rateLimitCounters } from "@/db/schema";

export interface Limit {
  bucket: string;
  max: number;
  windowSeconds: number;
}

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

export const LIMITS = {
  /** One person chatting fast is about one message every 20 seconds. */
  chatPerUser: { bucket: "chat:user", max: 30, windowSeconds: 10 * MINUTE },
  /** Several people can share an IP (an office, a household). */
  chatPerIp: { bucket: "chat:ip", max: 60, windowSeconds: 10 * MINUTE },
  /** Caps total model spend per day no matter how many users or IPs show up. */
  chatGlobal: { bucket: "chat:global", max: 2000, windowSeconds: DAY },
  votePerIp: { bucket: "vote:ip", max: 30, windowSeconds: MINUTE },
} satisfies Record<string, Limit>;

export interface LimitResult {
  allowed: boolean;
  /** Seconds until the most restrictive exceeded window resets; 0 when allowed. */
  retryAfterSeconds: number;
}

/** Start of the fixed window containing `now`. */
export function windowStart(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/**
 * Counts one request against each (limit, key) pair in a single round trip and reports whether
 * all are still within bounds. Denied requests still count, so hammering keeps you blocked.
 */
export async function consumeLimits(checks: { limit: Limit; key: string }[], now = new Date()): Promise<LimitResult> {
  const increments = checks.map(({ limit, key }) =>
    db
      .insert(rateLimitCounters)
      .values({ bucket: limit.bucket, key, windowStart: windowStart(now, limit.windowSeconds), count: 1 })
      .onConflictDoUpdate({
        target: [rateLimitCounters.bucket, rateLimitCounters.key, rateLimitCounters.windowStart],
        set: { count: sql`${rateLimitCounters.count} + 1` },
      })
      .returning({ count: rateLimitCounters.count }),
  );
  const [first, ...rest] = increments;
  const results = await db.batch([first, ...rest]);

  let retryAfterSeconds = 0;
  results.forEach(([{ count }], index) => {
    const { limit } = checks[index];
    if (count > limit.max) {
      const resetsAt = windowStart(now, limit.windowSeconds).getTime() + limit.windowSeconds * 1000;
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((resetsAt - now.getTime()) / 1000));
    }
  });
  return { allowed: retryAfterSeconds === 0, retryAfterSeconds };
}

/**
 * The caller's IP. On Vercel the platform sets x-forwarded-for itself, so its first entry is
 * the real client; elsewhere (local dev) the header may be missing.
 */
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

export function tooManyRequests(result: LimitResult, message: string): Response {
  return Response.json({ error: message }, { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } });
}
