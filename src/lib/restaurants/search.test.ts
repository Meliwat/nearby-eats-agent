import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogFromSource } from "./catalog";
import { isOpenAt, type DayOfWeek } from "./hours";
import { parseRestaurantFile } from "./parse-source";
import { MIN_VISIT_MINUTES, searchRestaurants, type SearchFilters } from "./search";

const catalog = catalogFromSource(
  parseRestaurantFile(readFileSync(new URL("../../../data/restaurants.txt", import.meta.url), "utf8")),
);

const MON = 1, FRI = 5, SAT = 6;
const at = (hour: number, minute = 0) => hour * 60 + minute;

function filters(overrides: Partial<SearchFilters> = {}): SearchFilters {
  return {
    arrival: { day: FRI, minute: at(19), daysFromToday: 0 },
    diets: [],
    withKids: false,
    partySize: null,
    maxPriceTier: null,
    cities: [],
    avoidCashOnly: false,
    excludeIds: [],
    ...overrides,
  };
}

const candidateNames = (f: SearchFilters) => searchRestaurants(catalog, f).candidates.map((r) => r.name);
const reasonsFor = (f: SearchFilters, name: string) =>
  searchRestaurants(catalog, f).excluded.find((e) => e.name === name)?.reasons.map((r) => r.code) ?? [];

describe("searchRestaurants", () => {
  it("splits the whole catalog into candidates and excluded with reasons", () => {
    const result = searchRestaurants(catalog, filters());
    expect(result.candidates.length + result.excluded.length).toBe(50);
    for (const excluded of result.excluded) expect(excluded.reasons.length).toBeGreaterThan(0);
  });

  it("only returns places open for every minute of the visit, for every arrival hour of the week", () => {
    // Checked minute by minute with isOpenAt, independently of the isOpenThrough logic search uses.
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const arrival = { day: day as DayOfWeek, minute: at(hour), daysFromToday: 0 };
        for (const r of searchRestaurants(catalog, filters({ arrival })).candidates) {
          for (let offset = 0; offset < MIN_VISIT_MINUTES; offset++) {
            const minute = arrival.minute + offset;
            const visitDay = (minute >= 24 * 60 ? (day + 1) % 7 : day) as DayOfWeek;
            expect(isOpenAt(r.hours, visitDay, minute % (24 * 60)), `${r.name} day ${day} ${hour}:00 +${offset}m`).toBe(true);
          }
        }
      }
    }
  });

  it("excludes places that close soon after arrival", () => {
    // Saffron House's lunch shift ends at 2:30pm.
    expect(reasonsFor(filters({ arrival: { day: FRI, minute: at(14, 0), daysFromToday: 0 } }), "Saffron House")).toContain(
      "closing_soon",
    );
  });

  it("knows Monday closures", () => {
    expect(reasonsFor(filters({ arrival: { day: MON, minute: at(19), daysFromToday: 0 } }), "Saffron House")).toContain("closed");
  });

  it("finds late-night food after midnight on a Saturday", () => {
    const names = candidateNames(filters({ arrival: { day: SAT, minute: at(0, 15), daysFromToday: 0 } }));
    expect(names).toEqual(expect.arrayContaining(["Tacos El Camino", "Villa Wings", "Kinoko Izakaya"]));
  });

  it("keeps vegetarians away from Hearth & Hen", () => {
    expect(reasonsFor(filters({ diets: ["vegetarian"] }), "Hearth & Hen")).toContain("diet");
    expect(candidateNames(filters({ diets: ["vegetarian"] }))).toContain("Casa Verde");
  });

  it("excludes no-kid places and 21+ hours for families", () => {
    const evening = filters({ withKids: true, arrival: { day: FRI, minute: at(21, 30), daysFromToday: 0 } });
    expect(reasonsFor(evening, "Villa Wings")).toContain("adults_only");
    expect(reasonsFor(evening, "Barrio Tacos y Mezcal")).toContain("not_for_kids");
  });

  it("applies party size limits in both directions", () => {
    expect(reasonsFor(filters({ partySize: 1 }), "Seoul Fire BBQ")).toContain("party_too_small");
    expect(reasonsFor(filters({ partySize: 8 }), "Kettle Ramen Bar")).toContain("too_small_for_group");
    expect(candidateNames(filters({ partySize: 8 }))).toContain("Seoul Fire BBQ");
  });

  it("never offers The Lantern Room for tonight, but does three weeks out", () => {
    const tonight = filters({ arrival: { day: FRI, minute: at(19), daysFromToday: 0 } });
    const weeksOut = filters({ arrival: { day: FRI, minute: at(19), daysFromToday: 21 } });
    expect(reasonsFor(tonight, "The Lantern Room")).toContain("books_out");
    expect(candidateNames(weeksOut)).toContain("The Lantern Room");
  });

  it("filters by budget, area, cash, and prior rejections", () => {
    const result = searchRestaurants(
      catalog,
      filters({ maxPriceTier: 2, cities: ["Santa Ana"], avoidCashOnly: true, excludeIds: [21] }),
    );
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const r of result.candidates) {
      expect(r.priceTier).toBeLessThanOrEqual(2);
      expect(r.city).toBe("Santa Ana");
      expect(r.cashOnly).toBe(false);
    }
    expect(result.excluded.find((e) => e.id === 21)?.reasons.map((r) => r.code)).toContain("already_rejected");
  });
});
