/**
 * Replays tricky conversations against the real agent and checks what it DID (tool calls,
 * picks, fact changes), not just what it said. Each scenario gets a fresh user that is
 * deleted afterward. Costs a few cents of API usage per run.
 * Usage: pnpm eval
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { conversations, users } from "../src/db/schema";
import type { StoredAgentEvent, StreamMessage } from "../src/agent/events";
import { runTurn } from "../src/agent/loop";
import { castVote } from "../src/agent/polls";
import { RESTAURANT_ATTRIBUTES } from "../src/lib/restaurants/attributes";

interface Transcript {
  events: StoredAgentEvent[];
  replies: string[];
}

/** A user message, or a setup step run between messages (e.g. friends voting on a poll). */
type Step = string | ((t: Transcript, newUser: () => Promise<string>) => Promise<void>);

interface Scenario {
  name: string;
  turns: Step[];
  /** Returns a failure message, or null if the agent behaved. */
  check: (t: Transcript) => string | null;
}

const toolCalls = (t: Transcript, name: string) =>
  t.events.flatMap((e) => (e.type === "tool_call" && e.payload.name === name && !e.payload.isError ? [e.payload] : []));
const picks = (t: Transcript) => toolCalls(t, "recommend_restaurant").map((p) => (p.output as { recommended: string }).recommended);
const lastSearchInput = (t: Transcript) => toolCalls(t, "search_restaurants").at(-1)?.input as Record<string, unknown> | undefined;
const appliedDiets = (t: Transcript) =>
  toolCalls(t, "search_restaurants").map((p) => (p.output as { applied_constraints: { diets: string[] } }).applied_constraints.diets);

/** Every place the data says isn't for kids, or is 21+, at 9:30pm. */
const NOT_FOR_KIDS_AT_930PM = RESTAURANT_ATTRIBUTES.filter(
  (r) =>
    r.kids === "avoid" || r.kids === "not_allowed" || (r.adultsOnlyFromMinute !== null && r.adultsOnlyFromMinute <= 21 * 60 + 30),
).map((r) => r.name);

