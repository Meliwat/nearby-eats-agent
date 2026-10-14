import { describe, expect, it } from "vitest";
import { evaluateLimits, windowStart, type Limit } from "./rate-limit";

const limit: Limit = { bucket: "test", max: 2, windowSeconds: 60 };
const now = new Date("2026-10-14T16:00:15Z");

describe("windowStart", () => {
  it("snaps to the start of the fixed window", () => {
    expect(windowStart(new Date("2026-10-14T16:07:30Z"), 600).toISOString()).toBe("2026-10-14T16:00:00.000Z");
    expect(windowStart(new Date("2026-10-14T16:10:00Z"), 600).toISOString()).toBe("2026-10-14T16:10:00.000Z");
  });
});

describe("evaluateLimits", () => {
  it("allows counts up to the max", () => {
    expect(evaluateLimits([{ limit, count: 2 }], now)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("blocks past the max until the window resets", () => {
    expect(evaluateLimits([{ limit, count: 3 }], now)).toEqual({ allowed: false, retryAfterSeconds: 45 });
  });

  it("waits for the latest-resetting exceeded limit", () => {
    const daily: Limit = { bucket: "day", max: 1, windowSeconds: 86_400 };
    const result = evaluateLimits([{ limit, count: 3 }, { limit: daily, count: 5 }], now);
    expect(result).toEqual({ allowed: false, retryAfterSeconds: 86_400 - (16 * 3600 + 15) });
  });
});
