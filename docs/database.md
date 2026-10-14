# Database architecture

Postgres on Neon, accessed only by the Next.js server through Drizzle. The schema lives in
[`src/db/schema.ts`](../src/db/schema.ts); the SQL it generates is in [`drizzle/`](../drizzle).
Production runs on Neon's `main` branch, local development on a `dev` branch, and every CI run
on a throwaway branch.

```mermaid
erDiagram
    users ||--o{ conversations : "has"
    users ||--o{ user_facts : "is described by"
    users ||--o{ group_votes : "casts"
    conversations ||--o{ messages : "contains"
    conversations ||--o{ agent_events : "logs"
    conversations ||--o{ recommendations : "produced"
    conversations ||--o{ group_polls : "started"
    conversations ||--o{ user_facts : "learned in"
    messages ||--o{ agent_events : "triggered (turn)"
    messages ||--o{ user_facts : "source of"
    user_facts |o--o{ user_facts : "supersedes"
    restaurants ||--o{ restaurant_hours : "open during"
    restaurants ||--o{ recommendations : "recommended as"
    restaurants ||--o{ group_poll_options : "offered as"
    group_polls ||--o{ group_poll_options : "offers"
    group_poll_options ||--o{ group_votes : "receives"

    users {
        uuid id PK "random, kept in an httpOnly cookie"
        timestamptz created_at
    }
    conversations {
        uuid id PK
        uuid user_id FK
        timestamptz created_at
    }
    messages {
        uuid id PK
        uuid conversation_id FK
        enum role "user | assistant"
        text content "visible transcript only"
        timestamptz created_at
    }
    user_facts {
        uuid id PK
        uuid user_id FK
        uuid conversation_id FK "where it was learned"
        uuid source_message_id FK "the message it came from"
        text key "diet, kids, party_size, ..."
        text value "at most 100 characters"
        enum scope "user (durable) | conversation (this outing)"
        enum status "active | superseded"
        uuid supersedes FK "the fact this one replaced, set null on delete"
        timestamptz created_at
    }
    agent_events {
        bigint id PK "identity, orders the timeline"
        uuid conversation_id FK
        uuid turn_message_id FK "user message that caused it"
        enum type "model_call | tool_call | fact_change | error"
        jsonb payload "validated with Zod per type"
        int duration_ms
        timestamptz created_at
    }
    recommendations {
        uuid id PK
        uuid conversation_id FK
        int restaurant_id FK
        text reason
        enum status "suggested | accepted | rejected"
        timestamptz created_at
    }
    restaurants {
        int id PK "number from the source file"
        text name
        text address
        text city
        text_array cuisines
        smallint price_tier "1 to 4"
        text hours_text "as written in the source"
        text context "full source description"
        enum vegetarian "great | some | limited | on_request | none | unknown"
        enum vegan "same scale"
        enum gluten_free "same scale"
        enum kids "welcome | ok | avoid | not_allowed"
        enum groups "great | ok | small_only"
        smallint min_party_size
        smallint adults_only_from_minute "null = never 21+"
        boolean cash_only
        smallint booking_lead_days
    }
    restaurant_hours {
        int restaurant_id PK, FK
        smallint day PK "0 = Sunday"
        smallint open_minute PK
        smallint close_minute "over 1440 = past midnight"
    }
    group_polls {
        uuid id PK "unguessable, the share link"
        uuid conversation_id FK
        timestamptz created_at
    }
    group_poll_options {
        uuid poll_id PK, FK
        int restaurant_id PK, FK
        smallint position
        text reason "shown to friends"
    }
    group_votes {
        uuid id PK
        uuid poll_id FK "composite FK to the option"
        int restaurant_id FK "composite FK to the option"
        uuid voter_id FK
        text voter_name
        text note "untrusted, reaches the model only via a tool result"
        timestamptz created_at
    }
    rate_limit_counters {
        text bucket PK "e.g. chat:ip, tokens:global"
        text key PK "user id, IP (IPv6 by /64), or all"
        timestamptz window_start PK
        int count
    }
```

## What holds conversation state

Nothing lives in server memory between requests (serverless functions don't keep any). Each
turn rebuilds the model's context from the database:

| Source | Role in the conversation |
|---|---|
| `messages` | The last 30 visible messages, which the model re-reads every turn. |
| `agent_events` (latest search) | The hard constraints the conversation's last search applied, carried into this turn's searches. |
| `agent_events` (tool calls only) | A one-line-per-call trace placed before each past reply, so the model remembers what it *did* (searched, picked), not just what it said. Never the full tool results. |
| `user_facts` (status = active) | What the agent currently believes: durable `user` facts plus this conversation's `conversation` facts. |
| `recommendations` + `restaurants` | What was already suggested and how the person reacted. Rejected places are excluded from later searches. |
| `group_polls` + `group_poll_options` + `group_votes` | Vote counts per poll option. Voter names and notes are not put in the context; the model reads them only through a tool call. |

`agent_events` is also the observability log: every model call (input, cache-read and
cache-write tokens, latency, stop reason), tool call (input, output, error flag), and fact change,
tied to the user message that caused it. The inspector panel renders it.

`rate_limit_counters` holds fixed-window request counters (per IP, per user, global turns and
tokens per day). Counters older than two days are deleted on the first chat of each day.

## Invariants the database enforces

- **One current value per fact, per scope:** two partial unique indexes on `user_facts`, each
  `WHERE status = 'active'`. Durable facts are unique per `(user_id, key)` where `scope = 'user'`;
  situational facts are unique per `(conversation_id, key)` where `scope = 'conversation'`, so
  "party of 4" in one chat never collides with another chat. A change of mind marks the old row
  `superseded` and inserts the new row pointing back at it, in one transaction.
- **A vote is for a real option in that poll:** `group_votes (poll_id, restaurant_id)` is a
  composite foreign key to `group_poll_options`.
- **One vote per person per poll:** a unique index on `group_votes (poll_id, voter_id)`; voting
  again updates the row.
- **Sane catalog data:** check constraints on `price_tier` (1 to 4), `day` (0 to 6), and
  `close_minute > open_minute`.
- **Atomic counters:** `rate_limit_counters` is keyed by `(bucket, key, window_start)`, and each
  request does `INSERT ... ON CONFLICT DO UPDATE SET count = count + n`.

## Deletion

Deleting a user removes everything they own (cascading foreign keys); restaurants are never
cascaded. The app has no "delete conversation" action. If one were added: a fact's provenance
(`conversation_id`, `source_message_id`) cascades, so durable facts learned in that conversation
would be deleted with it, and a later fact that had superseded one of them keeps working with its
`supersedes` link set to null.

## Why this shape

- **Facts as rows, not a profile blob:** each fact knows where it came from, and history survives
  changes of mind.
- **One event table with a typed `jsonb` payload:** it maps 1:1 to the `AgentEvent` TypeScript
  union, so the server, the database, and the inspector share one contract. Tradeoff: SQL can't
  constrain fields inside the payload, so Zod validates before insert.
- **Restaurants in the database:** recommendations, polls, and votes reference real rows. The
  hard-constraint filtering itself runs in TypeScript over the 50 rows so it can report *why*
  each place was excluded; at a larger scale the same predicates would move into SQL.
