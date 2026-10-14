import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { recommendations } from "@/db/schema";
import type { CatalogRestaurant } from "@/lib/restaurants/catalog";
import { DAY_NAMES, toLocalDayMinute, type DayOfWeek } from "@/lib/restaurants/hours";
import { formatMinute, searchRestaurants, type SearchResult } from "@/lib/restaurants/search";
import { FACT_KEY_NAMES, FACT_KEYS, rememberFact, type FactChange } from "./facts";

export const TIME_ZONE = "America/Los_Angeles";

/** Per-turn state the tools read and update. */
export interface ToolContext {
  userId: string;
  conversationId: string;
  turnMessageId: string;
  now: Date;
  catalog: CatalogRestaurant[];
  /** Restaurants the user turned down in this conversation; search never returns them. */
  rejectedIds: Set<number>;
  /** The most recent search this turn; recommend_restaurant must pick one of its candidates. */
  lastSearch: SearchResult | null;
}

export interface ToolOutcome {
  output: unknown;
  isError: boolean;
  factChanges: FactChange[];
}

const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use 24-hour HH:MM")
  .describe('24-hour local time, e.g. "19:30"');

function buildInputSchemas(cities: string[]) {
  return {
    search_restaurants: z.strictObject({
      days_from_today: z
        .number()
        .int()
        .min(0)
        .max(60)
        .nullable()
        .describe("0 for today, 1 for tomorrow, and so on. Null means today."),
      time: clockTime.nullable().describe('Arrival time as 24-hour "HH:MM". Null means right now (today only).'),
      diets: z.array(z.enum(["vegetarian", "vegan", "gluten_free"])).describe("Dietary needs anyone in the party has"),
      with_kids: z.boolean().describe("True if kids are coming"),
      party_size: z.number().int().min(1).max(30).nullable().describe("Number of people, if known"),
      max_price_tier: z
        .number()
        .int()
        .min(1)
        .max(4)
        .nullable()
        .describe("1=$ (under $15/person), 2=$$ ($15-30), 3=$$$ ($30-60), 4=$$$$ ($60+)"),
      cities: z.array(z.enum(cities as [string, ...string[]])).describe("Limit to these cities. Empty for anywhere."),
      avoid_cash_only: z.boolean().describe("True if they can't pay cash"),
    }),
    get_restaurant: z.strictObject({
      name: z.string().describe("Restaurant name, or part of it"),
    }),
    remember_fact: z.strictObject({
      key: z.enum(FACT_KEY_NAMES).describe(
        Object.entries(FACT_KEYS)
          .map(([key, { description }]) => `${key}: ${description}`)
          .join("; "),
      ),
      value: z.string().describe("Short normalized value, e.g. \"vegetarian\" or \"4 people\""),
    }),
    recommend_restaurant: z.strictObject({
      restaurant_id: z.number().int().describe("id of a candidate from the latest search_restaurants call"),
      reason: z.string().describe("One or two sentences tying this place to what the user said"),
    }),
    update_recommendation: z.strictObject({
      restaurant_id: z.number().int(),
      status: z.enum(["accepted", "rejected"]).describe("accepted: they're going. rejected: they passed on it."),
    }),
  };
}

const TOOL_DESCRIPTIONS: Record<keyof ReturnType<typeof buildInputSchemas>, string> = {
  search_restaurants:
    "Find restaurants that satisfy the user's hard constraints at a given arrival time. Returns candidates with their full descriptions, plus every excluded restaurant and why. Call this before every recommendation.",
  get_restaurant: "Look up one restaurant by name, e.g. when the user asks about a specific place.",
  remember_fact:
    "Save something you learned about the user so it is used later. Call it whenever they reveal or change a preference, constraint, or plan. A new value replaces the old one.",
  recommend_restaurant:
    "Record your recommendation. The restaurant must be a candidate from the most recent search this turn.",
  update_recommendation: "Record whether the user accepted or turned down a place you recommended.",
};

/** Strict tool schemas reject numeric and string constraints; Zod still enforces them client-side. */
const UNSUPPORTED_SCHEMA_KEYS = new Set(["$schema", "minimum", "maximum", "pattern", "minLength", "maxLength"]);

function toApiSchema(schema: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node === null || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.entries(node).filter(([key]) => !UNSUPPORTED_SCHEMA_KEYS.has(key)).map(([key, value]) => [key, strip(value)]),
    );
  };
  return strip(z.toJSONSchema(schema)) as Anthropic.Beta.BetaTool.InputSchema;
}

/** Tool definitions and their input validators, derived from the catalog so city names are an enum. */
export function buildTools(catalog: CatalogRestaurant[]) {
  const cities = [...new Set(catalog.map((r) => r.city))].sort();
  const schemas = buildInputSchemas(cities);
  const definitions: Anthropic.Beta.BetaTool[] = Object.entries(schemas).map(([name, schema]) => ({
    name,
    description: TOOL_DESCRIPTIONS[name as keyof typeof schemas],
    input_schema: toApiSchema(schema),
    strict: true,
  }));
  return { definitions, schemas };
}

export type ToolSchemas = ReturnType<typeof buildTools>["schemas"];

