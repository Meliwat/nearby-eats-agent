import { lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { rateLimitCounters } from "@/db/schema";
import { COUNTER_RETENTION_SECONDS, evaluateLimits, windowStart, type Limit, type LimitResult } from "./rate-limit";

/**
 * Adds `amount` (default 1) to each (limit, key) counter in a single round trip (an atomic upsert
 * per counter) and reports whether all are still within bounds. An amount of 0 just reads the
 * current value. Denied requests still count against the limits checked in the same call, so
 * callers check narrow limits (per IP) before broad ones (global) to keep one abuser from
 * using up everyone's budget.
 */
export async function consumeLimits(
  checks: { limit: Limit; key: string; amount?: number }[],
  now = new Date(),
): Promise<LimitResult> {
  // Destructured only because db.batch's type demands a non-empty tuple.
  const [first, ...rest] = checks.map(({ limit, key, amount = 1 }) =>
    db
      .insert(rateLimitCounters)
      .values({ bucket: limit.bucket, key, windowStart: windowStart(now, limit.windowSeconds), count: amount })
      .onConflictDoUpdate({
        target: [rateLimitCounters.bucket, rateLimitCounters.key, rateLimitCounters.windowStart],
        set: { count: sql`${rateLimitCounters.count} + ${amount}` },
      })
      .returning({ count: rateLimitCounters.count }),
  );
  const results = await db.batch([first, ...rest]);
  return evaluateLimits(
    results.map(([{ count }], index) => ({ limit: checks[index].limit, count })),
    now,
  );
}

/** Deletes counters too old to affect any window, so the table stays small. */
export async function deleteExpiredCounters(now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - COUNTER_RETENTION_SECONDS * 1000);
  await db.delete(rateLimitCounters).where(lt(rateLimitCounters.windowStart, cutoff));
}
