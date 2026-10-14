/** Rate-limit policy: the limits and the pure window math. Storage lives in rate-limit-store.ts. */

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
  /** Caps total chat turns per day no matter how many users or IPs show up. */
  chatGlobal: { bucket: "chat:global", max: 2000, windowSeconds: DAY },
  /** Caps total model tokens per day; turns vary a lot in size, so turns alone don't bound cost. */
  tokensGlobal: { bucket: "tokens:global", max: 5_000_000, windowSeconds: DAY },
  votePerIp: { bucket: "vote:ip", max: 30, windowSeconds: MINUTE },
  /** A household can vote several times on one poll; a script clearing cookies can't stuff it. */
  votesPerPollPerIp: { bucket: "vote:poll-ip", max: 10, windowSeconds: DAY },
  /** Page loads and the poll card's 5-second refresh, with plenty of headroom. */
  readPerIp: { bucket: "read:ip", max: 240, windowSeconds: MINUTE },
} satisfies Record<string, Limit>;

/** Counters older than this can't affect any window above, so they can be deleted. */
export const COUNTER_RETENTION_SECONDS = 2 * DAY;

export interface LimitResult {
  allowed: boolean;
  /** Seconds until the most restrictive exceeded window resets; 0 when allowed. */
  retryAfterSeconds: number;
  /** The counter values after this request, in the same order as the checks. */
  counts: number[];
}

/** Start of the fixed window containing `now`. */
export function windowStart(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** Allowed only if every count is within its limit; otherwise how long until the latest exceeded window resets. */
export function evaluateLimits(checks: { limit: Limit; count: number }[], now: Date): LimitResult {
  let retryAfterSeconds = 0;
  for (const { limit, count } of checks) {
    if (count <= limit.max) continue;
    const resetsAt = windowStart(now, limit.windowSeconds).getTime() + limit.windowSeconds * 1000;
    retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((resetsAt - now.getTime()) / 1000));
  }
  return { allowed: retryAfterSeconds === 0, retryAfterSeconds, counts: checks.map((check) => check.count) };
}

/**
 * The rate-limit key for the caller's IP. On Vercel the platform sets x-forwarded-for itself, so
 * its first entry is the real client; elsewhere (local dev) the header may be missing. IPv6 is
 * keyed by its /64 prefix, because one connection usually gets a whole /64 to rotate through.
 */
export function clientIp(request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim();
  if (!ip) return "unknown";
  return ip.includes(":") ? `${ipv6Prefix64(ip)}::/64` : ip;
}

/** The first four groups of an IPv6 address, expanding "::" and dropping any zone id. */
export function ipv6Prefix64(address: string): string {
  const [head, tail = ""] = address.split("%")[0].split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = address.includes("::") && tail ? tail.split(":") : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = address.includes("::") ? [...headGroups, ...Array(missing).fill("0"), ...tailGroups] : headGroups;
  return groups
    .slice(0, 4)
    .map((group) => (parseInt(group, 16) || 0).toString(16))
    .join(":");
}

/**
 * Chat and vote requests must be same-site JSON. A cross-site form or no-cors fetch can only
 * send "simple" content types, so requiring application/json forces a CORS preflight that fails,
 * and Sec-Fetch-Site rejects cross-site requests from modern browsers outright.
 */
export function rejectCrossSite(request: Request): Response | null {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Cross-site requests are not allowed" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected application/json" }, { status: 415 });
  }
  return null;
}

export function tooManyRequests(result: LimitResult, message: string): Response {
  return Response.json({ error: message }, { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } });
}
