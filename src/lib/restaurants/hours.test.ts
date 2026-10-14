import { describe, expect, it } from "vitest";
import { closingMinuteAt, isOpenAt, localDateAfter, parseHours, resolveArrival, toLocalDayMinute } from "./hours";

const SUN = 0, MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6;
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
    expect(intervals.map((i) => i.day)).toEqual([WED, THU, FRI, SAT, SUN, MON]);
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

describe("closingMinuteAt", () => {
  const intervals = parseHours("Daily 9am–11pm, Fri–Sat until 1am");

  it("returns the closing time of the period you arrive in", () => {
    expect(closingMinuteAt(intervals, MON, at(19))).toBe(at(23));
  });

  it("measures a past-midnight close on the arrival day's clock", () => {
    expect(closingMinuteAt(intervals, FRI, at(23, 30))).toBe(at(25));
    expect(closingMinuteAt(intervals, SAT, at(0, 30))).toBe(at(1));
  });

  it("returns null when closed", () => {
    expect(closingMinuteAt(intervals, MON, at(23, 30))).toBeNull();
  });
});

describe("localDateAfter", () => {
  it("uses the Los Angeles date, not UTC, and rolls over months", () => {
    // 03:30 UTC on Oct 31 is still Oct 30 in Los Angeles.
    const lateEvening = new Date("2026-10-31T03:30:00Z");
    expect(localDateAfter(lateEvening, 0, "America/Los_Angeles")).toBe("2026-10-30");
    expect(localDateAfter(lateEvening, 2, "America/Los_Angeles")).toBe("2026-11-01");
  });
});

describe("resolveArrival", () => {
  // Wednesday 2026-10-14, 9:00pm in Los Angeles.
  const wednesdayNight = new Date("2026-10-15T04:00:00Z");
  const LA = "America/Los_Angeles";

  it("uses the current time when none is given", () => {
    expect(resolveArrival(wednesdayNight, LA, 0, null)).toMatchObject({ day: WED, minute: at(21), rolledToTomorrow: false });
  });

  it("rolls a time that already passed today to tomorrow", () => {
    expect(resolveArrival(wednesdayNight, LA, 0, "00:30")).toEqual({
      day: THU,
      minute: at(0, 30),
      daysFromToday: 1,
      rolledToTomorrow: true,
    });
  });

  it("keeps a just-passed time today within the grace period", () => {
    expect(resolveArrival(wednesdayNight, LA, 0, "20:30")).toMatchObject({ day: WED, daysFromToday: 0, rolledToTomorrow: false });
  });

  it("never rolls an explicit future day", () => {
    expect(resolveArrival(wednesdayNight, LA, 2, "08:00")).toMatchObject({ day: FRI, daysFromToday: 2, rolledToTomorrow: false });
  });
});
