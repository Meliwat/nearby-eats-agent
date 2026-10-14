import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DAY_NAMES, parseDays, type DayOfWeek } from "./hours";
import { parseRestaurantFile } from "./parse-source";

const sourceText = readFileSync(new URL("../../../data/restaurants.txt", import.meta.url), "utf8");
const restaurants = parseRestaurantFile(sourceText);

describe("parseRestaurantFile", () => {
  it("finds all 50 restaurants with sequential ids", () => {
    expect(restaurants.map((r) => r.id)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("parses the first entry's fields", () => {
    expect(restaurants[0]).toMatchObject({
      name: "Pollo Verde",
      city: "Santa Ana",
      cuisines: ["Mexican", "grilled chicken"],
      priceTier: 1,
    });
    expect(restaurants[0].context).toMatch(/^Counter service.*Cash and card\.$/);
  });

  it("joins wrapped context lines into one paragraph", () => {
    const hearthAndHen = restaurants.find((r) => r.name === "Hearth & Hen")!;
    expect(hearthAndHen.context).toContain("Sides are mostly cooked with pork.");
    expect(hearthAndHen.context).not.toContain("\n");
  });

  // Cross-checks the hours parser against the source's own "Closed ..." notes on every entry:
  // a day is closed exactly when the parser found no opening time on it.
  it.each(restaurants.map((r) => [r.name, r] as const))("%s: open days match the closed note", (_, r) => {
    const openDays = new Set(r.hours.map((interval) => interval.day));
    const closedDays = parseClosedNote(r.hoursText);
    for (const day of [0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]) {
      expect(openDays.has(day), `${DAY_NAMES[day]} in "${r.hoursText}"`).toBe(!closedDays.has(day));
    }
  });
});

/** "... Closed Mon–Tue." / "Closed Sundays." -> the set of closed days. */
function parseClosedNote(hoursText: string): Set<DayOfWeek> {
  const match = /Closed (\w{3})\w*(?:–(\w{3}))?/.exec(hoursText);
  if (!match) return new Set();
  const [, start, end] = match;
  return new Set(parseDays(end ? `${start}–${end}` : start));
}
