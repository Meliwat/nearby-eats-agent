"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoredAgentEvent, StreamMessage } from "@/agent/events";
import type { ConversationState } from "@/agent/events";
import type { Activity } from "./activity-indicator";
import { ChatThread } from "./chat-thread";
import { Inspector } from "./inspector";

export type ChatMessage = ConversationState["messages"][number];
export type Fact = ConversationState["facts"][number];

const PENDING_USER_ID = "pending-user";

export function ChatApp() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [eventsByTurn, setEventsByTurn] = useState<Record<string, StoredAgentEvent[]>>({});
  const [facts, setFacts] = useState<Fact[]>([]);
  /** Fact keys changed during the latest turn, highlighted in the inspector. */
  const [changedKeys, setChangedKeys] = useState<string[]>([]);
  /** The reply as streamed so far; the thread reveals it with a typewriter. */
  const [draft, setDraft] = useState<string | null>(null);
  /** The finished reply, committed to the transcript once the typewriter has revealed all of it. */
  const [finishedReply, setFinishedReply] = useState<ChatMessage | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "inspector">("chat");

  const loadState = useCallback(async (id: string | null) => {
    const query = id ? `?conversationId=${encodeURIComponent(id)}` : "";
    const response = await fetch(`/api/state${query}`, { cache: "no-store" });
    if (!response.ok) return setError("Couldn't load the conversation.");
    const state: ConversationState = await response.json();
    setConversationId(state.conversationId);
    setMessages(state.messages);
    setEventsByTurn(state.eventsByTurn);
    setFacts(state.facts);
    setChangedKeys([]);
    if (!state.conversationId) updateUrl(null);
  }, []);

  useEffect(() => {
    // Initial load from the URL; setState happens after the fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadState(new URLSearchParams(window.location.search).get("c"));
  }, [loadState]);

  const handleStreamMessage = useCallback((message: StreamMessage, turn: { id: string }) => {
    switch (message.kind) {
      case "turn_started":
        turn.id = message.userMessageId;
        setActivity({ kind: "thinking" });
        setConversationId(message.conversationId);
        updateUrl(message.conversationId);
        setMessages((current) => current.map((m) => (m.id === PENDING_USER_ID ? { ...m, id: message.userMessageId } : m)));
        break;
      case "event": {
        const { event } = message;
        const turnId = turn.id;
        setEventsByTurn((current) => ({ ...current, [turnId]: [...(current[turnId] ?? []), event] }));
        if (event.type === "fact_change" && event.payload.action !== "unchanged") {
          setChangedKeys((current) => [...current, event.payload.key]);
        }
        // A finished tool means the model is up next (or another tool_started follows).
        if (event.type === "tool_call") setActivity({ kind: "thinking" });
        break;
      }
      case "tool_started":
        setActivity({ kind: "tool", name: message.name });
        break;
      case "text":
        setActivity(null);
        setDraft((current) => (current ?? "") + message.delta);
        break;
      case "context":
        setFacts(message.facts);
        break;
      case "done":
        setActivity(null);
        setDraft(message.text);
        setFinishedReply({ id: message.assistantMessageId, role: "assistant", content: message.text });
        break;
      case "error":
        setError(message.message);
        setActivity(null);
        setDraft(null);
        break;
    }
  }, []);

  /** Ends a turn that can't complete: show why, and take back the unsent message bubble. */
  const failTurn = useCallback((message: string) => {
    setMessages((current) => current.filter((m) => m.id !== PENDING_USER_ID));
    setDraft(null);
    setActivity(null);
    setError(message);
  }, []);

  const send = useCallback(
    async (text: string) => {
      setError(null);
      setChangedKeys([]);
      setActivity({ kind: "thinking" });
      setMessages((current) => [...current, { id: PENDING_USER_ID, role: "user", content: text }]);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, message: text }),
        });
        if (!response.ok || !response.body) {
          // The server explains rejections (rate limits, a missing conversation) in JSON.
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          return failTurn(body?.error ?? `Something went wrong (${response.status}). Try again?`);
        }
        // Mutable on purpose: turn_started swaps in the saved user message id, and later events are grouped under it.
        const turn = { id: PENDING_USER_ID };
        let finished = false;
        for await (const line of readLines(response.body)) {
          const message = JSON.parse(line) as StreamMessage;
          if (message.kind === "done" || message.kind === "error") finished = true;
          handleStreamMessage(message, turn);
        }
        // The connection closed without a final message (e.g. the server timed out).
        if (!finished) failTurn("The connection dropped before I finished. Try again?");
      } catch {
        failTurn("Couldn't reach Nearby. Check your connection and try again.");
      }
    },
    [conversationId, handleStreamMessage, failTurn],
  );

  const commitFinishedReply = useCallback(() => {
    if (!finishedReply) return;
    setMessages((current) => [...current, finishedReply]);
    setFinishedReply(null);
    setDraft(null);
  }, [finishedReply]);

  const busy = draft !== null || activity !== null;

  return (
    <div className="flex h-dvh flex-col bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <header className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <div>
          <h1 className="text-base font-semibold">Nearby</h1>
          <p className="text-xs text-stone-500">Where to eat in Orange County, by text</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-stone-200 p-0.5 text-xs lg:hidden dark:border-stone-800">
            {(["chat", "inspector"] as const).map((name) => (
              <button
                key={name}
                onClick={() => setTab(name)}
                className={`rounded-md px-2.5 py-1 capitalize ${tab === name ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : ""}`}
              >
                {name}
              </button>
            ))}
          </div>
          <button
            onClick={() => void loadState(null)}
            disabled={busy}
            className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-50 dark:border-stone-800 dark:hover:bg-stone-900"
          >
            New chat
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className={`${tab === "chat" ? "flex" : "hidden"} min-h-0 flex-col lg:flex`}>
          <ChatThread
            messages={messages}
            eventsByTurn={eventsByTurn}
            draft={draft}
            draftFinished={finishedReply !== null}
            onDraftRevealed={commitFinishedReply}
            activity={activity}
            error={error}
            busy={busy}
            onSend={send}
          />
        </section>
        <section
          className={`${tab === "inspector" ? "flex" : "hidden"} min-h-0 flex-col border-stone-200 lg:flex lg:border-l dark:border-stone-800`}
        >
          <Inspector messages={messages} eventsByTurn={eventsByTurn} facts={facts} changedKeys={changedKeys} />
        </section>
      </main>
    </div>
  );
}

function updateUrl(conversationId: string | null) {
  const url = new URL(window.location.href);
  if (conversationId) url.searchParams.set("c", conversationId);
  else url.searchParams.delete("c");
  window.history.replaceState(null, "", url);
}

/** Splits a streamed response body into complete lines (NDJSON). */
async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) yield line;
  }
  if (buffer.trim()) yield buffer;
}
