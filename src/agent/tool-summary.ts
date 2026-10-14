import type { StoredAgentEvent } from "./events";

export type ToolCallPayload = Extract<StoredAgentEvent, { type: "tool_call" }>["payload"];

/** One readable line per tool call. The inspector timeline and the model's action trace both use it. */
export function summarizeToolCall(payload: ToolCallPayload): string {
  const output = payload.output as Record<string, unknown>;
  if (payload.isError) return `failed: ${String(output.error)}`;
  switch (payload.name) {
    case "search_restaurants":
      return `${output.arrival}: ${output.candidate_count} fit, ${(output.excluded as unknown[]).length} ruled out`;
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
 * Contains only trusted data: our tool outputs, never friends' poll notes.
 */
export function buildActionNote(calls: ToolCallPayload[]): string | null {
  if (calls.length === 0) return null;
  const lines = calls.map((call) => {
    const filters = call.name === "search_restaurants" ? ` [${describeSearchInput(call.input)}]` : "";
    return `- ${call.name}${filters}: ${summarizeToolCall(call)}`;
  });
  return ["Your tool calls before this reply (from the system log; the user doesn't see this):", ...lines].join("\n");
}

function describeSearchInput(input: unknown): string {
  const search = input as {
    diets?: string[];
    with_kids?: boolean;
    party_size?: number | null;
    max_price_tier?: number | null;
    cities?: string[];
    avoid_cash_only?: boolean;
  };
  const parts = [
    search.diets?.length ? `diets: ${search.diets.join(", ")}` : null,
    search.with_kids ? "with kids" : null,
    search.party_size ? `party of ${search.party_size}` : null,
    search.max_price_tier ? `up to ${"$".repeat(search.max_price_tier)}` : null,
    search.cities?.length ? `in ${search.cities.join(", ")}` : null,
    search.avoid_cash_only ? "no cash-only" : null,
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : "no extra constraints";
}
