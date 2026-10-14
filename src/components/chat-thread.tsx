"use client";

import { useEffect, useRef, useState } from "react";
import type { StoredAgentEvent } from "@/agent/events";
import type { ChatMessage } from "./chat-app";
import { ActivityIndicator, type Activity } from "./activity-indicator";
import { PollCard } from "./group-poll";
import { RecommendationCard, recommendationFor } from "./recommendation-card";

/** Typewriter pacing: at least ~120 characters a second, and never more than ~20 frames behind. */
const MIN_CHARS_PER_FRAME = 2;
const CATCH_UP_FRAMES = 20;

const STARTERS = [
  "Where should I eat tonight?",
  "Date night Saturday, somewhere quiet",
  "Cheap vegan lunch near Irvine",
  "Dinner for 8 with kids tomorrow at 6",
];

interface Props {
  messages: ChatMessage[];
  eventsByTurn: Record<string, StoredAgentEvent[]>;
  draft: string | null;
  /** The server finished the reply; once it's fully revealed, onDraftRevealed commits it. */
  draftFinished: boolean;
  onDraftRevealed: () => void;
  activity: Activity | null;
  error: string | null;
  busy: boolean;
  onSend: (text: string) => void;
}

export function ChatThread({
  messages,
  eventsByTurn,
  draft,
  draftFinished,
  onDraftRevealed,
  activity,
  error,
  busy,
  onSend,
}: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft, activity]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setInput("");
  }

  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-6">
        {messages.length === 0 && (
          <div className="mx-auto max-w-sm pt-10 text-center">
            <p className="text-lg font-medium">Hungry? Text me what you&apos;re after.</p>
            <p className="mt-1 text-sm text-stone-500">I know 50 spots around Orange County and I&apos;ll pick one for you.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  onClick={() => submit(starter)}
                  className="rounded-full border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-900"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => {
          const turnEvents = message.role === "assistant" ? (eventsByTurn[messages[index - 1]?.id] ?? []) : [];
          const recommendation = recommendationFor(turnEvents);
          const pollId = pollIdFor(turnEvents);
          return (
            <div key={message.id} className="space-y-2">
              <Bubble role={message.role} text={message.content} />
              {recommendation && <RecommendationCard recommendation={recommendation} />}
              {pollId && <PollCard pollId={pollId} />}
            </div>
          );
        })}

        {draft && <StreamingBubble text={draft} finished={draftFinished} onRevealed={onDraftRevealed} />}
        {activity && <ActivityIndicator activity={activity} />}
        {error && <p className="text-center text-sm text-red-600">{error}</p>}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
        className="flex gap-2 border-t border-stone-200 p-3 dark:border-stone-800"
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Text Nearby…"
          maxLength={2000}
          className="min-w-0 flex-1 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </>
  );
}

function Bubble({ role, text, children }: { role: "user" | "assistant"; text: string; children?: React.ReactNode }) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
          mine ? "rounded-br-sm bg-emerald-600 text-white" : "rounded-bl-sm bg-white shadow-sm dark:bg-stone-900"
        }`}
      >
        {text}
        {children}
      </p>
    </div>
  );
}

/** The reply arriving: revealed with a typewriter so a burst of text reads as it streams. */
function StreamingBubble({ text, finished, onRevealed }: { text: string; finished: boolean; onRevealed: () => void }) {
  const shown = useTypewriter(text);
  const revealed = shown.length === text.length;

  useEffect(() => {
    if (finished && revealed) onRevealed();
  }, [finished, revealed, onRevealed]);

  return (
    <Bubble role="assistant" text={shown}>
      {!revealed || !finished ? <span className="caret ml-0.5 text-emerald-600">▍</span> : null}
    </Bubble>
  );
}

/**
 * Reveals `target` a few characters per animation frame, faster the further behind it is, so
 * the model's replies (which arrive in one fast burst after its tool calls) read as they stream.
 */
function useTypewriter(target: string): string {
  const [length, setLength] = useState(0);
  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reduceMotion || length >= target.length) return;
    const frame = requestAnimationFrame(() => {
      const remaining = target.length - length;
      setLength(length + Math.max(MIN_CHARS_PER_FRAME, Math.ceil(remaining / CATCH_UP_FRAMES)));
    });
    return () => cancelAnimationFrame(frame);
  }, [length, target, reduceMotion]);

  return reduceMotion ? target : target.slice(0, length);
}

/** The poll created in a turn, if the agent started one. */
function pollIdFor(events: StoredAgentEvent[]): string | null {
  const created = events.find(
    (event) => event.type === "tool_call" && event.payload.name === "start_group_poll" && !event.payload.isError,
  );
  return created?.type === "tool_call" ? (created.payload.output as { poll_id: string }).poll_id : null;
}
