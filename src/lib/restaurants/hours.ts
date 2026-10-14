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
  const previousDay = ((day + 6) % 7) as DayOfWeek;
  return intervals.some(
    (interval) =>
      (interval.day === day && minute >= interval.openMinute && minute < interval.closeMinute) ||
      (interval.day === previousDay && minute + MINUTES_PER_DAY < interval.closeMinute),
  );
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
  const day = DAY_NAMES.indexOf(part("weekday") as (typeof DAY_NAMES)[number]) as DayOfWeek;
  return { day, minute: Number(part("hour")) * 60 + Number(part("minute")) };
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
  const match = TIME_PATTERN.exec(token.trim());
  if (!match) throw new Error(`Unrecognized time "${token}"`);
  if (token.trim() === "noon") return 12 * 60;
  if (token.trim() === "midnight") return 0;
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
