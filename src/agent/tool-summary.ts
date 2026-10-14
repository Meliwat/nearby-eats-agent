import type { StoredAgentEvent } from "./events";

export type ToolCallPayload = Extract<StoredAgentEvent, { type: "tool_call" }>["payload"];

/** One readable line per tool call. The inspector timeline and the model's action trace both use it. */
export function summarizeToolCall(payload: ToolCallPayload): string {
  const output = payload.output as Record<string, unknown>;
  if (payload.isError) return `failed: ${String(output.error)}`;
  switch (payload.name) {
    case "search_restaurants":
      return `${output.arrival} [${describeSearch(output)}]: ${output.candidate_count} fit, ${(output.excluded as unknown[]).length} ruled out`;
    case "recommend_restaurant":
      return `picked ${output.recommended}`;
    case "remember_fact":
      return `${output.key} = ${output.value}`;
    case "update_recommendation":
      return `restaurant ${output.restaurant_id} ${output.status}`;
    case "get_restaurant":
      return `${(output as unknown as unknown[]).length} match(es)`;
    case "start_group_poll":
      return `poll: ${(output.options as string[]).join(" / ")}`;
    case "get_poll_results":
      return (output.options as { name: string; votes: number }[]).map((o) => `${o.name} ${o.votes}`).join(", ");
    default:
      return "";
  }
}

/**
 * A short system note describing what the agent did in a past turn, built from our own event log.
 * The rebuilt transcript only holds visible messages, so without this the model can't see that its
 * earlier picks were searched and verified, and may wrongly "confess" to skipping steps.
 * Contains only trusted data: our own tool summaries, never error text or friends' poll notes.
 */
export function buildActionNote(calls: ToolCallPayload[]): string | null {
  if (calls.length === 0) return null;
  const lines = calls.map((call) => {
    // A failed call's error text can echo model input (which may carry a friend's note), so it isn't repeated here.
    return `- ${call.name}: ${call.isError ? "failed" : summarizeToolCall(call)}`;
  });
  return ["Your tool calls before this reply (from the system log; the user doesn't see this):", ...lines].join("\n");
}

/** The constraints a search applied (including ones carried from earlier searches), and any it dropped. */
function describeSearch(output: Record<string, unknown>): string {
  const applied = output.applied_constraints as
    | { diets: string[]; with_kids: boolean; party_size: number | null; max_price_tier: number | null; avoid_cash_only: boolean }
    | undefined;
  const parts = applied
    ? [
        applied.diets.length ? applied.diets.join(", ") : null,
        applied.with_kids ? "with kids" : null,
        applied.party_size ? `party of ${applied.party_size}` : null,
        applied.max_price_tier ? `up to ${"$".repeat(applied.max_price_tier)}` : null,
        applied.avoid_cash_only ? "no cash-only" : null,
      ].filter(Boolean)
    : [];
  const dropped = (output.dropped as string[] | undefined)?.length ? `; dropped ${(output.dropped as string[]).join(", ")}` : "";
  return `${parts.length ? parts.join("; ") : "no extra constraints"}${dropped}`;
}
