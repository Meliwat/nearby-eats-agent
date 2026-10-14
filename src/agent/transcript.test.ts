import { describe, expect, it } from "vitest";
import type { ToolCallPayload } from "./tool-summary";
import { trimTranscript, withActionNotes, type TranscriptRow } from "./transcript";

const search: ToolCallPayload = {
  toolUseId: "t",
  name: "search_restaurants",
  input: { diets: [], cities: [] },
  output: { arrival: "Fri 7pm", candidate_count: 3, excluded: [] },
  isError: false,
};

describe("trimTranscript", () => {
  it("orders oldest first, drops empty rows, and starts at a user message", () => {
    const newestFirst: TranscriptRow[] = [
      { id: "4", role: "assistant", content: "pick" },
      { id: "3", role: "user", content: "tacos" },
      { id: "2", role: "assistant", content: "  " },
      { id: "1", role: "assistant", content: "leftover reply cut off by the window" },
    ];
    expect(trimTranscript(newestFirst).map((row) => row.id)).toEqual(["3", "4"]);
  });
});

describe("withActionNotes", () => {
  const transcript: TranscriptRow[] = [
    { id: "u1", role: "user", content: "tacos" },
    { id: "a1", role: "assistant", content: "Casa Verde" },
    { id: "u2", role: "user", content: "thanks" },
    { id: "a2", role: "assistant", content: "enjoy" },
  ];

  it("puts each turn's note between its user message and its reply", () => {
    const messages = withActionNotes(transcript, [{ turnMessageId: "u1", payload: search }]);
    expect(messages.map((m) => m.role)).toEqual(["user", "system", "assistant", "user", "assistant"]);
    expect(messages[1].content).toContain("search_restaurants");
  });

  it("never attaches one turn's tool calls to another turn's reply", () => {
    const messages = withActionNotes(transcript, [{ turnMessageId: "u2", payload: search }]);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "system", "assistant"]);
  });
});
