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

/** Allowed only if every count is within its limit; otherwise how long until the latest exceeded window resets. */
export function evaluateLimits(checks: { limit: Limit; count: number }[], now: Date): LimitResult {
  let retryAfterSeconds = 0;
  for (const { limit, count } of checks) {
    if (count <= limit.max) continue;
    const resetsAt = windowStart(now, limit.windowSeconds).getTime() + limit.windowSeconds * 1000;
    retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((resetsAt - now.getTime()) / 1000));
  }
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
