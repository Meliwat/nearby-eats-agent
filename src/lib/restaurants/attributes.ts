/**
 * Hand-checked flags for the hard constraints search enforces in code.
 * Each value is a judgment read from the entry's Context text in data/restaurants.txt;
 * nuance stays in that text, which the model reads for the soft fit.
 */

/** How well a place serves a diet. "unknown" means the source doesn't say. */
export type DietSupport = "great" | "some" | "limited" | "on_request" | "none" | "unknown";

/** "avoid": allowed but the source says it is not a kid place. */
export type KidPolicy = "welcome" | "ok" | "avoid" | "not_allowed";

/** "small_only": tiny room or the source warns against groups (roughly 5+). */
export type GroupFit = "great" | "ok" | "small_only";

export interface RestaurantAttributes {
  id: number;
  name: string;
  vegetarian: DietSupport;
  vegan: DietSupport;
  glutenFree: DietSupport;
  kids: KidPolicy;
  groups: GroupFit;
  /** Smallest party the place will seat, when the source states one. */
  minPartySize: number;
  /** Minute of day from which it is 21+ (0 = always), or null if never. */
  adultsOnlyFromMinute: number | null;
  cashOnly: boolean;
  /** How far ahead you realistically need to book, when the source says. */
  bookingLeadDays: number;
}

const ALWAYS = 0;
const NINE_PM = 21 * 60;
const TEN_PM = 22 * 60;

type Row = Omit<RestaurantAttributes, "minPartySize" | "adultsOnlyFromMinute" | "cashOnly" | "bookingLeadDays"> &
  Partial<RestaurantAttributes>;

