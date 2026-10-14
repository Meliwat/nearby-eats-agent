import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { windowStart, type Limit } from "./rate-limit";

describe("windowStart", () => {
  it("snaps to the start of the fixed window", () => {
    expect(windowStart(new Date("2026-10-14T16:07:30Z"), 600).toISOString()).toBe("2026-10-14T16:00:00.000Z");
    expect(windowStart(new Date("2026-10-14T16:10:00Z"), 600).toISOString()).toBe("2026-10-14T16:10:00.000Z");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("consumeLimits (database)", () => {
  // A bucket name unique to this run, so it can't collide with real traffic and is easy to clean up.
  const limit: Limit = { bucket: `test:${crypto.randomUUID()}`, max: 2, windowSeconds: 60 };
  const now = new Date("2026-10-14T16:00:15Z");

  afterAll(async () => {
    const { db } = await import("@/db/client");
    const { rateLimitCounters } = await import("@/db/schema");
    await db.delete(rateLimitCounters).where(eq(rateLimitCounters.bucket, limit.bucket));
  });

  it("allows up to the max, then blocks with the time until the window resets", async () => {
    const { consumeLimits } = await import("./rate-limit");
    const check = () => consumeLimits([{ limit, key: "1.2.3.4" }], now);
    expect(await check()).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(await check()).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(await check()).toEqual({ allowed: false, retryAfterSeconds: 45 });
  });

  it("counts each key separately", async () => {
    const { consumeLimits } = await import("./rate-limit");
    expect((await consumeLimits([{ limit, key: "5.6.7.8" }], now)).allowed).toBe(true);
  });
});
