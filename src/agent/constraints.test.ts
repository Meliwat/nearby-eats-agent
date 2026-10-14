import { describe, expect, it } from "vitest";
import { carryForward, NO_CONSTRAINTS, type AppliedConstraints } from "./constraints";

const earlier: AppliedConstraints = {
  diets: ["vegetarian"],
  with_kids: true,
  party_size: 4,
  max_price_tier: 2,
  avoid_cash_only: true,
};

describe("carryForward", () => {
  it("keeps every earlier constraint the new search left out", () => {
    const { applied, carried } = carryForward(earlier, NO_CONSTRAINTS, []);
    expect(applied).toEqual(earlier);
    expect(carried).toEqual(["vegetarian", "kids", "party of 4", "budget up to $$", "no cash-only"]);
  });

  it("lets the new search change a value, and adds new constraints", () => {
    const requested = { ...NO_CONSTRAINTS, diets: ["vegan" as const], party_size: 6, max_price_tier: 3 };
    const { applied } = carryForward(earlier, requested, []);
    expect(applied).toEqual({ diets: ["vegan", "vegetarian"], with_kids: true, party_size: 6, max_price_tier: 3, avoid_cash_only: true });
  });

  it("drops only what the agent explicitly drops", () => {
    const { applied, carried } = carryForward(earlier, NO_CONSTRAINTS, ["vegetarian", "kids", "party_size"]);
    expect(applied).toEqual({ diets: [], with_kids: false, party_size: null, max_price_tier: 2, avoid_cash_only: true });
    expect(carried).toEqual(["budget up to $$", "no cash-only"]);
  });

  it("carries nothing at the start of a conversation", () => {
    expect(carryForward(NO_CONSTRAINTS, NO_CONSTRAINTS, [])).toEqual({ applied: NO_CONSTRAINTS, carried: [] });
  });
});
