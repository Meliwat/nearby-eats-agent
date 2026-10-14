/**
 * Loads data/restaurants.txt plus the hand-checked attribute flags into Postgres.
 * Idempotent: restaurants are upserted by their source id and hours are replaced.
 * Usage: pnpm db:seed
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { restaurantHours, restaurants } from "../src/db/schema";
import { toRestaurantRow } from "../src/lib/restaurants/catalog";
import { parseRestaurantFile } from "../src/lib/restaurants/parse-source";

const source = parseRestaurantFile(readFileSync("data/restaurants.txt", "utf8"));

const restaurantRows = source.map(toRestaurantRow);

const hourRows = source.flatMap((restaurant) =>
  restaurant.hours.map((interval) => ({ restaurantId: restaurant.id, ...interval })),
);

// Columns to overwrite when a restaurant already exists: everything except the id.
const updateOnConflict = Object.fromEntries(
  Object.keys(restaurantRows[0])
    .filter((column) => column !== "id")
    .map((column) => [column, sql.raw(`excluded.${toSnakeCase(column)}`)]),
);

async function main() {
  // One batch = one transaction, so a failed seed never leaves half-replaced hours.
  await db.batch([
    db.insert(restaurants).values(restaurantRows).onConflictDoUpdate({ target: restaurants.id, set: updateOnConflict }),
    db.delete(restaurantHours),
    db.insert(restaurantHours).values(hourRows),
  ]);
  console.log(`Seeded ${restaurantRows.length} restaurants and ${hourRows.length} open periods.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function toSnakeCase(camel: string): string {
  return camel.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
