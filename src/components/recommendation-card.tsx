"use client";

import type { StoredAgentEvent } from "@/agent/events";
import { buildVisitIcs } from "@/lib/calendar";
import { clockToMinute, formatMinute, localDateAfter, RESTAURANT_TIME_ZONE, toLocalDayMinute } from "@/lib/restaurants/hours";

interface Recommendation {
  recommended: string;
  address: string;
  hours: string;
  reason: string;
  /** Absent on recommendations saved before visit details existed. */
  visit?: Visit;
}

interface Visit {
  date: string;
  time: string;
  open_until: string | null;
  close_minute: number | null;
}

const ACTION_BUTTON_CLASS =
  "rounded-md border border-emerald-300 px-2.5 py-1 text-xs font-medium hover:bg-emerald-100 dark:border-emerald-800 dark:hover:bg-emerald-900/40";

export function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
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
function GoNowActions({ recommendation, visit }: { recommendation: Recommendation; visit: Visit }) {
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${recommendation.recommended}, ${recommendation.address}`,
  )}`;
  const closing = closesIn(visit);

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

  return (
    <div className="mt-2.5 space-y-2">
      {visit.open_until && (
        <p className="text-xs text-stone-600 dark:text-stone-400">
          {formatVisit(visit)} · open until {visit.open_until}
          {closing && <span className="font-medium text-amber-700 dark:text-amber-400"> · {closing}</span>}
        </p>
      )}
      <div className="flex gap-2">
        <a href={directions} target="_blank" rel="noreferrer" className={ACTION_BUTTON_CLASS}>
          Directions
        </a>
        <button onClick={addToCalendar} className={ACTION_BUTTON_CLASS}>
          Add to calendar
        </button>
      </div>
    </div>
  );
}

/** "Fri, Oct 16 at 7pm", read as a calendar date (no time zone shift). */
function formatVisit(visit: Visit): string {
  const date = new Date(`${visit.date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${date} at ${formatMinute(clockToMinute(visit.time))}`;
}

/** "closes in 1h 20m" once the visit time has arrived today in Orange County; nothing for later visits. */
function closesIn(visit: Visit): string | null {
  const now = new Date();
  if (visit.close_minute === null || localDateAfter(now, 0, RESTAURANT_TIME_ZONE) !== visit.date) return null;
  const nowMinute = toLocalDayMinute(now, RESTAURANT_TIME_ZONE).minute;
  if (nowMinute < clockToMinute(visit.time)) return null;
  const left = visit.close_minute - nowMinute;
  if (left <= 0) return "closed now";
  return `closes in ${left >= 60 ? `${Math.floor(left / 60)}h ` : ""}${left % 60}m`;
}


/**
 * The latest successful recommend_restaurant call in a turn, if the agent made one. No card for a
 * turn that ended in a refusal or a failure: its reply is an apology, not the pick.
 */
export function recommendationFor(events: StoredAgentEvent[]): Recommendation | null {
  const endedBadly = events.some(
    (event) =>
      (event.type === "error" && event.payload.stage === "turn") ||
      (event.type === "model_call" && event.payload.stopReason === "refusal"),
  );
  if (endedBadly) return null;
  const call = events.findLast(
    (event) => event.type === "tool_call" && event.payload.name === "recommend_restaurant" && !event.payload.isError,
  );
  return call?.type === "tool_call" ? (call.payload.output as Recommendation) : null;
}
