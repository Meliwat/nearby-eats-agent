"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoredAgentEvent, StreamMessage } from "@/agent/events";
import type { ConversationState } from "@/app/api/state/route";
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
  const [draft, setDraft] = useState<string | null>(null);
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
        break;
      }
      case "text":
        setDraft((current) => (current ?? "") + message.delta);
        break;
      case "context":
        setFacts(message.facts);
        break;
      case "done":
        setMessages((current) => [...current, { id: message.assistantMessageId, role: "assistant", content: message.text }]);
        setDraft(null);
        break;
      case "error":
        setError(message.message);
        setDraft(null);
        break;
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      setError(null);
      setChangedKeys([]);
      setDraft("");
      setMessages((current) => [...current, { id: PENDING_USER_ID, role: "user", content: text }]);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, message: text }),
        });
        if (!response.ok || !response.body) throw new Error(`Request failed (${response.status})`);
        const turn = { id: PENDING_USER_ID };
        for await (const line of readLines(response.body)) {
          handleStreamMessage(JSON.parse(line) as StreamMessage, turn);
        }
      } catch {
        setError("Couldn't reach Nearby. Check your connection and try again.");
        setDraft(null);
      }
    },
    [conversationId, handleStreamMessage],
  );

  const busy = draft !== null;

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
          <ChatThread messages={messages} eventsByTurn={eventsByTurn} draft={draft} error={error} busy={busy} onSend={send} />
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
