import type { StoredAgentEvent } from "@/agent/events";

/** A turn that ended in a refusal, a stock fallback reply, or a failure: its reply isn't the pick, so no cards. */
export function turnEndedBadly(events: StoredAgentEvent[]): boolean {
  return events.some(
    (event) =>
      (event.type === "error" && (event.payload.stage === "turn" || event.payload.stage === "fallback")) ||
      (event.type === "model_call" && event.payload.stopReason === "refusal"),
  );
}
