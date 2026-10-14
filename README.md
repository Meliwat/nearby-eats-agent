# Nearby

**A restaurant agent you text.** Tell it you're hungry and it answers like a friend who knows Orange County: it asks only what it needs, remembers what you tell it, and ends with one place, the reasons it fits, and what to know before you go. Beside the chat, an inspector shows everything the agent did to get there.

**[Try it live](https://nearby-eats-agent.vercel.app)** &nbsp;·&nbsp; [The prompt, exported](prompts/EXPORTED_PROMPT.md) &nbsp;·&nbsp; [Database architecture](docs/database.md)

---

## Example

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
         → 38 places fit and the party would change the answer, so it asks before picking

turn 2   remember_fact          party_size = 4 people              (this outing)
         remember_fact          party_needs = wife is vegetarian   (this outing)
         remember_fact          kids = 2 kids                      (remembered)
         search_restaurants     [vegetarian; with kids; party of 4]: 28 fit, 22 ruled out
         recommend_restaurant   picked Mangal Grill                (checked against that search)
```

Every pick must come from a search the code ran that turn, and the reply is written only after that check passes. Every fact is stored with the message it came from. Every model call, tool call, and change to memory is logged and shown as it happens.

---

## Requirements

**Recommendations.** When the agent recommends, it names one place and the reasons it fits *you*: the details you gave, matched against the restaurant's own description, plus one practical note (the wait, the parking, cash only, what to order). `recommend_restaurant` only accepts a candidate from the search the agent ran that turn, so a pick always satisfies every constraint that search applied: open long enough to eat, diets, kids and 21+ rules, party size, budget, area, and cash. Once a constraint has been searched with, later searches keep it until the agent explicitly drops it.

**Conversation.** The prompt keeps replies to about sixty words and has the agent recommend early, asking a question only when the answer would change which restaurant wins. These are prompt rules, checked by the behavior evals rather than enforced in code. Otherwise it states its assumption out loud ("I'm assuming you'd eat around 6:30") and lets you correct it. Fragments, changes of mind, and answers to a different question are all simply new information.

**Memory.** What you reveal becomes a fact: one row each, with provenance. Each kind of fact has a fixed lifetime in code; the model only chooses which kind it learned. *Vegetarian* is remembered for next time; *party of 6 tonight* belongs to this outing only. When you change your mind, the old fact is marked superseded and the new one points back at it, so the history survives. Ten messages in, the agent knows your diet, your kids, your budget, your part of town, and what you've already turned down.

**Visibility.** The right half of the screen is a live timeline of every model call (tokens, cache hits, latency, stop reason), every tool call (input, output, errors), and every change to what the agent knows, rendered as a diff. It reads from the same append-only log the agent writes to, so what you see is exactly what happened.

---

## How it works

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

The agent loop is written on the Anthropic SDK, with no agent framework. It is the heart of the project, so every step is readable and every step is logged. Context is rebuilt from the database on every turn; no conversation state lives in server memory (only the read-only restaurant catalog is cached). Only the model call that ends the turn speaks to the user: text written alongside tool calls is never shown, so the reply always comes after every check.

| Tool | What the code guarantees |
|---|---|
| `search_restaurants` | Hard constraints, enforced by tested code: open long enough to actually eat, diets, kids and 21+ rules, party size, budget, area, cash, how far ahead it books. Constraints from earlier searches carry forward unless the agent drops them by name, which is logged. Returns the candidates, and why every other place was ruled out. |
| `recommend_restaurant` | Accepts only a candidate from this turn's latest search. |
| `remember_fact` | A fixed vocabulary of keys. The code sets each fact's scope and supersedes old values in one transaction. |
| `update_recommendation` | Records a yes or a no. Once a recommended place is marked turned down, search excludes it for the rest of the conversation. |
| `get_restaurant` | Looks up a place you name. |
| `start_group_poll`, `get_poll_results` | The group pick, described below. Poll options must also come from the latest search. |

When a tool call is wrong, the model gets the reason back as a tool error and corrects itself. Only infrastructure failures end a turn, and even then the turn is logged and a reply is saved.

---

## Design decisions

**Hard constraints in code, soft fit in the model.** Opening hours were parsed from the source file; diets, kids rules, and party limits were hand-checked into flags for all fifty restaurants. Tested functions enforce both. The model handles what code can't: vibe, occasion, and reading each place's full description. The flags matter because the prose is easy to misread: Hearth & Hen's sides are cooked with pork, so its vegetarian flag is *none* and search rules it out for vegetarians, however the model reads the menu. A diet level of *unknown* is kept apart from *none*, so the agent says "worth a call" instead of guessing.

**Past tool calls in the context.** Rebuilding context from the visible transcript alone produced a memorable bug. Later in one conversation, the model saw its earlier picks but not the searches behind them, and told a user to "ignore my earlier picks, I gave them without searching." The log proved it had searched. Each past reply is now preceded by a one-line trace of that turn's tool calls, built from the event log, and that conversation is a permanent behavior test.

**Untrusted poll notes.** Friends who vote on a poll can leave notes, and a note is text the user never wrote. Notes reach the model only as tool-result data. A conversation that has read them saves no new facts, because saved facts appear in the system-level context, and failed tool calls never echo text back into the agent's memory.

**Per-turn context message.** The current time, known facts, and past picks arrive in a separate system message placed after your newest message. The main system prompt stays byte-identical across turns and is cached, and each step within a turn is cached as well.

**Restaurants in the database, filtering in TypeScript.** The catalog lives in Postgres so picks, polls, and votes reference real rows. The fifty-row filter runs in TypeScript so that every exclusion carries a reason the inspector can show. With a much larger catalog, the same predicates would move into SQL.

---

## Extra features

**Group pick.** Choosing a restaurant with other people is where the decision usually stalls. When you're deciding with friends, the agent builds a poll from two or three places that fit everyone it knows about. You text the link; friends vote without an account and can leave a note ("I'm vegetarian"); and when you come back, the agent reads the results, searches again with whatever the notes added, and picks the winner. Every poll link also puts Nearby in front of people who haven't used it yet. Word of mouth, built into the product.

**Go now.** Every pick comes with the visit time, when the place closes ("closes in 1h 20m" if you're heading out now), directions, and a calendar event. It closes the distance between "sounds good" and actually going.

**Activity indicator.** Instead of a spinner, a small steaming bowl and a line that follows what the agent is really doing: *Checking who's still open*, *Jotting that down*, *Counting the votes*, or, while it thinks, *Asking the locals*. Replies type themselves out as they arrive.

---

## Reliability and security

- **Rate limits:** per network, then per person, then daily caps on turns and tokens that bound the cost of a public link. A request blocked early never touches the shared budget.
- **Same-site only.** Chat and vote requests must be JSON from the app itself, so no other website can drive them, and no site can frame the pages.
- **Failure handling.** A slow model call is aborted before the platform's time limit, so the failure is logged and a reply is still saved. Closing the tab doesn't interrupt a turn, a second tab is refused while a turn is running, and an empty reply is never stored.
- **Anonymous users.** A random id in an httpOnly cookie, with ownership checked on every conversation read.

---

## Testing

| Layer | What it proves | When it runs |
|---|---|---|
| Unit | The hours parser, cross-checked against every restaurant's own "Closed" note. Search over all fifty places at every hour of the week, checked minute by minute. The hand-checked flags, the tool guards, constraint carry-over, transcript assembly, rate-limit math, calendar files. | Every push |
| Database | Fact superseding and both uniqueness rules, ownership checks, and atomic rate-limit counters, against real Postgres. | Every relevant change, on a throwaway database branch |
| Behavior | Seven tricky conversations replayed against the real model, judged mostly on what the agent *did* (tool inputs, picks, superseded facts) and partly on its replies: a vague opener, a vegetarian asking about Hearth & Hen, kids at 9:30pm, a solo diner craving Korean BBQ, an anniversary tonight, a change of mind, and the "ignore my earlier picks" regression. | Whenever the agent or its prompt changes |

CI has two workflows. Every push runs lint, the type check, the unit tests, and a build. When agent code, the prompt, the schema, or dependencies change, a second workflow creates a throwaway Neon branch, wipes the user data it copied, and runs all 244 tests (database tests included) plus the 7 behavior scenarios, then deletes the branch. Tests never touch production.

---

## Repository layout

```
prompts/
  system-prompt.md          how the agent thinks, asks, remembers, and stays honest
  EXPORTED_PROMPT.md        everything the model sees, generated from the running code
data/restaurants.txt        the fifty restaurants, exactly as provided
docs/database.md            the schema as a diagram, and what holds conversation state

src/agent/                  the agent
  loop.ts                   one turn: rebuild context, call the model, run tools, log everything
  tools.ts                  the tools, and the guards that keep every pick honest
  constraints.ts            hard constraints that carry forward across a conversation
  facts.ts                  memory: scopes, superseding, provenance
  context.ts, transcript.ts what the model is shown on each turn
  tool-summary.ts           one-line summaries of tool calls, for the inspector and the model
  polls.ts                  the group pick
  events.ts                 the event contract shared by the loop, the database, and the UI

src/lib/restaurants/        the catalog: parsing, hand-checked flags, opening hours, search
src/lib/                    rate limiting, sessions, calendar files
src/app/                    the chat page, the poll page, and three API routes
src/components/             chat, inspector, pick card, poll card, activity indicator
src/db/schema.ts            the whole database in one file; migrations live in drizzle/
scripts/                    seeding, behavior evals, a terminal chat, and the prompt export
.github/workflows/          CI checks, and the evals on a throwaway database branch
```

Built with Next.js 16, TypeScript, Postgres on Neon through Drizzle, and Claude Sonnet 5.5. Deployed on Vercel.

---

## Assumptions

- Times are Orange County time. Without a time, the agent picks one and says so; a time more than an hour in the past means tomorrow.
- A place must stay open at least 45 minutes after you arrive.
- Parties of five or more skip places the data describes as tiny or poor for groups.
- "21+ after 9pm" still applies after midnight.

## Next steps

- Real text messaging. Nearby's users live in SMS, and US business texting requires carrier registration that takes days.
- More behavior scenarios, each run several times to measure variance, plus a model-graded check for tone.
- A database branch per preview deployment, and per-account limits once there are real accounts.

---

## Running locally

Requires Node 22+, pnpm, a Neon Postgres database, and an Anthropic API key.

```bash
pnpm install
cp .env.example .env.local    # DATABASE_URL, DATABASE_URL_UNPOOLED, ANTHROPIC_API_KEY
pnpm db:migrate && pnpm db:seed
pnpm dev
```

`pnpm test` runs the suite (the database tests need a `TEST_DATABASE_URL`), `pnpm eval` replays the behavior scenarios against the real model, and `pnpm chat "where should I eat tonight"` holds a conversation in the terminal with every event printed.
