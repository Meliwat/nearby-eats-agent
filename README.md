# Nearby

**A restaurant agent you text.** Tell it you're hungry and it answers like a friend who knows Orange County: it asks only what it needs, remembers what you tell it, and ends with one place, the reasons it fits, and what to know before you go. Beside the chat, an inspector shows everything the agent did to get there.

**[Try it live](https://nearby-eats-agent.vercel.app)** &nbsp;·&nbsp; [The prompt, exported](prompts/EXPORTED_PROMPT.md) &nbsp;·&nbsp; [Database architecture](docs/database.md)

---

## A conversation, and what happened underneath

*From testing, lightly trimmed.*

> **You:** where should I eat tonight
>
> **Nearby:** Pretty wide open, so one question: how many of you, and are any kids coming? That decides whether I send you somewhere loud and family-style or somewhere quieter.
>
> **You:** me and my wife plus our 2 kids, she's vegetarian
>
> **Nearby:** Try Mangal Grill in Buena Park. It's a Turkish place that welcomes kids, and the vegetarian mezze is great for your wife, with kebabs for everyone else and plates made for sharing. Get the baklava. Open until 10, no alcohol. I'm assuming you'd eat around 6:30.

What the inspector showed, abbreviated:

```
turn 1   search_restaurants     Wed 7pm: 38 fit, 12 ruled out
         remember_fact          timing = tonight                   (this outing)
         → 38 places fit and kids would change the answer, so it asks exactly one question

turn 2   remember_fact          party_size = 4 people              (this outing)
         remember_fact          party_needs = wife is vegetarian   (this outing)
         remember_fact          kids = 2 kids                      (remembered)
         search_restaurants     [vegetarian; with kids; party of 4]: 28 fit, 22 ruled out
         recommend_restaurant   picked Mangal Grill                (checked against that search)
```

Every pick is checked by code before it reaches you. Every fact is stored with the message it came from. Every model call, tool call, and change to memory is logged and shown as it happens.

---

## What the brief asked for, and how it's met

**It recommends; it doesn't list.** Each turn ends with one place and the reasons it fits *you*: the details you gave, matched against the restaurant's own description, plus one practical note (the wait, the parking, cash only, what to order). A pick must come from the search the agent ran that turn. `recommend_restaurant` refuses anything else, so the agent can't recommend a place that's closed, that ignores your diet, or that it imagined.

**It talks like texting a friend.** Replies stay under about sixty words. The agent recommends early and asks at most one question, and only when the answer would change which restaurant wins. Otherwise it states its assumption out loud ("I'm assuming you'd eat around 6:30") and lets you correct it. Fragments, changes of mind, and answers to a different question are all simply new information.

**It learns as it goes.** What you reveal becomes a fact: one row each, with provenance. The code decides how long a fact lives, never the model. *Vegetarian* is remembered for next time; *party of 6 tonight* belongs to this outing only. When you change your mind, the old fact is marked superseded and the new one points back at it, so the history survives. Ten messages in, the agent knows your diet, your kids, your budget, your part of town, and what you've already turned down.

**It shows its work.** The right half of the screen is a live timeline of every model call (tokens, cache hits, latency, stop reason), every tool call (input, output, errors), and every change to what the agent knows, rendered as a diff. It reads from the same append-only log the agent writes to, so what you see is exactly what happened.

---

## How a turn works

```
browser ──POST /api/chat──▶ runTurn()                               src/agent/loop.ts
                              1. save the message
                              2. rebuild context from Postgres:
                                   the recent transcript, with a trace of each past turn's tool calls
                                   active facts · past picks · poll counts · the time in Orange County
                              3. loop, at most 8 model calls:
                                   Claude ──tool_use──▶ validate (Zod) ──▶ run ──▶ log
                              4. save the reply
        ◀──NDJSON stream────  text, tool activity, and every logged event, live
```

The agent loop is written by hand on the Anthropic SDK, with no agent framework. It is the heart of the project, so every step is readable and every step is logged. Context is rebuilt from the database on every turn; nothing lives in server memory.

| Tool | What the code guarantees |
|---|---|
| `search_restaurants` | Hard constraints, enforced by tested code: open long enough to actually eat, diets, kids and 21+ rules, party size, budget, area, cash, how far ahead it books. Returns the candidates, and why every other place was ruled out. |
| `recommend_restaurant` | Accepts only a candidate from this turn's latest search. |
| `remember_fact` | A fixed vocabulary of keys. The code sets each fact's scope and supersedes old values in one transaction. |
| `update_recommendation` | Records a yes or a no. A place you turn down never comes back in that conversation. |
| `get_restaurant` | Looks up a place you name. |
| `start_group_poll`, `get_poll_results` | The group pick, described below. Poll options must also come from the latest search. |

When a tool call is wrong, the model gets the reason back as a tool error and corrects itself. Only infrastructure failures end a turn, and even then the turn is logged and a reply is saved.

---

## Decisions worth explaining

**Hard constraints in code, judgment in the model.** Opening hours, diets, kids rules, and party sizes were parsed from the source file, hand-checked for all fifty restaurants, and are enforced by tested functions. The model handles what code can't: vibe, occasion, and reading each place's full description. It matters because Hearth & Hen looks fine for a vegetarian until you read that its sides are cooked with pork. A diet level of *unknown* is kept apart from *none*, so the agent says "worth a call" instead of guessing.

**A memory of actions, not just words.** Rebuilding context from the visible transcript alone produced a memorable bug. Later in one conversation, the model saw its earlier picks but not the searches behind them, and told a user to "ignore my earlier picks, I gave them without searching." The log proved it had searched. Each past reply is now preceded by a one-line trace of that turn's tool calls, built from the event log, and that conversation is a permanent behavior test.

**A trust boundary around other people's words.** Friends who vote on a poll can leave notes, and a note is text the user never wrote. Notes reach the model only as tool-result data, never in the system-level context. A turn that reads them can't save facts, a conversation that has read them can't save long-term preferences, and failed tool calls never echo text back into the agent's memory.

**Per-turn state in its own message.** The current time, known facts, and past picks arrive in a separate system message placed after your newest message. The main system prompt stays byte-identical across turns and is cached, and each step within a turn is cached as well.

**Restaurants in the database, filtering in TypeScript.** The catalog lives in Postgres so picks, polls, and votes reference real rows. The fifty-row filter runs in TypeScript so that every exclusion carries a reason the inspector can show. With a much larger catalog, the same predicates would move into SQL.

---

## Beyond the brief

**Group pick.** Choosing a restaurant with other people is where the decision usually stalls. When you're deciding with friends, the agent builds a poll from two or three places that fit everyone it knows about. You text the link; friends vote without an account and can leave a note ("I'm vegetarian"); and when you come back, the agent reads the results, searches again with whatever the notes added, and picks the winner. Every poll link also puts Nearby in front of people who haven't used it yet. Word of mouth, built into the product.

**Go now.** Every pick comes with the visit time, when the place closes ("closes in 1h 20m" if you're heading out now), directions, and a calendar event. It closes the distance between "sounds good" and actually going.

**It feels alive while it works.** Instead of a spinner, a small steaming bowl and a line that follows what the agent is really doing: *Checking who's still open*, *Jotting that down*, *Counting the votes*, or, while it thinks, *Consulting the menu gods*. Replies type themselves out as they arrive.

---

## Built to stay up

- **Rate limits run from narrowest to broadest:** per network, then per person, then daily caps on turns and tokens that bound the cost of a public link. A request blocked early never touches the shared budget.
- **Same-site only.** Chat and vote requests must be JSON from the app itself, so no other website can drive them, and no site can frame the pages.
- **Turns fail safe.** A slow model call is aborted before the platform's time limit, so the failure is logged and a reply is still saved. Closing the tab doesn't interrupt a turn, a second tab can't start one while another is running, and an empty reply is never stored.
- **Anonymous by design.** A random id in an httpOnly cookie, with ownership checked on every conversation read.

---

## How it's tested

| Layer | What it proves | When it runs |
|---|---|---|
| Unit | The hours parser, cross-checked against every restaurant's own "Closed" note. Search over all fifty places at every hour of the week. The hand-checked flags, every tool's guards, transcript assembly, rate-limit math, calendar files. | Every push |
| Database | Fact superseding and both uniqueness rules, ownership checks, and atomic rate-limit counters, against real Postgres. | Every relevant change, on a throwaway database branch |
| Behavior | Seven tricky conversations replayed against the real model and judged on what the agent *did*: a vague opener, a vegetarian asking about Hearth & Hen, kids at 9:30pm, a solo diner craving Korean BBQ, an anniversary tonight, a change of mind, and the "ignore my earlier picks" regression. | Whenever the agent or its prompt changes |

239 tests and all 7 behavior scenarios pass in CI. Each CI run gets its own Neon branch, wiped of user data before anything runs, so tests never touch production.

---

## A tour of the repository

```
prompts/
  system-prompt.md          how the agent thinks, asks, remembers, and stays honest
  EXPORTED_PROMPT.md        everything the model sees, generated from the running code
data/restaurants.txt        the fifty restaurants, exactly as provided
docs/database.md            the schema as a diagram, and what holds conversation state

src/agent/                  the agent
  loop.ts                   one turn: rebuild context, call the model, run tools, log everything
  tools.ts                  the tools, and the guards that keep every pick honest
  facts.ts                  memory: scopes, superseding, provenance
  context.ts, transcript.ts what the model is shown on each turn
  polls.ts                  the group pick
  events.ts                 the event contract shared by the loop, the database, and the UI

src/lib/restaurants/        the catalog: parsing, hand-checked flags, opening hours, search
src/lib/                    rate limiting, sessions, calendar files
src/app/                    the chat page, the poll page, and three API routes
src/components/             chat, inspector, pick card, poll card, activity indicator
src/db/schema.ts            the whole database in one file; migrations live in drizzle/
scripts/                    seeding, behavior evals, a terminal chat, and the prompt export
```

Built with Next.js 16, TypeScript, Postgres on Neon through Drizzle, and Claude Sonnet 5.5. Deployed on Vercel.

---

## Assumptions

- Times are Orange County time. Without a time, the agent picks one and says so; a time that has already passed today means tomorrow.
- A place must stay open at least 45 minutes after you arrive.
- Parties of five or more skip places the data describes as tiny or poor for groups.
- "21+ after 9pm" still applies after midnight.

## What I'd build next

- Real text messaging. Nearby's users live in SMS, and US business texting requires carrier registration that takes days.
- More behavior scenarios, each run several times to measure variance, plus a model-graded check for tone.
- A database branch per preview deployment, and per-account limits once there are real accounts.

---

## Run it yourself

Requires Node 22+, pnpm, a Neon Postgres database, and an Anthropic API key.

```bash
pnpm install
cp .env.example .env.local    # DATABASE_URL, DATABASE_URL_UNPOOLED, ANTHROPIC_API_KEY
pnpm db:migrate && pnpm db:seed
pnpm dev
```

`pnpm test` runs the suite (the database tests need a `TEST_DATABASE_URL`), `pnpm eval` replays the behavior scenarios against the real model, and `pnpm chat "where should I eat tonight"` holds a conversation in the terminal with every event printed.
