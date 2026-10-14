import { db } from "@/db/client";
import { restaurantHours, restaurants } from "@/db/schema";
import type { DayOfWeek } from "./hours";
import type { CatalogRestaurant } from "./catalog";

let cached: Promise<CatalogRestaurant[]> | null = null;

/**
 * The catalog only changes when the seed script runs, so each server instance loads it once
 * (two queries) and reuses it. A redeploy or cold start picks up a re-seed.
 */
export function loadCatalog(): Promise<CatalogRestaurant[]> {
  cached ??= fetchCatalog().catch((error) => {
    cached = null; // don't cache a failed load
    throw error;
  });
  return cached;
}

async function fetchCatalog(): Promise<CatalogRestaurant[]> {
  const [rows, hours] = await Promise.all([
    db.select().from(restaurants).orderBy(restaurants.id),
    db.select().from(restaurantHours),
  ]);
  return rows.map((row) => ({
    ...row,
    hours: hours
      .filter((h) => h.restaurantId === row.id)
      .map(({ day, openMinute, closeMinute }) => ({ day: day as DayOfWeek, openMinute, closeMinute })),
  }));
}
