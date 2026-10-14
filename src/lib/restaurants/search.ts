import type { CatalogRestaurant } from "./catalog";
import { DAY_NAMES, isOpenAt, isOpenThrough, type DayOfWeek } from "./hours";

export type Diet = "vegetarian" | "vegan" | "gluten_free";

/** The hard constraints search enforces. Anything softer is left to the model. */
export interface SearchFilters {
  arrival: { day: DayOfWeek; minute: number; daysFromToday: number };
  diets: Diet[];
  withKids: boolean;
  partySize: number | null;
  maxPriceTier: number | null;
  /** Empty means anywhere. */
  cities: string[];
  avoidCashOnly: boolean;
  /** Places the user already turned down in this conversation. */
  excludeIds: number[];
}

export type ExclusionCode =
  | "closed"
  | "closing_soon"
  | "diet"
  | "not_for_kids"
  | "adults_only"
  | "party_too_small"
  | "too_small_for_group"
  | "over_budget"
  | "outside_area"
  | "cash_only"
  | "books_out"
  | "already_rejected";

export interface Exclusion {
  code: ExclusionCode;
  detail: string;
}

export interface SearchResult {
  candidates: CatalogRestaurant[];
  excluded: { id: number; name: string; reasons: Exclusion[] }[];
}

/** Leave time to actually eat: a place closing 20 minutes after you arrive is not a recommendation. */
export const MIN_VISIT_MINUTES = 45;
/** Parties this size or larger skip places the source calls tiny or bad for groups. */
export const LARGE_PARTY_SIZE = 5;
/** "21+ after 9pm" keeps applying past midnight; treat anything before 4am as the same night. */
const LATE_NIGHT_ENDS_MINUTE = 4 * 60;

const DIET_COLUMN = { vegetarian: "vegetarian", vegan: "vegan", gluten_free: "glutenFree" } as const;

export function searchRestaurants(catalog: CatalogRestaurant[], filters: SearchFilters): SearchResult {
  const result: SearchResult = { candidates: [], excluded: [] };
  for (const restaurant of catalog) {
    const reasons = exclusionReasons(restaurant, filters);
    if (reasons.length === 0) result.candidates.push(restaurant);
    else result.excluded.push({ id: restaurant.id, name: restaurant.name, reasons });
  }
  return result;
}

/** Every hard constraint a restaurant fails, so the inspector can show why it was ruled out. */
export function exclusionReasons(restaurant: CatalogRestaurant, filters: SearchFilters): Exclusion[] {
  const reasons: Exclusion[] = [];
  const { day, minute, daysFromToday } = filters.arrival;
  const arrivalText = `${DAY_NAMES[day]} ${formatMinute(minute)}`;

  if (!isOpenAt(restaurant.hours, day, minute)) {
    reasons.push({ code: "closed", detail: `closed at ${arrivalText}` });
  } else if (!isOpenThrough(restaurant.hours, day, minute, MIN_VISIT_MINUTES)) {
    reasons.push({ code: "closing_soon", detail: `closes within ${MIN_VISIT_MINUTES} min of ${arrivalText}` });
  }

  for (const diet of filters.diets) {
    if (restaurant[DIET_COLUMN[diet]] === "none") {
      reasons.push({ code: "diet", detail: `nothing ${diet.replace("_", "-")}` });
    }
  }

  if (filters.withKids) {
    if (restaurant.kids === "avoid" || restaurant.kids === "not_allowed") {
      reasons.push({ code: "not_for_kids", detail: `kids: ${restaurant.kids.replace("_", " ")}` });
    } else if (isAdultsOnlyAt(restaurant.adultsOnlyFromMinute, minute)) {
      reasons.push({ code: "adults_only", detail: `21+ at ${formatMinute(minute)}` });
    }
  }

  if (filters.partySize !== null) {
    if (filters.partySize < restaurant.minPartySize) {
      reasons.push({ code: "party_too_small", detail: `needs at least ${restaurant.minPartySize} people` });
    }
    if (filters.partySize >= LARGE_PARTY_SIZE && restaurant.groups === "small_only") {
      reasons.push({ code: "too_small_for_group", detail: `too small for ${filters.partySize}` });
    }
  }

  if (filters.maxPriceTier !== null && restaurant.priceTier > filters.maxPriceTier) {
    reasons.push({ code: "over_budget", detail: `${"$".repeat(restaurant.priceTier)} is over budget` });
  }

  if (filters.cities.length > 0 && !filters.cities.includes(restaurant.city)) {
    reasons.push({ code: "outside_area", detail: `in ${restaurant.city}` });
  }

  if (filters.avoidCashOnly && restaurant.cashOnly) {
    reasons.push({ code: "cash_only", detail: "cash only" });
  }

  if (restaurant.bookingLeadDays > daysFromToday) {
    reasons.push({ code: "books_out", detail: `books out about ${restaurant.bookingLeadDays} days ahead` });
  }

  if (filters.excludeIds.includes(restaurant.id)) {
    reasons.push({ code: "already_rejected", detail: "user already passed on it" });
  }

  return reasons;
}

function isAdultsOnlyAt(adultsOnlyFromMinute: number | null, minute: number): boolean {
  if (adultsOnlyFromMinute === null) return false;
  return minute >= adultsOnlyFromMinute || minute < LATE_NIGHT_ENDS_MINUTE;
}

/** 1290 -> "9:30pm" */
export function formatMinute(minute: number): string {
  const hour24 = Math.floor(minute / 60) % 24;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minutes = minute % 60;
  return `${hour12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}${hour24 < 12 ? "am" : "pm"}`;
}