/** Validates the model's input, runs the tool, and reports errors back to the model instead of throwing. */
export async function executeTool(
  name: string,
  rawInput: unknown,
  schemas: ToolSchemas,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  if (!(name in schemas)) return failure(`Unknown tool "${name}". Available: ${Object.keys(schemas).join(", ")}`);
  const parsed = schemas[name as keyof ToolSchemas].safeParse(rawInput);
  if (!parsed.success) return failure(`Invalid input: ${z.prettifyError(parsed.error)}`);
  const input = parsed.data;

  switch (name) {
    case "search_restaurants":
      return runSearch(input as z.infer<ToolSchemas["search_restaurants"]>, ctx);
    case "get_restaurant":
      return runGetRestaurant(input as z.infer<ToolSchemas["get_restaurant"]>, ctx);
    case "remember_fact": {
      const { key, value } = input as z.infer<ToolSchemas["remember_fact"]>;
      const change = await rememberFact({
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        sourceMessageId: ctx.turnMessageId,
        key,
        value,
      });
      return { output: change, isError: false, factChanges: [change] };
    }
    case "recommend_restaurant":
      return runRecommend(input as z.infer<ToolSchemas["recommend_restaurant"]>, ctx);
    case "update_recommendation":
      return runUpdateRecommendation(input as z.infer<ToolSchemas["update_recommendation"]>, ctx);
    default:
      return failure(`Unhandled tool "${name}"`);
  }
}

function runSearch(input: z.infer<ToolSchemas["search_restaurants"]>, ctx: ToolContext): ToolOutcome {
  const daysFromToday = input.days_from_today ?? 0;
  if (daysFromToday > 0 && input.time === null) return failure("time is required when searching a future day");

  const local = toLocalDayMinute(ctx.now, TIME_ZONE);
  const day = ((local.day + daysFromToday) % 7) as DayOfWeek;
  const minute = input.time === null ? local.minute : clockToMinute(input.time);

  const result = searchRestaurants(ctx.catalog, {
    arrival: { day, minute, daysFromToday },
    diets: input.diets,
    withKids: input.with_kids,
    partySize: input.party_size,
    maxPriceTier: input.max_price_tier,
    cities: input.cities,
    avoidCashOnly: input.avoid_cash_only,
    excludeIds: [...ctx.rejectedIds],
  });
  ctx.lastSearch = result;

  return {
    isError: false,
    factChanges: [],
    output: {
      arrival: `${DAY_NAMES[day]} ${formatMinute(minute)}`,
      candidate_count: result.candidates.length,
      candidates: result.candidates.map(describeForModel),
      excluded: result.excluded.map((e) => `${e.name}: ${e.reasons.map((r) => r.detail).join("; ")}`),
    },
  };
}

function runGetRestaurant(input: z.infer<ToolSchemas["get_restaurant"]>, ctx: ToolContext): ToolOutcome {
  const query = input.name.toLowerCase();
  const matches = ctx.catalog.filter((r) => r.name.toLowerCase().includes(query));
  if (matches.length === 0) return failure(`No restaurant matches "${input.name}"`);
  return { output: matches.map(describeForModel), isError: false, factChanges: [] };
}

async function runRecommend(input: z.infer<ToolSchemas["recommend_restaurant"]>, ctx: ToolContext): Promise<ToolOutcome> {
  // Grounding check: the model may only recommend what the code verified this turn.
  if (!ctx.lastSearch) return failure("Call search_restaurants first so the user's constraints are checked.");
  const candidate = ctx.lastSearch.candidates.find((r) => r.id === input.restaurant_id);
  if (!candidate) {
    const excluded = ctx.lastSearch.excluded.find((e) => e.id === input.restaurant_id);
    const why = excluded ? excluded.reasons.map((r) => r.detail).join("; ") : "not in the catalog";
    return failure(`Restaurant ${input.restaurant_id} is not a candidate (${why}). Pick from the latest candidates.`);
  }

  await db.insert(recommendations).values({
    conversationId: ctx.conversationId,
    restaurantId: candidate.id,
    reason: input.reason,
  });
  return {
    isError: false,
    factChanges: [],
    output: { recommended: candidate.name, address: candidate.address, hours: candidate.hoursText, reason: input.reason },
  };
}

async function runUpdateRecommendation(
  input: z.infer<ToolSchemas["update_recommendation"]>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const [latest] = await db
    .select({ id: recommendations.id })
    .from(recommendations)
    .where(and(eq(recommendations.conversationId, ctx.conversationId), eq(recommendations.restaurantId, input.restaurant_id)))
    .orderBy(desc(recommendations.createdAt))
    .limit(1);
  if (!latest) return failure(`Restaurant ${input.restaurant_id} was not recommended in this conversation.`);

  await db.update(recommendations).set({ status: input.status }).where(eq(recommendations.id, latest.id));
  if (input.status === "rejected") ctx.rejectedIds.add(input.restaurant_id);
  return { output: { restaurant_id: input.restaurant_id, status: input.status }, isError: false, factChanges: [] };
}

/** What the model sees about a restaurant: the hard facts plus the full source description. */
function describeForModel(r: CatalogRestaurant) {
  return {
    id: r.id,
    name: r.name,
    city: r.city,
    cuisine: r.cuisines.join(", "),
    price: "$".repeat(r.priceTier),
    hours: r.hoursText,
    vegetarian: r.vegetarian,
    vegan: r.vegan,
    gluten_free: r.glutenFree,
    kids: r.kids,
    groups: r.groups,
    cash_only: r.cashOnly,
    description: r.context,
  };
}

function clockToMinute(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function failure(message: string): ToolOutcome {
  return { output: { error: message }, isError: true, factChanges: [] };
}
