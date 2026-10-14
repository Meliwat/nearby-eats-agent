"use client";

import { useEffect, useRef, useState } from "react";
import type { StoredAgentEvent } from "@/agent/events";
import type { ChatMessage } from "./chat-app";
import { buildVisitIcs } from "@/lib/calendar";
import { localDateAfter, RESTAURANT_TIME_ZONE, toLocalDayMinute } from "@/lib/restaurants/hours";
import { formatMinute } from "@/lib/restaurants/search";
import { PollCard } from "./group-poll";

const STARTERS = [
  "Where should I eat tonight?",
  "Date night Saturday, somewhere quiet",
  "Cheap vegan lunch near Irvine",
  "Dinner for 8 with kids tomorrow at 6",
];

interface Recommendation {
  recommended: string;
  address: string;
  hours: string;
  reason: string;
  /** Absent on recommendations saved before visit details existed. */
  visit?: { date: string; time: string; open_until: string | null; close_minute: number | null };
}

interface Props {
  messages: ChatMessage[];
  eventsByTurn: Record<string, StoredAgentEvent[]>;
  draft: string | null;
  error: string | null;
  busy: boolean;
  onSend: (text: string) => void;
}

export function ChatThread({ messages, eventsByTurn, draft, error, busy, onSend }: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft]);

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

        {draft !== null && <Bubble role="assistant" text={draft || "…"} pending />}
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

function Bubble({ role, text, pending = false }: { role: "user" | "assistant"; text: string; pending?: boolean }) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
          mine ? "rounded-br-sm bg-emerald-600 text-white" : "rounded-bl-sm bg-white shadow-sm dark:bg-stone-900"
        } ${pending ? "opacity-70" : ""}`}
      >
        {text}
      </p>
    </div>
  );
}

function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
  return (
    <div className="max-w-[85%] rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
      <p className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Nearby&apos;s pick</p>
      <p className="mt-0.5 font-semibold">{recommendation.recommended}</p>
      <p className="text-stone-600 dark:text-stone-400">{recommendation.address}</p>
      <p className="text-stone-600 dark:text-stone-400">{recommendation.hours}</p>
      <p className="mt-1.5">{recommendation.reason}</p>
      {recommendation.visit && <GoNowActions recommendation={recommendation} visit={recommendation.visit} />}
    </div>
  );
}

/** Turns "sounds good" into going: closing time, directions, and a calendar event. */
function GoNowActions({ recommendation, visit }: { recommendation: Recommendation; visit: NonNullable<Recommendation["visit"]> }) {
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${recommendation.recommended}, ${recommendation.address}`,
  )}`;

  function addToCalendar() {
    const ics = buildVisitIcs({
      restaurant: recommendation.recommended,
      address: recommendation.address,
      description: recommendation.reason,
      date: visit.date,
      time: visit.time,
      timeZone: RESTAURANT_TIME_ZONE,
      uid: `${crypto.randomUUID()}@nearby`,
      now: new Date(),
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    link.download = `${recommendation.recommended.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const buttonClass =
    "rounded-md border border-emerald-300 px-2.5 py-1 text-xs font-medium hover:bg-emerald-100 dark:border-emerald-800 dark:hover:bg-emerald-900/40";
  return (
    <div className="mt-2.5 space-y-2">
      {visit.open_until && (
        <p className="text-xs text-stone-600 dark:text-stone-400">
          {formatVisit(visit)} · open until {visit.open_until}
          {closesIn(visit) && <span className="font-medium text-amber-700 dark:text-amber-400"> · {closesIn(visit)}</span>}
        </p>
      )}
      <div className="flex gap-2">
        <a href={directions} target="_blank" rel="noreferrer" className={buttonClass}>
          Directions
        </a>
        <button onClick={addToCalendar} className={buttonClass}>
          Add to calendar
        </button>
      </div>
    </div>
  );
}

/** "Fri, Oct 16 at 7pm", read as a calendar date (no time zone shift). */
function formatVisit(visit: NonNullable<Recommendation["visit"]>): string {
  const [hours, minutes] = visit.time.split(":").map(Number);
  const date = new Date(`${visit.date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${date} at ${formatMinute(hours * 60 + minutes)}`;
}

/** "closes in 1h 20m" once the visit time has arrived today in Orange County; nothing for later visits. */
function closesIn(visit: NonNullable<Recommendation["visit"]>): string | null {
  const now = new Date();
  if (visit.close_minute === null || localDateAfter(now, 0, RESTAURANT_TIME_ZONE) !== visit.date) return null;
  const [hours, minutes] = visit.time.split(":").map(Number);
  const nowMinute = toLocalDayMinute(now, RESTAURANT_TIME_ZONE).minute;
  if (nowMinute < hours * 60 + minutes) return null;
  const left = visit.close_minute - nowMinute;
  if (left <= 0) return "closed now";
  return `closes in ${left >= 60 ? `${Math.floor(left / 60)}h ` : ""}${left % 60}m`;
}

/** The successful recommend_restaurant call in a turn, if the agent made one. */
function recommendationFor(events: StoredAgentEvent[]): Recommendation | null {
  for (const event of [...events].reverse()) {
    if (event.type === "tool_call" && event.payload.name === "recommend_restaurant" && !event.payload.isError) {
      return event.payload.output as Recommendation;
    }
  }
  return null;
}

/** The poll created in a turn, if the agent started one. */
function pollIdFor(events: StoredAgentEvent[]): string | null {
  const created = events.find(
    (event) => event.type === "tool_call" && event.payload.name === "start_group_poll" && !event.payload.isError,
  );
  return created?.type === "tool_call" ? (created.payload.output as { poll_id: string }).poll_id : null;
}
