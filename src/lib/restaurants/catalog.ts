import type { restaurants } from "@/db/schema";
import { RESTAURANT_ATTRIBUTES } from "./attributes";
import type { OpenInterval } from "./hours";
import type { SourceRestaurant } from "./parse-source";

/** A restaurants row plus its open periods: the shape search works on. */
export type CatalogRestaurant = typeof restaurants.$inferSelect & { hours: OpenInterval[] };

/** Joins a parsed source entry with its hand-checked flags into a restaurants row. */
export function toRestaurantRow(source: SourceRestaurant) {
  const attributes = RESTAURANT_ATTRIBUTES.find((a) => a.id === source.id);
  if (!attributes) throw new Error(`No attribute flags for #${source.id} ${source.name}`);
  const { id, name, address, city, cuisines, priceTier, hoursText, context } = source;
  return { ...attributes, id, name, address, city, cuisines, priceTier, hoursText, context };
}

/** The catalog built straight from the source file, without a database: what seeding then loading produces. */
export function catalogFromSource(sources: SourceRestaurant[]): CatalogRestaurant[] {
  return sources.map((source) => ({ ...toRestaurantRow(source), hours: source.hours }));
}
