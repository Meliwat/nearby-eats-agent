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
import { RESTAURANT_ATTRIBUTES } from "../src/lib/restaurants/attributes";

interface Transcript {
  events: StoredAgentEvent[];
  replies: string[];
}

interface Scenario {
  name: string;
  turns: string[];
  /** Returns a failure message, or null if the agent behaved. */
  check: (t: Transcript) => string | null;
}

const toolCalls = (t: Transcript, name: string) =>
  t.events.flatMap((e) => (e.type === "tool_call" && e.payload.name === name && !e.payload.isError ? [e.payload] : []));
const picks = (t: Transcript) => toolCalls(t, "recommend_restaurant").map((p) => (p.output as { recommended: string }).recommended);
const lastSearchInput = (t: Transcript) => toolCalls(t, "search_restaurants").at(-1)?.input as Record<string, unknown> | undefined;

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
];

async function runScenario(scenario: Scenario): Promise<string | null> {
  const [user] = await db.insert(users).values({}).returning();
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
      for (const text of scenario.turns) await runTurn({ userId: user.id, conversationId: conversation.id, text }, collect);
    } catch (error) {
      return `a turn failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    return scenario.check(transcript);
  } finally {
    await db.delete(users).where(eq(users.id, user.id));
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
