import { describe, expect, it } from "vitest";
import { isOpenAt, parseHours, toLocalDayMinute } from "./hours";

const SUN = 0, MON = 1, TUE = 2, WED = 3, FRI = 5, SAT = 6;
const at = (hour: number, minute = 0) => hour * 60 + minute;

describe("parseHours", () => {
  it("parses a daily schedule for all seven days", () => {
    const intervals = parseHours("Daily 11am–10pm");
    expect(intervals).toHaveLength(7);
    expect(intervals[0]).toEqual({ day: SUN, openMinute: at(11), closeMinute: at(22) });
  });

  it("treats days outside the range as closed", () => {
    const intervals = parseHours("Tue–Sun 11am–9pm. Closed Mondays.");
    expect(isOpenAt(intervals, MON, at(12))).toBe(false);
    expect(isOpenAt(intervals, TUE, at(12))).toBe(true);
  });

  it("walks ranges that wrap past Saturday", () => {
    const intervals = parseHours("Wed–Mon 11am–9pm. Closed Tuesdays.");
    expect(intervals.map((i) => i.day)).toEqual([WED, 4, FRI, SAT, SUN, MON]);
  });

  it("keeps split shifts on the same days", () => {
    const intervals = parseHours("Tue–Sun 11:30am–2:30pm, 5pm–9:30pm. Closed Mondays.");
    expect(isOpenAt(intervals, WED, at(14))).toBe(true);
    expect(isOpenAt(intervals, WED, at(15))).toBe(false);
    expect(isOpenAt(intervals, WED, at(21))).toBe(true);
  });

  it("applies per-day closing overrides", () => {
    const intervals = parseHours("Daily noon–10pm, Fri–Sat until 11pm");
    expect(isOpenAt(intervals, FRI, at(22, 30))).toBe(true);
    expect(isOpenAt(intervals, MON, at(22, 30))).toBe(false);
    expect(isOpenAt(intervals, MON, at(12))).toBe(true);
  });

  it("carries late closes past midnight into the next day", () => {
    const intervals = parseHours("Daily 9am–11pm, Fri–Sat until 1am");
    expect(isOpenAt(intervals, SAT, at(0, 30))).toBe(true); // Friday night
    expect(isOpenAt(intervals, FRI, at(0, 30))).toBe(false); // Thursday closed at 11pm
  });

  it("reads midnight as a close at the end of the day", () => {
    const intervals = parseHours("Tue–Sun 4pm–midnight. Closed Mondays.");
    expect(isOpenAt(intervals, SUN, at(23, 59))).toBe(true);
    expect(isOpenAt(intervals, MON, at(0))).toBe(false);
  });

  it("treats the usual sell-out time as closing", () => {
    const intervals = parseHours("Wed–Sun 11am until sold out, usually around 7pm. Closed Mon–Tue.");
    expect(isOpenAt(intervals, SAT, at(18))).toBe(true);
    expect(isOpenAt(intervals, SAT, at(19))).toBe(false);
  });

  it("rejects day words it does not understand", () => {
    expect(() => parseHours("Weekends 10am–2pm")).toThrow(/no days/);
  });

  it("rejects times it does not understand", () => {
    expect(() => parseHours("Daily 10ish–2pm")).toThrow(/Unrecognized time/);
  });
});

describe("toLocalDayMinute", () => {
  it("converts to Los Angeles time across the date line", () => {
    // 2026-10-17 03:30 UTC is Friday 2026-10-16 8:30pm in Los Angeles (PDT).
    const local = toLocalDayMinute(new Date("2026-10-17T03:30:00Z"), "America/Los_Angeles");
    expect(local).toEqual({ day: FRI, minute: at(20, 30) });
  });
});