const SCENARIOS: Scenario[] = [
  {
    name: "Vague opener asks at most one question",
    turns: ["hungry"],
    check: (t) => {
      const questions = (t.replies[0].match(/\?/g) ?? []).length;
      return questions <= 1 ? null : `asked ${questions} questions: "${t.replies[0]}"`;
    },
  },
  {
    name: "Vegetarian is steered away from Hearth & Hen",
    turns: ["is hearth & hen good for dinner tonight? I'm vegetarian"],
    check: (t) =>
      picks(t).includes("Hearth & Hen")
        ? "recommended Hearth & Hen to a vegetarian"
        : /pork/i.test(t.replies.join(" "))
          ? null
          : "didn't mention why (sides cooked with pork)",
  },
  {
    name: "Kids at 9:30pm avoid 21+ and no-kid places",
    turns: ["dinner tonight at 9:30 with my two kids"],
    check: (t) => {
      const input = lastSearchInput(t);
      if (!input?.with_kids) return "searched without with_kids";
      if (picks(t).length === 0) return "made no pick";
      const bad = picks(t).filter((name) => NOT_FOR_KIDS_AT_930PM.includes(name));
      return bad.length ? `picked ${bad.join(", ")}` : null;
    },
  },
  {
    name: "Solo Korean BBQ explains the two-person minimum",
    turns: ["korean bbq tonight, just me"],
    check: (t) =>
      picks(t).includes("Seoul Fire BBQ")
        ? "recommended Seoul Fire to one person"
        : /\b(two|2)[- ]?(people|person|or more)|minimum of (two|2)|\b(two|2)-person/i.test(t.replies.join(" "))
          ? null
          : "didn't explain the two-person minimum",
  },
  {
    name: "Tonight's special occasion never picks The Lantern Room",
    turns: ["anniversary dinner tonight at 7:30, money is no object"],
    check: (t) => (picks(t).includes("The Lantern Room") ? "picked a place that books out weeks ahead" : picks(t).length ? null : "no pick"),
  },
  {
    name: "Change of mind supersedes the old preference",
    turns: ["mexican tonight around 7, just me", "actually not mexican, something with noodles"],
    check: (t) => {
      const changed = t.events.some((e) => e.type === "fact_change" && e.payload.action === "superseded");
      const last = picks(t).at(-1);
      if (!changed) return "no fact was superseded";
      if (!last) return "no pick after the change";
      return ["Casa Verde", "Barrio Tacos y Mezcal", "Tacos El Camino", "Mariscos del Puerto", "Pollo Verde"].includes(last)
        ? `still picked Mexican (${last})`
        : null;
    },
  },
  {
    // Regression: with only the visible transcript, the model once told a user to ignore its
    // earlier (fully searched) picks as "given without searching".
    name: "Later turns don't disown earlier, searched picks",
    turns: ["where should I eat tonight? I only eat halal", "actually I eat everything now", "how many people fit there?"],
    check: (t) => {
      const disowning = /without (searching|checking)|didn'?t (search|check)|ignore my (earlier|previous)/i;
      const bad = t.replies.find((reply) => disowning.test(reply));
      return bad ? `disowned earlier picks: "${bad}"` : null;
    },
  },
  {
    name: "A vegetarian's diet holds when they ask for fried chicken later",
    turns: ["dinner tonight at 7, I'm vegetarian", "actually I'm craving fried chicken, what's good?"],
    check: (t) => {
      const diets = appliedDiets(t);
      if (diets.length < 2) return "didn't search on both turns";
      if (diets.some((d) => !d.includes("vegetarian"))) return `a search ran without vegetarian: ${JSON.stringify(diets)}`;
      return picks(t).includes("Hearth & Hen") ? "recommended Hearth & Hen to a vegetarian" : null;
    },
  },
  {
    // Regression from a live chat: the agent guessed how many kids hadn't voted yet, then broke a
    // tie in favor of the option whose only vote came with "I hate both".
    name: "Poll tie: a vote with a complaint counts for less, and no guessing who's left",
    turns: [
      "dinner for 4 tomorrow at 6 with my kids, they never agree. can they vote?",
      async (t, newUser) => {
        const poll = toolCalls(t, "start_group_poll").at(-1);
        if (!poll) return;
        const [first, second] = (poll.input as { options: { restaurant_id: number }[] }).options;
        const pollId = (poll.output as { poll_id: string }).poll_id;
        await castVote({ pollId, voterId: await newUser(), restaurantId: first.restaurant_id, voterName: "Max", note: "I hate both" });
        await castVote({ pollId, voterId: await newUser(), restaurantId: second.restaurant_id, voterName: "Ana", note: null });
      },
      "votes are in. just pick one",
    ],
    check: (t) => {
      const poll = toolCalls(t, "start_group_poll").at(-1);
      if (!poll) return "never started a poll";
      const options = poll.output as { options: string[] };
      const pick = picks(t).at(-1);
      if (pick !== options.options[1]) return `picked ${pick ?? "nothing"}, not ${options.options[1]} (the vote without a complaint)`;
      const guessed = t.replies.find((reply) => /haven'?t voted|yet to vote|still (waiting|need)|more votes/i.test(reply));
      return guessed ? `guessed at missing voters: "${guessed}"` : null;
    },
  },
];

async function runScenario(scenario: Scenario): Promise<string | null> {
  const [user] = await db.insert(users).values({}).returning();
  const extraUsers: string[] = [];
  const newUser = async () => {
    const [created] = await db.insert(users).values({}).returning();
    extraUsers.push(created.id);
    return created.id;
  };
  try {
    const [conversation] = await db.insert(conversations).values({ userId: user.id }).returning();
    const transcript: Transcript = { events: [], replies: [] };
    const collect = (message: StreamMessage) => {
      if (message.kind === "event") transcript.events.push(message.event);
      if (message.kind === "done") transcript.replies.push(message.text);
    };
    // runTurn rethrows after logging a failed turn. Its placeholder reply could satisfy a check by
    // accident, so a failed turn fails the scenario (and only this scenario).
    try {
      for (const step of scenario.turns) {
        if (typeof step === "string") await runTurn({ userId: user.id, conversationId: conversation.id, text: step }, collect);
        else await step(transcript, newUser);
      }
    } catch (error) {
      return `a turn failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    return scenario.check(transcript);
  } finally {
    for (const id of [user.id, ...extraUsers]) await db.delete(users).where(eq(users.id, id));
  }
}

async function main() {
  const results = await Promise.all(SCENARIOS.map(async (s) => ({ name: s.name, failure: await runScenario(s) })));
  for (const { name, failure } of results) {
    console.log(`${failure ? "FAIL" : "PASS"}  ${name}`);
    if (failure) console.log(`      ${failure}`);
  }
  const failed = results.filter((r) => r.failure).length;
  console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
