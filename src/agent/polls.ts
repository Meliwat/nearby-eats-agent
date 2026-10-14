import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { agentEvents, groupPollOptions, groupPolls, groupVotes, restaurants } from "@/db/schema";

export interface PollOptionView {
  restaurantId: number;
  name: string;
  city: string;
  price: string;
  address: string;
  hours: string;
  reason: string;
  voters: { name: string; note: string | null }[];
}

export interface PollView {
  pollId: string;
  options: PollOptionView[];
  /** The restaurant the current viewer voted for, if any. */
  myVote: number | null;
}

/** Creates a poll and its options in one transaction. The poll id is generated here so both inserts can use it. */
export async function createPoll(conversationId: string, options: { restaurantId: number; reason: string }[]) {
  const pollId = crypto.randomUUID();
  await db.batch([
    db.insert(groupPolls).values({ id: pollId, conversationId }),
    db.insert(groupPollOptions).values(options.map((option, position) => ({ pollId, position, ...option }))),
  ]);
  return pollId;
}

/** The public view of a poll: options, reasons, and who voted for what. No conversation content. */
export async function getPollView(pollId: string, viewerId: string | null): Promise<PollView | null> {
  // Neither query depends on the other, so they run concurrently instead of back to back.
  const [options, votes] = await Promise.all([
    db
      .select({
        restaurantId: groupPollOptions.restaurantId,
        reason: groupPollOptions.reason,
        name: restaurants.name,
        city: restaurants.city,
        priceTier: restaurants.priceTier,
        address: restaurants.address,
        hours: restaurants.hoursText,
      })
      .from(groupPollOptions)
      .innerJoin(restaurants, eq(restaurants.id, groupPollOptions.restaurantId))
      .where(eq(groupPollOptions.pollId, pollId))
      .orderBy(asc(groupPollOptions.position)),
    db
      .select({
        restaurantId: groupVotes.restaurantId,
        voterId: groupVotes.voterId,
        name: groupVotes.voterName,
        note: groupVotes.note,
      })
      .from(groupVotes)
      .where(eq(groupVotes.pollId, pollId))
      .orderBy(asc(groupVotes.createdAt)),
  ]);
  if (options.length === 0) return null;

  return {
    pollId,
    myVote: votes.find((v) => v.voterId === viewerId)?.restaurantId ?? null,
    options: options.map(({ priceTier, ...option }) => ({
      ...option,
      price: "$".repeat(priceTier),
      voters: votes.filter((v) => v.restaurantId === option.restaurantId).map(({ name, note }) => ({ name, note })),
    })),
  };
}

/** Records or changes a vote. The composite foreign key rejects a restaurant that isn't an option in this poll. */
export async function castVote(vote: { pollId: string; voterId: string; restaurantId: number; voterName: string; note: string | null }) {
  await db
    .insert(groupVotes)
    .values(vote)
    .onConflictDoUpdate({
      target: [groupVotes.pollId, groupVotes.voterId],
      set: { restaurantId: vote.restaurantId, voterName: vote.voterName, note: vote.note, createdAt: sql`now()` },
    });
}

/**
 * One line per poll for the agent's per-turn system context. Only trusted data goes here
 * (option names from our catalog and vote counts). Voter names and notes are typed by other
 * people, so they reach the model only through the get_poll_results tool result, never with
 * system-message authority.
 */
export async function summarizePolls(conversationId: string): Promise<string[]> {
  const rows = await db
    .select({
      pollId: groupPolls.id,
      restaurantId: groupPollOptions.restaurantId,
      name: restaurants.name,
      votes: sql<number>`count(${groupVotes.id})::int`,
    })
    .from(groupPolls)
    .innerJoin(groupPollOptions, eq(groupPollOptions.pollId, groupPolls.id))
    .innerJoin(restaurants, eq(restaurants.id, groupPollOptions.restaurantId))
    .leftJoin(
      groupVotes,
      sql`${groupVotes.pollId} = ${groupPollOptions.pollId} and ${groupVotes.restaurantId} = ${groupPollOptions.restaurantId}`,
    )
    .where(eq(groupPolls.conversationId, conversationId))
    .groupBy(groupPolls.id, groupPolls.createdAt, groupPollOptions.restaurantId, groupPollOptions.position, restaurants.name)
    .orderBy(asc(groupPolls.createdAt), asc(groupPollOptions.position));

  const pollIds = [...new Set(rows.map((row) => row.pollId))];
  return pollIds.map((pollId) => {
    const tallies = rows.filter((row) => row.pollId === pollId).map((row) => `${row.name} (id ${row.restaurantId}): ${row.votes}`);
    return `poll ${pollId}: ${tallies.join(", ")}`;
  });
}

/** True if any earlier turn in this conversation read friends' poll notes (see ToolContext.conversationReadThirdPartyText). */
export async function conversationReadPollResults(conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: agentEvents.id })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.conversationId, conversationId),
        eq(agentEvents.type, "tool_call"),
        sql`${agentEvents.payload}->>'name' = 'get_poll_results'`,
        // Only calls that actually returned notes; a failed call (say, an invented poll id) read nothing.
        sql`${agentEvents.payload}->>'isError' = 'false'`,
      ),
    )
    .limit(1);
  return Boolean(row);
}
