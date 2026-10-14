import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { Limit } from "./rate-limit";

// Imported lazily: the store needs DATABASE_URL, and this file must still load (skipped) without it.
describe.skipIf(!process.env.DATABASE_URL)("consumeLimits (database)", () => {
  // A bucket unique to this run, so it can't collide with real traffic and is easy to clean up.
  const limit: Limit = { bucket: `test:${crypto.randomUUID()}`, max: 2, windowSeconds: 60 };
  const now = new Date("2026-10-14T16:00:15Z");

  afterAll(async () => {
    const { db } = await import("@/db/client");
    const { rateLimitCounters } = await import("@/db/schema");
    await db.delete(rateLimitCounters).where(eq(rateLimitCounters.bucket, limit.bucket));
  });

  it("counts atomically: the third request in the window is blocked", async () => {
    const { consumeLimits } = await import("./rate-limit-store");
    const check = () => consumeLimits([{ limit, key: "1.2.3.4" }], now);
    expect((await check()).allowed).toBe(true);
    expect((await check()).allowed).toBe(true);
    expect(await check()).toEqual({ allowed: false, retryAfterSeconds: 45, counts: [3] });
  });

  it("adds arbitrary amounts and reads with an amount of 0", async () => {
    const { consumeLimits } = await import("./rate-limit-store");
    const budget: Limit = { ...limit, max: 1000 };
    await consumeLimits([{ limit: budget, key: "tokens", amount: 700 }], now);
    expect((await consumeLimits([{ limit: budget, key: "tokens", amount: 0 }], now)).counts).toEqual([700]);
    expect((await consumeLimits([{ limit: budget, key: "tokens", amount: 400 }], now)).allowed).toBe(false);
  });

  it("counts each key separately", async () => {
    const { consumeLimits } = await import("./rate-limit-store");
    expect((await consumeLimits([{ limit, key: "5.6.7.8" }], now)).allowed).toBe(true);
  });
});
