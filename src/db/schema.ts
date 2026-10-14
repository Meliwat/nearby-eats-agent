import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Restaurant catalog: seeded from data/restaurants.txt, read-only at runtime.
// ---------------------------------------------------------------------------

export const dietSupport = pgEnum("diet_support", ["great", "some", "limited", "on_request", "none", "unknown"]);
export const kidPolicy = pgEnum("kid_policy", ["welcome", "ok", "avoid", "not_allowed"]);
export const groupFit = pgEnum("group_fit", ["great", "ok", "small_only"]);

export const restaurants = pgTable(
  "restaurants",
  {
    // The number from the source file, so seeding is idempotent and ids are stable.
    id: integer().primaryKey(),
    name: text().notNull(),
    address: text().notNull(),
    city: text().notNull(),
    cuisines: text().array().notNull(),
    priceTier: smallint().notNull(),
    hoursText: text().notNull(),
    context: text().notNull(),
    vegetarian: dietSupport().notNull(),
    vegan: dietSupport().notNull(),
    glutenFree: dietSupport().notNull(),
    kids: kidPolicy().notNull(),
    groups: groupFit().notNull(),
    minPartySize: smallint().notNull(),
    adultsOnlyFromMinute: smallint(),
    cashOnly: boolean().notNull(),
    bookingLeadDays: smallint().notNull(),
  },
  (table) => [check("price_tier_range", sql`${table.priceTier} between 1 and 4`)],
);

/** One row per open period. close_minute past 1440 means the period runs past midnight. */
export const restaurantHours = pgTable(
  "restaurant_hours",
  {
    restaurantId: integer()
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    day: smallint().notNull(),
    openMinute: smallint().notNull(),
    closeMinute: smallint().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.restaurantId, table.day, table.openMinute] }),
    index("restaurant_hours_day_idx").on(table.day),
    check("day_range", sql`${table.day} between 0 and 6`),
    check("close_after_open", sql`${table.closeMinute} > ${table.openMinute}`),
  ],
);

// ---------------------------------------------------------------------------
// Conversation state: who is talking, what was said, what we learned.
// ---------------------------------------------------------------------------

/** Anonymous visitor, identified by a random uuid in an httpOnly cookie. */
export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("conversations_user_idx").on(table.userId)],
);

export const messageRole = pgEnum("message_role", ["user", "assistant"]);

/**
 * The visible chat transcript. Tool calls are not stored here: each turn rebuilds the
 * model's context from this transcript plus the user's active facts, and the full
 * tool-call detail lives in agent_events.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRole().notNull(),
    content: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("messages_conversation_idx").on(table.conversationId, table.createdAt)],
);

export const factStatus = pgEnum("fact_status", ["active", "superseded"]);

/**
 * "user": durable preferences that carry into future conversations (diet, kids).
 * "conversation": situational details that only apply to this request (party size tonight).
 */
export const factScope = pgEnum("fact_scope", ["user", "conversation"]);

/**
 * What the agent has learned about a user, one row per fact. A change of mind marks the old
 * row superseded and inserts a new row that points back at it, so history is kept.
 */
export const userFacts = pgTable(
  "user_facts",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The conversation and message the fact was learned from (provenance).
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sourceMessageId: uuid()
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    key: text().notNull(),
    value: text().notNull(),
    scope: factScope().notNull(),
    status: factStatus().notNull().default("active"),
    // The fact this one replaced, if any. Points backward so the old row already exists.
    supersedes: uuid().references((): AnyPgColumn => userFacts.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The database guarantees one current value per key; history lives in superseded rows.
    uniqueIndex("user_facts_one_active_per_key")
      .on(table.userId, table.key)
      .where(sql`${table.status} = 'active'`),
  ],
);

// ---------------------------------------------------------------------------
// Observability: everything the agent did, in order.
// ---------------------------------------------------------------------------

export const agentEventType = pgEnum("agent_event_type", ["model_call", "tool_call", "fact_change", "error"]);

/**
 * Append-only log of agent activity. The payload shape depends on `type` and is validated
 * with Zod before insert (see src/agent/events.ts). Ordering within a conversation is by id.
 */
export const agentEvents = pgTable(
  "agent_events",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // The user message whose turn produced this event.
    turnMessageId: uuid()
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    type: agentEventType().notNull(),
    payload: jsonb().notNull(),
    durationMs: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agent_events_conversation_idx").on(table.conversationId, table.id)],
);

export const recommendationStatus = pgEnum("recommendation_status", ["suggested", "accepted", "rejected"]);

/** Places the agent actually recommended, so it never re-suggests a rejected one. */
export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid().primaryKey().defaultRandom(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    restaurantId: integer()
      .notNull()
      .references(() => restaurants.id),
    reason: text().notNull(),
    status: recommendationStatus().notNull().default("suggested"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("recommendations_conversation_idx").on(table.conversationId)],
);
