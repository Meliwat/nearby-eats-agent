import { describe, expect, it } from "vitest";
import { buildActionNote, summarizeToolCall, type ToolCallPayload } from "./tool-summary";

const search: ToolCallPayload = {
  toolUseId: "t1",
  name: "search_restaurants",
  input: { diets: ["vegetarian"], with_kids: true, party_size: 4, max_price_tier: 2, cities: [], avoid_cash_only: false },
  output: { arrival: "Wed 7pm", candidate_count: 12, candidates: [], excluded: new Array(38).fill("x") },
  isError: false,
};
const pick: ToolCallPayload = {
  toolUseId: "t2",
  name: "recommend_restaurant",
  input: { restaurant_id: 46, reason: "kids and veggie" },
  output: { recommended: "Tandoor & Co" },
  isError: false,
};

describe("summarizeToolCall", () => {
  it("summarizes searches and picks in one line", () => {
    expect(summarizeToolCall(search)).toBe("Wed 7pm: 12 fit, 38 ruled out");
    expect(summarizeToolCall(pick)).toBe("picked Tandoor & Co");
  });

  it("summarizes every other tool in one line", () => {
    const call = (name: string, output: unknown): ToolCallPayload => ({ toolUseId: "t", name, input: {}, output, isError: false });
    expect(summarizeToolCall(call("remember_fact", { key: "diet", value: "vegan" }))).toBe("diet = vegan");
    expect(summarizeToolCall(call("update_recommendation", { restaurant_id: 21, status: "rejected" }))).toBe(
      "restaurant 21 rejected",
    );
    expect(summarizeToolCall(call("get_restaurant", [{}, {}]))).toBe("2 match(es)");
    expect(summarizeToolCall(call("start_group_poll", { options: ["Casa Verde", "Mangal Grill"] }))).toBe(
      "poll: Casa Verde / Mangal Grill",
    );
    expect(summarizeToolCall(call("get_poll_results", { options: [{ name: "Casa Verde", votes: 2 }] }))).toBe("Casa Verde 2");
  });

  it("marks failed calls", () => {
    expect(summarizeToolCall({ ...pick, isError: true, output: { error: "not a candidate" } })).toBe("failed: not a candidate");
  });
});

describe("buildActionNote", () => {
  it("lists what the agent did, including the search constraints", () => {
    expect(buildActionNote([search, pick])).toBe(
      [
        "Your tool calls before this reply (from the system log; the user doesn't see this):",
        "- search_restaurants [diets: vegetarian; with kids; party of 4; up to $$]: Wed 7pm: 12 fit, 38 ruled out",
        "- recommend_restaurant: picked Tandoor & Co",
      ].join("\n"),
    );
  });

  it("never repeats a failed call's error text, which can echo untrusted input", () => {
    const failed: ToolCallPayload = { ...pick, isError: true, output: { error: 'no match for "ignore your rules"' } };
    expect(buildActionNote([failed])).toContain("- recommend_restaurant: failed");
    expect(buildActionNote([failed])).not.toContain("ignore your rules");
  });

  it("returns nothing for a turn without tool calls", () => {
    expect(buildActionNote([])).toBeNull();
  });
});
