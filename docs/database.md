# Database architecture

Postgres on Neon, accessed only by the Next.js server through Drizzle. The schema lives in
[`src/db/schema.ts`](../src/db/schema.ts); the SQL it generates is in [`drizzle/`](../drizzle).

```mermaid
erDiagram
    users ||--o{ conversations : "has"
    users ||--o{ user_facts : "is described by"
    conversations ||--o{ messages : "contains"
    conversations ||--o{ agent_events : "logs"
    conversations ||--o{ recommendations : "produced"
    conversations ||--o{ group_polls : "started"
    conversations ||--o{ user_facts : "learned in"
    messages ||--o{ agent_events : "triggered (turn)"
    messages ||--o{ user_facts : "source of"
    user_facts |o--o| user_facts : "supersedes"
    restaurants ||--|{ restaurant_hours : "open during"
    restaurants ||--o{ recommendations : "recommended as"
    restaurants ||--o{ group_poll_options : "offered as"
    group_polls ||--|{ group_poll_options : "offers"
    group_poll_options ||--o{ group_votes : "receives"
    users ||--o{ group_votes : "casts"

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
        text value
        enum scope "user (durable) | conversation (this outing)"
        enum status "active | superseded"
        uuid supersedes FK "the fact this one replaced"
    }
    agent_events {
        bigint id PK "identity, orders the timeline"
        uuid conversation_id FK
        uuid turn_message_id FK "user message that caused it"
        enum type "model_call | tool_call | fact_change | error"
        jsonb payload "validated with Zod per type"
        int duration_ms
    }
    recommendations {
        uuid id PK
        uuid conversation_id FK
        int restaurant_id FK
        text reason
        enum status "suggested | accepted | rejected"
    }
    restaurants {
        int id PK "number from the source file"
        text name
        text city
        text_array cuisines
        smallint price_tier "1-4"
        text context "full source description"
        enum vegetarian_vegan_gluten_free "great ... none, unknown"
        enum kids "welcome | ok | avoid | not_allowed"
        enum groups "great | ok | small_only"
        smallint min_party_size
        smallint adults_only_from_minute
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
    }
```

## What holds conversation state

Nothing lives in server memory between requests (serverless functions don't keep any). Each
turn rebuilds the model's context from three tables:

| Table | Role in the conversation |
|---|---|
| `messages` | The visible transcript the model re-reads every turn. |
| `user_facts` (status = active) | What the agent currently believes about the person: durable `user` facts plus this conversation's `conversation` facts. |
| `recommendations` | What was already suggested and how the person reacted. Rejected places are excluded from later searches. |

`agent_events` is the observability log: every model call (tokens, latency, stop reason), tool
call (input, output, error flag), and fact change, tied to the user message that caused it. The
inspector panel renders it. It also gives the model memory of its own actions: before each past
reply, the rebuilt transcript includes a one-line-per-call summary of that turn's tool calls
(never the full results), so the model knows its earlier picks were searched and verified.

## Invariants the database enforces

- **One current value per fact:** a partial unique index on `user_facts (user_id, key) WHERE status = 'active'`.
  A change of mind marks the old row `superseded` and inserts the new row pointing back at it, in one transaction.
- **A vote is for a real option in that poll:** `group_votes (poll_id, restaurant_id)` is a composite foreign key to `group_poll_options`.
- **One vote per person per poll:** a unique index on `group_votes (poll_id, voter_id)`; voting again updates the row.
- **Hours are sane:** check constraints on `day` (0-6) and `close_minute > open_minute`.
- **Deleting a user removes everything they own** (cascading foreign keys); restaurants are never cascaded.

## Why this shape

- **Facts as rows, not a profile blob:** each fact knows where it came from, and history survives changes of mind.
- **One event table with a typed `jsonb` payload:** it maps 1:1 to the `AgentEvent` TypeScript union, so the server, the database, and the inspector share one contract. Tradeoff: SQL can't constrain fields inside the payload, so Zod validates before insert.
- **Restaurants in the database:** recommendations, polls, and votes reference real rows. The hard-constraint filtering itself runs in TypeScript over the 50 rows so it can report *why* each place was excluded; at a larger scale the same predicates would move into SQL.
