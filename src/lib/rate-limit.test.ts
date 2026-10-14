import { describe, expect, it } from "vitest";
import {
  clientIp,
  evaluateLimits,
  ipv6Prefix64,
  noNulBytes,
  rejectCrossSite,
  rejectLargeBody,
  windowStart,
  type Limit,
} from "./rate-limit";

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
    expect(evaluateLimits([{ limit, count: 2 }], now)).toEqual({ allowed: true, retryAfterSeconds: 0, counts: [2] });
  });

  it("blocks past the max until the window resets", () => {
    expect(evaluateLimits([{ limit, count: 3 }], now)).toEqual({ allowed: false, retryAfterSeconds: 45, counts: [3] });
  });

  it("waits for the latest-resetting exceeded limit", () => {
    const daily: Limit = { bucket: "day", max: 1, windowSeconds: 86_400 };
    const result = evaluateLimits([{ limit, count: 3 }, { limit: daily, count: 5 }], now);
    expect(result).toEqual({ allowed: false, retryAfterSeconds: 86_400 - (16 * 3600 + 15), counts: [3, 5] });
  });
});

describe("clientIp", () => {
  const withForwardedFor = (value: string) => new Request("https://x", { headers: { "x-forwarded-for": value } });

  it("uses the first forwarded address", () => {
    expect(clientIp(withForwardedFor("203.0.113.7, 10.0.0.1"))).toBe("203.0.113.7");
  });

  it("groups IPv6 clients by their /64 so rotating addresses share one limit", () => {
    expect(clientIp(withForwardedFor("2001:db8:abcd:12:1::5"))).toBe("2001:db8:abcd:12::/64");
    expect(clientIp(withForwardedFor("2001:db8:abcd:12:ffff:ffff:ffff:ffff"))).toBe("2001:db8:abcd:12::/64");
  });

  it("handles a missing header", () => {
    expect(clientIp(new Request("https://x"))).toBe("unknown");
  });
});

describe("ipv6Prefix64", () => {
  it("expands :: in any position", () => {
    expect(ipv6Prefix64("2001:db8::1")).toBe("2001:db8:0:0");
    expect(ipv6Prefix64("::1")).toBe("0:0:0:0");
    expect(ipv6Prefix64("fe80::1%eth0")).toBe("fe80:0:0:0");
  });
});

describe("rejectCrossSite", () => {
  const post = (headers: Record<string, string>) => new Request("https://x", { method: "POST", headers });

  it("lets same-site JSON through", () => {
    expect(rejectCrossSite(post({ "content-type": "application/json", "sec-fetch-site": "same-origin" }))).toBeNull();
  });

  it("rejects requests a browser marks cross-site", () => {
    expect(rejectCrossSite(post({ "content-type": "application/json", "sec-fetch-site": "cross-site" }))?.status).toBe(403);
  });

  it("rejects simple content types that skip the CORS preflight", () => {
    expect(rejectCrossSite(post({ "content-type": "text/plain" }))?.status).toBe(415);
  });
});

describe("edge validation", () => {
  it("refuses bodies over the size limit before they are parsed", () => {
    const big = new Request("https://x", { method: "POST", headers: { "content-length": "20000" } });
    const small = new Request("https://x", { method: "POST", headers: { "content-length": "200" } });
    expect(rejectLargeBody(big)?.status).toBe(413);
    expect(rejectLargeBody(small)).toBeNull();
  });

  it("refuses NUL bytes, which Postgres text columns can't store", () => {
    expect(noNulBytes("tacos tonight")).toBe(true);
    expect(noNulBytes(`tacos${String.fromCharCode(0)}tonight`)).toBe(false);
  });
});