const ROWS: Row[] = [
  { id: 1, name: "Pollo Verde", vegetarian: "unknown", vegan: "unknown", glutenFree: "on_request", kids: "welcome", groups: "ok" },
  { id: 2, name: "Saffron House", vegetarian: "great", vegan: "on_request", glutenFree: "unknown", kids: "ok", groups: "great" },
  { id: 3, name: "Crust & Crumb", vegetarian: "great", vegan: "some", glutenFree: "unknown", kids: "ok", groups: "ok" },
  { id: 4, name: "Ironwood Subs", vegetarian: "limited", vegan: "unknown", glutenFree: "unknown", kids: "ok", groups: "small_only" },
  { id: 5, name: "Kettle Ramen Bar", vegetarian: "some", vegan: "some", glutenFree: "on_request", kids: "ok", groups: "small_only" },
  { id: 6, name: "Bluebird Cafe", vegetarian: "limited", vegan: "unknown", glutenFree: "unknown", kids: "welcome", groups: "ok", cashOnly: true },
  { id: 7, name: "Slice Theory Pizza", vegetarian: "great", vegan: "some", glutenFree: "unknown", kids: "ok", groups: "ok" },
  { id: 8, name: "Hearth & Hen", vegetarian: "none", vegan: "none", glutenFree: "unknown", kids: "ok", groups: "great" },
  { id: 9, name: "Cocoa Lane", vegetarian: "great", vegan: "some", glutenFree: "some", kids: "welcome", groups: "small_only" },
  { id: 10, name: "Nonna Rosa Pizzeria", vegetarian: "some", vegan: "limited", glutenFree: "unknown", kids: "welcome", groups: "great" },
  { id: 11, name: "Vista Pizza Co", vegetarian: "some", vegan: "on_request", glutenFree: "unknown", kids: "ok", groups: "great" },
  { id: 12, name: "Tacos El Camino", vegetarian: "limited", vegan: "unknown", glutenFree: "unknown", kids: "ok", groups: "ok" },
  { id: 13, name: "Verdant Kitchen", vegetarian: "great", vegan: "great", glutenFree: "great", kids: "avoid", groups: "ok" },
  { id: 14, name: "Mangal Grill", vegetarian: "great", vegan: "some", glutenFree: "unknown", kids: "welcome", groups: "great" },
  { id: 15, name: "Harbor Gyro House", vegetarian: "some", vegan: "unknown", glutenFree: "unknown", kids: "ok", groups: "small_only" },
  { id: 16, name: "The Blue Anchor", vegetarian: "none", vegan: "none", glutenFree: "some", kids: "ok", groups: "ok" },
  { id: 17, name: "Sabor Noodle Bar", vegetarian: "some", vegan: "unknown", glutenFree: "unknown", kids: "welcome", groups: "ok", cashOnly: true },
  { id: 18, name: "Olive & Thyme Bistro", vegetarian: "great", vegan: "on_request", glutenFree: "unknown", kids: "avoid", groups: "ok" },
  { id: 19, name: "Seoul Fire BBQ", vegetarian: "none", vegan: "none", glutenFree: "unknown", kids: "ok", groups: "great", minPartySize: 2 },
  { id: 20, name: "Little Deli", vegetarian: "limited", vegan: "none", glutenFree: "unknown", kids: "ok", groups: "small_only" },
  { id: 21, name: "Casa Verde", vegetarian: "some", vegan: "some", glutenFree: "unknown", kids: "ok", groups: "great" },
  { id: 22, name: "Prospect Creamery", vegetarian: "great", vegan: "some", glutenFree: "some", kids: "welcome", groups: "ok" },
  { id: 23, name: "Field & Vine", vegetarian: "great", vegan: "on_request", glutenFree: "unknown", kids: "ok", groups: "small_only", bookingLeadDays: 7 },
  { id: 24, name: "Grand Dumplings", vegetarian: "some", vegan: "unknown", glutenFree: "unknown", kids: "welcome", groups: "great", cashOnly: true },
  { id: 25, name: "Walnut Poke", vegetarian: "some", vegan: "unknown", glutenFree: "on_request", kids: "ok", groups: "small_only" },
  { id: 26, name: "First Street Bakery", vegetarian: "great", vegan: "unknown", glutenFree: "unknown", kids: "ok", groups: "small_only", cashOnly: true },
  { id: 27, name: "Villa Wings", vegetarian: "limited", vegan: "none", glutenFree: "unknown", kids: "ok", groups: "great", adultsOnlyFromMinute: NINE_PM },
  { id: 28, name: "Sugarpine", vegetarian: "great", vegan: "some", glutenFree: "some", kids: "ok", groups: "small_only" },
  { id: 29, name: "Mesa Ridge Steakhouse", vegetarian: "none", vegan: "none", glutenFree: "unknown", kids: "ok", groups: "ok" },
  { id: 30, name: "Pho Lantern", vegetarian: "some", vegan: "unknown", glutenFree: "unknown", kids: "welcome", groups: "ok" },
  { id: 31, name: "Zaytoon Grill", vegetarian: "great", vegan: "great", glutenFree: "unknown", kids: "ok", groups: "great" },
  { id: 32, name: "The Copper Pot", vegetarian: "great", vegan: "some", glutenFree: "unknown", kids: "ok", groups: "small_only" },
  { id: 33, name: "Mariscos del Puerto", vegetarian: "limited", vegan: "unknown", glutenFree: "unknown", kids: "welcome", groups: "great" },
  { id: 34, name: "Green Light Juice", vegetarian: "great", vegan: "great", glutenFree: "great", kids: "ok", groups: "small_only" },
  { id: 35, name: "Barrio Tacos y Mezcal", vegetarian: "some", vegan: "unknown", glutenFree: "unknown", kids: "avoid", groups: "ok", adultsOnlyFromMinute: NINE_PM },
  { id: 36, name: "Bay Street Fish Co", vegetarian: "none", vegan: "none", glutenFree: "unknown", kids: "welcome", groups: "ok" },
  { id: 37, name: "Olive Tree Falafel", vegetarian: "great", vegan: "great", glutenFree: "unknown", kids: "ok", groups: "small_only" },
  { id: 38, name: "Rosewood Tea Room", vegetarian: "on_request", vegan: "on_request", glutenFree: "unknown", kids: "ok", groups: "ok" },
  { id: 39, name: "Smoke & Oak BBQ", vegetarian: "limited", vegan: "none", glutenFree: "unknown", kids: "ok", groups: "great" },
  { id: 40, name: "Kinoko Izakaya", vegetarian: "some", vegan: "limited", glutenFree: "unknown", kids: "avoid", groups: "ok", adultsOnlyFromMinute: TEN_PM },
  { id: 41, name: "Mama's Kitchen", vegetarian: "limited", vegan: "unknown", glutenFree: "unknown", kids: "welcome", groups: "ok" },
  { id: 42, name: "Harvest Table", vegetarian: "great", vegan: "some", glutenFree: "some", kids: "welcome", groups: "ok" },
  { id: 43, name: "Noodle Alley", vegetarian: "great", vegan: "great", glutenFree: "unknown", kids: "ok", groups: "small_only" },
  { id: 44, name: "The Cellar Door", vegetarian: "some", vegan: "limited", glutenFree: "unknown", kids: "not_allowed", groups: "ok", adultsOnlyFromMinute: ALWAYS },
  { id: 45, name: "Sunrise Donuts", vegetarian: "great", vegan: "limited", glutenFree: "unknown", kids: "ok", groups: "small_only", cashOnly: true },
  { id: 46, name: "Tandoor & Co", vegetarian: "great", vegan: "great", glutenFree: "some", kids: "welcome", groups: "great" },
  { id: 47, name: "The Lantern Room", vegetarian: "on_request", vegan: "on_request", glutenFree: "unknown", kids: "not_allowed", groups: "ok", bookingLeadDays: 21 },
  { id: 48, name: "Beachwood Burgers", vegetarian: "limited", vegan: "none", glutenFree: "unknown", kids: "welcome", groups: "ok" },
  { id: 49, name: "Sabina's Table", vegetarian: "some", vegan: "limited", glutenFree: "unknown", kids: "ok", groups: "ok" },
  { id: 50, name: "Golden Wok", vegetarian: "limited", vegan: "unknown", glutenFree: "unknown", kids: "welcome", groups: "great" },
];

export const RESTAURANT_ATTRIBUTES: RestaurantAttributes[] = ROWS.map((row) => ({
  minPartySize: 1,
  adultsOnlyFromMinute: null,
  cashOnly: false,
  bookingLeadDays: 0,
  ...row,
}));
