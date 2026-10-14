import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");

/**
 * Stateless HTTP driver: no connection pool to manage in serverless functions.
 * Multi-statement writes that must be atomic go through db.batch(), which Neon runs
 * as a single transaction.
 */
export const db = drizzle({ client: neon(url), schema, casing: "snake_case" });
