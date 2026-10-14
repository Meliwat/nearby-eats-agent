import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { rateLimitCounters } from "@/db/schema";
import { evaluateLimits, windowStart, type Limit, type LimitResult } from "./rate-limit";

/**
 * Counts one request against each (limit, key) pair in a single round trip (an atomic upsert per
 * counter) and reports whether all are still within bounds. Denied requests still count, so
 * hammering keeps you blocked.
 */
export async function consumeLimits(checks: { limit: Limit; key: string }[], now = new Date()): Promise<LimitResult> {
  const [first, ...rest] = checks.map(({ limit, key }) =>
    db
      .insert(rateLimitCounters)
      .values({ bucket: limit.bucket, key, windowStart: windowStart(now, limit.windowSeconds), count: 1 })
      .onConflictDoUpdate({
        target: [rateLimitCounters.bucket, rateLimitCounters.key, rateLimitCounters.windowStart],
        set: { count: sql`${rateLimitCounters.count} + 1` },
      })
      .returning({ count: rateLimitCounters.count }),
  );
  const results = await db.batch([first, ...rest]);
  return evaluateLimits(
    results.map(([{ count }], index) => ({ limit: checks[index].limit, count })),
    now,
  );
}
