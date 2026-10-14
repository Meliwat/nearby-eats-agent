import type Anthropic from "@anthropic-ai/sdk";
import { buildActionNote, type ToolCallPayload } from "./tool-summary";

export interface TranscriptRow {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/** Oldest first, without empty rows, starting at a user message (the API requires that). */
export function trimTranscript(newestFirst: TranscriptRow[]): TranscriptRow[] {
  const recent = [...newestFirst].reverse().filter((row) => row.content.trim());
  const firstUser = recent.findIndex((row) => row.role === "user");
  return recent.slice(Math.max(firstUser, 0));
}

/**
 * The transcript as API messages, with each past reply preceded by a system note of the tool calls
 * from its turn (`toolCalls` keyed by the user message that started the turn). A mid-conversation
 * system message must sit between a user message and an assistant reply, so notes only go there.
 */
export function withActionNotes(
  transcript: TranscriptRow[],
  toolCalls: { turnMessageId: string; payload: ToolCallPayload }[],
): Anthropic.Beta.BetaMessageParam[] {
  return transcript.flatMap((row, index): Anthropic.Beta.BetaMessageParam[] => {
    const previous = transcript[index - 1];
    if (row.role === "assistant" && previous?.role === "user") {
      const note = buildActionNote(toolCalls.filter((c) => c.turnMessageId === previous.id).map((c) => c.payload));
      if (note) return [{ role: "system", content: note }, { role: "assistant", content: row.content }];
    }
    return [{ role: row.role, content: row.content }];
  });
}
