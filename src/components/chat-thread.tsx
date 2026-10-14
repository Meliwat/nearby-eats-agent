"use client";

import { useEffect, useRef, useState } from "react";
import type { StoredAgentEvent } from "@/agent/events";
import type { ChatMessage } from "./chat-app";
import { ActivityIndicator, type Activity } from "./activity-indicator";
import { PollCard, pollIdFor } from "./group-poll";
import { Bubble, TypingBubble } from "./message-bubble";
import { RecommendationCard, recommendationFor } from "./recommendation-card";

const STARTERS = [
  "Where should I eat tonight?",
  "Date night Saturday, somewhere quiet",
  "Cheap vegan lunch near Irvine",
  "Dinner for 8 with kids tomorrow at 6",
];

interface Props {
  messages: ChatMessage[];
  eventsByTurn: Record<string, StoredAgentEvent[]>;
  /** A reply being typed out on screen; onReplyTyped commits it once fully shown. */
  typingReply: string | null;
  onReplyTyped: () => void;
  activity: Activity | null;
  error: string | null;
  busy: boolean;
  onSend: (text: string) => void;
}

export function ChatThread({
  messages,
  eventsByTurn,
  typingReply,
  onReplyTyped,
  activity,
  error,
  busy,
  onSend,
}: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingReply, activity]);

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
          // Events are keyed by the user message that started the turn, which sits just before its reply.
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

        {typingReply && <TypingBubble text={typingReply} onTyped={onReplyTyped} />}
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
