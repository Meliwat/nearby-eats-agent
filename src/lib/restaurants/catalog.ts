import type { restaurants } from "@/db/schema";
import type { RestaurantAttributes } from "./attributes";
import type { OpenInterval } from "./hours";
import type { SourceRestaurant } from "./parse-source";

/** A restaurants row plus its open periods: the shape search works on. */
export type CatalogRestaurant = typeof restaurants.$inferSelect & { hours: OpenInterval[] };

/** Joins a parsed source entry with its hand-checked flags into a restaurants row. */
export function toRestaurantRow(source: SourceRestaurant, attributes: RestaurantAttributes) {
  const { id, name, address, city, cuisines, priceTier, hoursText, context } = source;
  return { ...attributes, id, name, address, city, cuisines, priceTier, hoursText, context };
}
