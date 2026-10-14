import { z } from "zod";

/**
 * Hard constraints carry forward across a conversation in code. Once a search has used one (a diet,
 * kids, party size, budget, no cash), every later search keeps it unless the agent explicitly drops
 * it, for example when the user says the kids aren't coming after all. So a remembered "vegetarian"
 * can't silently fall out of a later search.
 */
export const DROPPABLE_CONSTRAINTS = ["vegetarian", "vegan", "gluten_free", "kids", "party_size", "budget", "cash"] as const;
export type DroppableConstraint = (typeof DROPPABLE_CONSTRAINTS)[number];

/** The constraints a search actually applied. Stored in its tool output, read back by the next turn. */
export const appliedConstraintsSchema = z.object({
  diets: z.array(z.enum(["vegetarian", "vegan", "gluten_free"])),
  with_kids: z.boolean(),
  party_size: z.number().nullable(),
  max_price_tier: z.number().nullable(),
  avoid_cash_only: z.boolean(),
});
export type AppliedConstraints = z.infer<typeof appliedConstraintsSchema>;

export const NO_CONSTRAINTS: AppliedConstraints = {
  diets: [],
  with_kids: false,
  party_size: null,
  max_price_tier: null,
  avoid_cash_only: false,
};

/** This search's constraints, plus everything earlier searches required that the agent didn't drop. */
export function carryForward(
  previous: AppliedConstraints,
  requested: AppliedConstraints,
  dropped: DroppableConstraint[],
): { applied: AppliedConstraints; carried: string[]; dropped: DroppableConstraint[] } {
  const keeps = (constraint: DroppableConstraint) => !dropped.includes(constraint);
  const carriedDiets = previous.diets.filter((diet) => keeps(diet) && !requested.diets.includes(diet));
  const carryKids = previous.with_kids && keeps("kids") && !requested.with_kids;
  const carryParty = previous.party_size !== null && keeps("party_size") && requested.party_size === null;
  const carryBudget = previous.max_price_tier !== null && keeps("budget") && requested.max_price_tier === null;
  const carryCash = previous.avoid_cash_only && keeps("cash") && !requested.avoid_cash_only;

  return {
    applied: {
      diets: [...requested.diets, ...carriedDiets],
      with_kids: requested.with_kids || carryKids,
      party_size: carryParty ? previous.party_size : requested.party_size,
      max_price_tier: carryBudget ? previous.max_price_tier : requested.max_price_tier,
      avoid_cash_only: requested.avoid_cash_only || carryCash,
    },
    carried: [
      ...carriedDiets,
      ...(carryKids ? ["kids"] : []),
      ...(carryParty ? [`party of ${previous.party_size}`] : []),
      ...(carryBudget ? [`budget up to ${"$".repeat(previous.max_price_tier!)}`] : []),
      ...(carryCash ? ["no cash-only"] : []),
    ],
    // Only drops that actually lifted an earlier constraint this search didn't ask for again.
    dropped: dropped.filter((constraint) => wasApplied(previous, constraint) && !wasApplied(requested, constraint)),
  };
}

function wasApplied(constraints: AppliedConstraints, constraint: DroppableConstraint): boolean {
  switch (constraint) {
    case "kids":
      return constraints.with_kids;
    case "party_size":
      return constraints.party_size !== null;
    case "budget":
      return constraints.max_price_tier !== null;
    case "cash":
      return constraints.avoid_cash_only;
    default:
      return constraints.diets.includes(constraint);
  }
}
