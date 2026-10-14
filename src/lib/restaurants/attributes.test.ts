import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESTAURANT_ATTRIBUTES } from "./attributes";
import { parseRestaurantFile } from "./parse-source";

const sourceText = readFileSync(new URL("../../../data/restaurants.txt", import.meta.url), "utf8");
const restaurants = parseRestaurantFile(sourceText);
const byName = (name: string) => RESTAURANT_ATTRIBUTES.find((a) => a.name === name)!;

describe("RESTAURANT_ATTRIBUTES", () => {
  it("has exactly one row per source restaurant, matched by id and name", () => {
    expect(RESTAURANT_ATTRIBUTES.map((a) => [a.id, a.name])).toEqual(restaurants.map((r) => [r.id, r.name]));
  });

  it.each(restaurants.map((r) => [r.name, r] as const))("%s: cash-only flag matches the source", (name, r) => {
    expect(byName(name).cashOnly).toBe(/cash only/i.test(r.context));
  });

  it.each(restaurants.map((r) => [r.name, r] as const))("%s: 21+ flag matches the source", (name, r) => {
    expect(byName(name).adultsOnlyFromMinute !== null).toBe(/21\+/.test(r.context));
  });

  // The traps in the data that a keyword search would get wrong.
  it("marks Hearth & Hen unsuitable for vegetarians (sides cooked with pork)", () => {
    expect(byName("Hearth & Hen").vegetarian).toBe("none");
  });

  it("marks Saffron House vegan only on request (hold the ghee and cream)", () => {
    expect(byName("Saffron House").vegan).toBe("on_request");
  });

  it("requires two people at Seoul Fire", () => {
    expect(byName("Seoul Fire BBQ").minPartySize).toBe(2);
  });

  it("keeps kids out of The Lantern Room and needs weeks of notice", () => {
    expect(byName("The Lantern Room")).toMatchObject({ kids: "not_allowed", bookingLeadDays: 21 });
  });
});
