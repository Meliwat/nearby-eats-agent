"use client";

import { useEffect, useState } from "react";

/** What the agent is doing right now, from the live stream. */
export type Activity = { kind: "thinking" } | { kind: "tool"; name: string };

const ROTATE_MS = 1800;

const THINKING_WORDS = [
  "Marinating",
  "Simmering",
  "Sniffing around",
  "Taste-testing",
  "Preheating",
  "Whisking",
  "Foraging",
  "Seasoning to taste",
  "Reading the room",
  "Consulting the menu gods",
  "Asking the locals",
  "Letting it rest",
];

/** Each tool gets words that say what is really happening, plus a color. */
const TOOL_PHRASES: Record<string, { words: string[]; color: string }> = {
  search_restaurants: { words: ["Checking who's still open", "Scanning 50 kitchens", "Reading the menus"], color: "#0ea5e9" },
  get_restaurant: { words: ["Looking it up", "Pulling the file"], color: "#0ea5e9" },
  remember_fact: { words: ["Jotting that down", "Making a mental note"], color: "#8b5cf6" },
  recommend_restaurant: { words: ["Plating your pick", "Saving you a seat"], color: "#10b981" },
  update_recommendation: { words: ["Noting that", "Updating the list"], color: "#8b5cf6" },
  start_group_poll: { words: ["Rounding up the group", "Printing the ballots"], color: "#f59e0b" },
  get_poll_results: { words: ["Counting the votes", "Reading the group chat"], color: "#f59e0b" },
};

const THINKING_COLOR = "#f59e0b";

/** Replaces a bare "…" while the agent works: a steaming bowl and words that follow what it's doing. */
export function ActivityIndicator({ activity }: { activity: Activity }) {
  const phrases = activity.kind === "tool" ? TOOL_PHRASES[activity.name] : undefined;
  const words = phrases?.words ?? THINKING_WORDS;
  const color = phrases?.color ?? THINKING_COLOR;
  const [tick, setTick] = useState(() => Math.floor(Math.random() * THINKING_WORDS.length));

  useEffect(() => {
    const timer = setInterval(() => setTick((current) => current + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, []);

  const word = words[tick % words.length];

  return (
    <div className="flex justify-start" role="status" aria-live="polite">
      <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-white px-3.5 py-2 shadow-sm dark:bg-stone-900">
        <SteamingBowl color={color} />
        <span
          key={word}
          className="shimmer-text text-sm font-medium"
          style={{ "--shimmer-base": `${color}99`, "--shimmer-highlight": color } as React.CSSProperties}
        >
          {word}…
        </span>
      </div>
    </div>
  );
}

function SteamingBowl({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      {[7, 12, 17].map((x, index) => (
        <path
          key={x}
          className="steam"
          style={{ animationDelay: `${index * 0.45}s` }}
          d={`M${x} 9c-1.2-1.4 1.2-2.6 0-4`}
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      ))}
      <g className="bob">
        <path d="M3 12h18a9 9 0 0 1-18 0Z" fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M9 21h6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}
