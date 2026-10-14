import { describe, expect, it } from "vitest";
import { buildVisitIcs } from "./calendar";

describe("buildVisitIcs", () => {
  const ics = buildVisitIcs({
    restaurant: "Hearth & Hen",
    address: "305 E Chapman Ave, Orange, CA 92866",
    description: "Fried chicken; get the biscuits",
    date: "2026-10-16",
    time: "19:00",
    timeZone: "America/Los_Angeles",
    uid: "abc@nearby",
    now: new Date("2026-10-14T16:00:00.000Z"),
  });

  it("starts at the local visit time in the restaurant's time zone", () => {
    expect(ics).toContain("DTSTART;TZID=America/Los_Angeles:20261016T190000");
    expect(ics).toContain("DTSTAMP:20261014T160000Z");
  });

  it("escapes commas and semicolons in text fields with a backslash", () => {
    expect(ics).toContain(String.raw`LOCATION:305 E Chapman Ave\, Orange\, CA 92866`);
    expect(ics).toContain(String.raw`DESCRIPTION:Fried chicken\; get the biscuits`);
  });

  it("defines the time zone it references", () => {
    expect(ics).toContain("BEGIN:VTIMEZONE\r\nTZID:America/Los_Angeles");
  });

  it("uses CRLF line endings", () => {
    expect(ics.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
  });

  it("folds lines longer than 75 octets", () => {
    const long = buildVisitIcs({
      restaurant: "Place",
      address: "Somewhere",
      description: "x".repeat(200),
      date: "2026-10-16",
      time: "19:00",
      timeZone: "America/Los_Angeles",
      uid: "u@nearby",
      now: new Date("2026-10-14T16:00:00.000Z"),
    });
    for (const line of long.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(long.replace(/\r\n /g, "")).toContain(`DESCRIPTION:${"x".repeat(200)}`);
  });
});
