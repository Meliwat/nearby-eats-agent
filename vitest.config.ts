import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// Database tests write rows, so they run only against an explicit TEST_DATABASE_URL (a Neon branch
// for tests or CI), never the app's DATABASE_URL. Without one, they skip.
const localEnv = existsSync(".env.local") ? parseEnv(readFileSync(".env.local", "utf8")) : {};
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? localEnv.TEST_DATABASE_URL ?? "";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
