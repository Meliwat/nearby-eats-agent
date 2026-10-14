/** 0 = Sunday ... 6 = Saturday, matching Date#getDay. */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * One open period that starts on `day`. Minutes count from that day's midnight,
 * so a place open 5pm to 1am is { openMinute: 1020, closeMinute: 1500 }.
 */
export interface OpenInterval {
  day: DayOfWeek;
  openMinute: number;
  closeMinute: number;
}

export const MINUTES_PER_DAY = 24 * 60;
/** Every restaurant in the catalog is in Orange County. */
export const RESTAURANT_TIME_ZONE = "America/Los_Angeles";
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const ALL_DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];

const TIME_PATTERN = /^(?:noon|midnight|(\d{1,2})(?::(\d{2}))?(am|pm))$/;
const SEGMENT_PATTERN = /^(?:(Daily|[A-Z][a-z]{2}(?:–[A-Z][a-z]{2})?)\s+)?(.+)$/;

/**
 * Parses an "Hours:" line from the source data, e.g.
 * "Tue–Sun 11:30am–2:30pm, 5pm–9:30pm. Closed Mondays."
 * Days not covered by the schedule are closed, so the trailing "Closed ..." text is ignored.
 * Throws on anything it does not recognize so bad data fails at seed time, not in a chat.
 */
export function parseHours(text: string): OpenInterval[] {
  const schedule = text
    .split(/\.\s*Closed\b/)[0]
    // Smoke & Oak closes when the brisket runs out; treat the usual sell-out time as closing.
    .replace(/until sold out, usually around (\S+)/, "–$1")
    .replace(/\.$/, "");

  const intervals: OpenInterval[] = [];
  let days: DayOfWeek[] | null = null;

  for (const segment of schedule.split(", ")) {
    const match = SEGMENT_PATTERN.exec(segment.trim());
    if (!match) throw new Error(`Unrecognized hours segment "${segment}" in "${text}"`);
    const [, daySpec, times] = match;

    // A segment without days ("..., 5pm–10pm") is a second shift on the previous segment's days.
    days = daySpec ? parseDays(daySpec) : days;
    if (!days) throw new Error(`Hours segment "${segment}" has no days in "${text}"`);

    if (times.startsWith("until ")) {
      extendClosing(intervals, days, parseTime(times.slice("until ".length)), text);
      continue;
    }

    const [open, close] = times.split("–");
    if (close === undefined) throw new Error(`Expected a time range in "${segment}" of "${text}"`);
    const openMinute = parseTime(open);
    for (const day of days) {
      intervals.push({ day, openMinute, closeMinute: normalizeClose(openMinute, parseTime(close)) });
    }
  }

  return intervals;
}

/** True if any interval covers the given local day and minute, including spillover past midnight. */
export function isOpenAt(intervals: OpenInterval[], day: DayOfWeek, minute: number): boolean {
  return closingMinuteAt(intervals, day, minute) !== null;
}

/** True if open at `minute` and still open `durationMinutes` later (rolling into the next day if needed). */
export function isOpenThrough(
  intervals: OpenInterval[],
  day: DayOfWeek,
  minute: number,
  durationMinutes: number,
): boolean {
  const end = minute + durationMinutes - 1;
  const endDay = (end >= MINUTES_PER_DAY ? (day + 1) % 7 : day) as DayOfWeek;
  return isOpenAt(intervals, day, minute) && isOpenAt(intervals, endDay, end % MINUTES_PER_DAY);
}

/**
 * Closing time of the open period covering `minute` on `day`, measured on that day's clock
 * (so a Friday-night period ending 1am, seen from Saturday 12:30am, closes at minute 60).
 */
export function closingMinuteAt(intervals: OpenInterval[], day: DayOfWeek, minute: number): number | null {
  const previousDay = ((day + 6) % 7) as DayOfWeek;
  for (const interval of intervals) {
    if (interval.day === day && minute >= interval.openMinute && minute < interval.closeMinute) return interval.closeMinute;
    if (interval.day === previousDay && minute + MINUTES_PER_DAY < interval.closeMinute) {
      return interval.closeMinute - MINUTES_PER_DAY;
    }
  }
  return null;
}

/** Calendar date ("2026-10-16") that is `daysAhead` days after `date`, in the given time zone. */
export function localDateAfter(date: Date, daysAhead: number, timeZone: string): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + daysAhead)).toISOString().slice(0, 10);
}

/** "Lunch at 12" asked at 12:40 still means today; anything earlier than this means tomorrow. */
export const PAST_TIME_GRACE_MINUTES = 60;

/**
 * Turns "days from today + HH:MM" into a concrete arrival. A time that has already passed today
 * (beyond a grace period) means the next occurrence: "12:30am" asked at 9pm is tomorrow's 12:30am.
 */
export function resolveArrival(
  now: Date,
  timeZone: string,
  daysFromToday: number,
  time: string | null,
): { day: DayOfWeek; minute: number; daysFromToday: number; rolledToTomorrow: boolean } {
  const local = toLocalDayMinute(now, timeZone);
  const minute = time === null ? local.minute : clockToMinute(time);
  const rolledToTomorrow = daysFromToday === 0 && minute < local.minute - PAST_TIME_GRACE_MINUTES;
  const days = rolledToTomorrow ? 1 : daysFromToday;
  return { day: ((local.day + days) % 7) as DayOfWeek, minute, daysFromToday: days, rolledToTomorrow };
}

/** "19:30" -> 1170 */
export function clockToMinute(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Day of week and minute of day for `date` in the given IANA time zone. */
export function toLocalDayMinute(date: Date, timeZone: string): { day: DayOfWeek; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: dayIndex(part("weekday")), minute: Number(part("hour")) * 60 + Number(part("minute")) };
}

function parseDays(spec: string): DayOfWeek[] {
  if (spec === "Daily") return ALL_DAYS;
  const [start, end = start] = spec.split("–").map(dayIndex);
  const days: DayOfWeek[] = [start];
  // Walk forward so wraparound ranges like "Wed–Mon" work.
  for (let day = start; day !== end; ) {
    day = ((day + 1) % 7) as DayOfWeek;
    days.push(day);
  }
  return days;
}

function dayIndex(name: string): DayOfWeek {
  const index = DAY_NAMES.indexOf(name as (typeof DAY_NAMES)[number]);
  if (index === -1) throw new Error(`Unknown day "${name}"`);
  return index as DayOfWeek;
}

function parseTime(token: string): number {
  const text = token.trim();
  const match = TIME_PATTERN.exec(text);
  if (!match) throw new Error(`Unrecognized time "${token}"`);
  if (text === "noon") return 12 * 60;
  if (text === "midnight") return 0;
  const [, hourText, minuteText = "0", meridiem] = match;
  const hour = (Number(hourText) % 12) + (meridiem === "pm" ? 12 : 0);
  return hour * 60 + Number(minuteText);
}

/** A closing time at or before the opening time means the place closes after midnight. */
function normalizeClose(openMinute: number, closeMinute: number): number {
  return closeMinute <= openMinute ? closeMinute + MINUTES_PER_DAY : closeMinute;
}

/** Applies "Fri–Sat until 1am": the last shift on each listed day closes later. */
function extendClosing(intervals: OpenInterval[], days: DayOfWeek[], closeMinute: number, text: string) {
  for (const day of days) {
    const lastShift = intervals.findLast((interval) => interval.day === day);
    if (!lastShift) throw new Error(`"until" for a day with no opening time in "${text}"`);
    lastShift.closeMinute = normalizeClose(lastShift.openMinute, closeMinute);
  }
}
