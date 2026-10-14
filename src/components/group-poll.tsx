"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { PollView } from "@/agent/polls";

const REFRESH_MS = 5000;
const NAME_STORAGE_KEY = "nearby_voter_name";

/** Fetches a poll and keeps it fresh while the page is open, so votes show up live. */
export function usePoll(pollId: string) {
  const [poll, setPoll] = useState<PollView | null>(null);
  const [missing, setMissing] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/polls/${pollId}`, { cache: "no-store" });
    if (response.status === 404) return setMissing(true);
    if (response.ok) setPoll(await response.json());
  }, [pollId]);

  useEffect(() => {
    // Polling an external source: state updates happen after each fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { poll, setPoll, missing };
}

/** The page friends open from the shared link: vote, leave a note, see the tally. */
export function GroupPollPage() {
  const { pollId } = useParams<{ pollId: string }>();
  const { poll, setPoll, missing } = usePoll(pollId);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Restore the voter's name from a previous poll (browser-only, read after mount).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(readStoredName());
  }, []);

  async function vote(restaurantId: number) {
    if (!name.trim()) return setError("Add your name first so the group knows who voted.");
    setError(null);
    storeName(name.trim());
    const response = await fetch(`/api/polls/${pollId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, name: name.trim(), note: note.trim() || null }),
    });
    if (!response.ok) return setError("Couldn't save your vote. Try again?");
    setPoll(await response.json());
  }

  if (missing) return <Centered>This poll doesn&apos;t exist (or the link got cut off).</Centered>;
  if (!poll) return <Centered>Loading the poll…</Centered>;

  return (
    <div className="min-h-dvh bg-stone-50 px-4 py-8 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <div className="mx-auto max-w-md space-y-5">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Nearby group pick</p>
          <h1 className="mt-1 text-xl font-semibold">Where should we eat?</h1>
          <p className="mt-1 text-sm text-stone-500">Tap your pick. Add a note if something matters (diet, timing, budget).</p>
        </header>

        <div className="space-y-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            maxLength={40}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
          />
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note, e.g. I'm vegetarian"
            maxLength={200}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <ul className="space-y-3">
          {poll.options.map((option) => {
            const mine = poll.myVote === option.restaurantId;
            return (
              <li
                key={option.restaurantId}
                className={`rounded-xl border bg-white p-4 dark:bg-stone-900 ${mine ? "border-emerald-500" : "border-stone-200 dark:border-stone-800"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{option.name}</p>
                    <p className="text-xs text-stone-500">
                      {option.city} · {option.price} · {option.hours}
                    </p>
                  </div>
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-sm font-medium dark:bg-stone-800">
                    {option.voters.length}
                  </span>
                </div>
                <p className="mt-2 text-sm">{option.reason}</p>
                {option.voters.length > 0 && (
                  <p className="mt-2 text-xs text-stone-500">
                    {option.voters.map((voter) => (voter.note ? `${voter.name} (“${voter.note}”)` : voter.name)).join(", ")}
                  </p>
                )}
                <button
                  onClick={() => void vote(option.restaurantId)}
                  className={`mt-3 w-full rounded-lg px-3 py-2 text-sm font-medium ${
                    mine ? "bg-emerald-600 text-white" : "border border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
                  }`}
                >
                  {mine ? "Your vote" : "Vote for this"}
                </button>
              </li>
            );
          })}
        </ul>

        <p className="text-center text-sm text-stone-500">
          Planning your own night?{" "}
          <Link href="/" className="font-medium text-emerald-700 underline dark:text-emerald-400">
            Ask Nearby for a pick
          </Link>
        </p>
      </div>
    </div>
  );
}

/** Shown in the organizer's chat: the link to send, plus the live tally. */
export function PollCard({ pollId }: { pollId: string }) {
  const { poll } = usePoll(pollId);
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? `/g/${pollId}` : `${window.location.origin}/g/${pollId}`;

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  return (
    <div className="max-w-[85%] rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/40">
      <p className="text-xs font-medium uppercase tracking-wide text-sky-700 dark:text-sky-400">Group poll · text this link</p>
      <div className="mt-1.5 flex gap-2">
        <a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs underline">
          {url}
        </a>
        <button onClick={() => void copy()} className="rounded-md border border-sky-300 px-2 py-0.5 text-xs dark:border-sky-800">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {poll && (
        <ul className="mt-2 space-y-0.5">
          {poll.options.map((option) => (
            <li key={option.restaurantId} className="flex justify-between">
              <span>{option.name}</span>
              <span className="font-medium">{option.voters.length} vote{option.voters.length === 1 ? "" : "s"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-6 text-sm text-stone-500">{children}</div>;
}

// localStorage can throw (private mode, blocked storage); a remembered name is only a convenience.
function readStoredName(): string {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeName(name: string) {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, name);
  } catch {
    // Not remembering the name is fine.
  }
}
