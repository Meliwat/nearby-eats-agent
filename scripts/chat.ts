/**
 * Plays a scripted conversation against the real agent and prints what it did.
 * Usage: pnpm chat "where should I eat tonight" "vegetarian, with 2 kids"
 */
import { db } from "../src/db/client";
import { conversations, users } from "../src/db/schema";
import type { StreamMessage } from "../src/agent/events";
import { runTurn } from "../src/agent/loop";

function print(message: StreamMessage) {
  if (message.kind === "event") {
    const { type, payload, durationMs } = message.event;
    const timing = durationMs === null ? "" : ` (${durationMs}ms)`;
    console.log(`  [${type}]${timing} ${JSON.stringify(payload).slice(0, 300)}`);
  } else if (message.kind === "context") {
    console.log(`  [context] ${message.facts.map((f) => `${f.key}=${f.value}`).join(", ") || "empty"}`);
  } else if (message.kind === "done") {
    console.log(`\nNearby: ${message.text}\n`);
  } else if (message.kind === "error") {
    console.log(`  [error] ${message.message}`);
  }
}

async function main() {
  const turns = process.argv.slice(2);
  if (turns.length === 0) throw new Error('Pass at least one message, e.g. pnpm chat "where should I eat tonight"');

  const [user] = await db.insert(users).values({}).returning();
  const [conversation] = await db.insert(conversations).values({ userId: user.id }).returning();
  for (const text of turns) {
    console.log(`You: ${text}`);
    await runTurn({ userId: user.id, conversationId: conversation.id, text }, print);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
