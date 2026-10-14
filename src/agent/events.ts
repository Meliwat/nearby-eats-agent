import { z } from "zod";

/**
 * The contract between the agent loop, the agent_events table, and the inspector UI.
 * Every event is validated against these schemas before it is stored or streamed.
 */
export const modelCallPayload = z.object({
  model: z.string(),
  stopReason: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
});

export const toolCallPayload = z.object({
  toolUseId: z.string(),
  name: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  isError: z.boolean(),
});

export const factChangePayload = z.object({
  action: z.enum(["added", "superseded", "unchanged"]),
  key: z.string(),
  value: z.string(),
  previousValue: z.string().nullable(),
  scope: z.enum(["user", "conversation"]),
});

export const errorPayload = z.object({
  stage: z.string(),
  message: z.string(),
});

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("model_call"), payload: modelCallPayload, durationMs: z.number() }),
  z.object({ type: z.literal("tool_call"), payload: toolCallPayload, durationMs: z.number() }),
  z.object({ type: z.literal("fact_change"), payload: factChangePayload, durationMs: z.null() }),
  z.object({ type: z.literal("error"), payload: errorPayload, durationMs: z.null() }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;
export type StoredAgentEvent = AgentEvent & { id: number; createdAt: string };

/** One line of the NDJSON stream the chat endpoint sends to the browser. */
export type StreamMessage =
  | { kind: "turn_started"; conversationId: string; userMessageId: string }
  | { kind: "event"; event: StoredAgentEvent }
  | { kind: "text"; delta: string }
  | { kind: "context"; facts: { key: string; value: string; scope: "user" | "conversation" }[] }
  | { kind: "done"; assistantMessageId: string; text: string }
  | { kind: "error"; message: string };
