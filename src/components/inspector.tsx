"use client";

import type { StoredAgentEvent } from "@/agent/events";
import { summarizeToolCall } from "@/agent/tool-summary";
import type { ChatMessage, Fact } from "./chat-app";

interface Props {
  messages: ChatMessage[];
  eventsByTurn: Record<string, StoredAgentEvent[]>;
  facts: Fact[];
  changedKeys: string[];
}

/** Requirement 4: what the agent did (tool calls and results) and what changed in its context. */
export function Inspector({ messages, eventsByTurn, facts, changedKeys }: Props) {
  const turns = messages.filter((m) => m.role === "user");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">What Nearby knows</h2>
        {facts.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Nothing yet. Facts appear here as the agent learns them.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {facts.map((fact) => (
              <li
                key={fact.key}
                className={`rounded-md border px-2 py-1 text-xs ${
                  changedKeys.includes(fact.key)
                    ? "border-amber-400 bg-amber-50 dark:bg-amber-950/40"
                    : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
                }`}
              >
                <span className="text-stone-500">{fact.key}</span> {fact.value}
                <span className="ml-1.5 text-[10px] text-stone-400">{scopeLabel(fact.scope)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Agent timeline</h2>
        {turns.length === 0 && (
          <p className="mt-2 text-sm text-stone-500">Every model call, tool call, and context change shows up here.</p>
        )}
        <ol className="mt-2 space-y-4">
          {turns.map((turn, index) => (
            <li key={turn.id}>
              <p className="truncate text-xs font-medium">
                Turn {index + 1} <span className="font-normal text-stone-500">&ldquo;{turn.content}&rdquo;</span>
              </p>
              <ol className="mt-1.5 space-y-1 border-l border-stone-200 pl-3 dark:border-stone-800">
                {(eventsByTurn[turn.id] ?? []).map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function EventRow({ event }: { event: StoredAgentEvent }) {
  switch (event.type) {
    case "model_call": {
      const p = event.payload;
      const totalInput = p.inputTokens + p.cacheReadTokens + p.cacheWriteTokens;
      return (
        <li className="font-mono text-[11px] text-stone-500">
          model · {seconds(event.durationMs)} · {totalInput} in ({p.cacheReadTokens} cached) /{" "}
          {p.outputTokens} out · {p.stopReason}
        </li>
      );
    }
    case "tool_call": {
      const p = event.payload;
      return (
        <li>
          <details className="group rounded-md border border-stone-200 bg-white text-xs dark:border-stone-800 dark:bg-stone-900">
            <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5">
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${
                  p.isError ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                }`}
              >
                {p.name}
              </span>
              <span className="min-w-0 flex-1 truncate text-stone-600 dark:text-stone-400">{summarizeToolCall(p)}</span>
              <span className="font-mono text-[11px] text-stone-400">{event.durationMs}ms</span>
            </summary>
            <div className="space-y-2 border-t border-stone-200 p-2 dark:border-stone-800">
              <JsonBlock label="input" value={p.input} />
              <JsonBlock label={p.isError ? "error" : "output"} value={p.output} />
            </div>
          </details>
        </li>
      );
    }
    case "fact_change": {
      const p = event.payload;
      const label = { added: "learned", superseded: "changed", unchanged: "confirmed" }[p.action];
      return (
        <li className="rounded-md bg-amber-50 px-2 py-1 text-xs dark:bg-amber-950/40">
          <span className="font-medium text-amber-800 dark:text-amber-300">context {label}</span>{" "}
          <span className="font-mono">{p.key}</span>:{" "}
          {p.action === "superseded" && <span className="text-stone-500 line-through">{p.previousValue}</span>}{" "}
          {p.value} <span className="text-stone-400">({scopeLabel(p.scope)})</span>
        </li>
      );
    }
    case "error":
      return (
        <li className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300">
          error in {event.payload.stage}: {event.payload.message}
        </li>
      );
  }
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">{label}</p>
      <pre className="max-h-64 overflow-auto rounded bg-stone-100 p-2 font-mono text-[11px] leading-snug dark:bg-stone-950">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function scopeLabel(scope: Fact["scope"]): string {
  return scope === "user" ? "remembered" : "this outing";
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
