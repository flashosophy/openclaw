// Per-turn active-goal grounding block tests.
import { describe, expect, it } from "vitest";
import type { SessionEntry, SessionGoal, SessionGoalStatus } from "../../config/sessions/types.js";
import { buildActiveGoalGrounding } from "./goal-grounding.js";

function makeEntry(goal: SessionGoal | undefined, totalTokens = 0): SessionEntry {
  return {
    sessionId: "sess-1",
    updatedAt: 1,
    totalTokens,
    totalTokensFresh: true,
    ...(goal ? { goal } : {}),
  };
}

function makeGoal(overrides: Partial<SessionGoal> = {}): SessionGoal {
  return {
    schemaVersion: 1,
    id: "goal-1",
    objective: "land the PR",
    status: "active",
    createdAt: 1,
    updatedAt: 1,
    tokenStart: 0,
    tokenStartFresh: true,
    tokensUsed: 0,
    continuationTurns: 0,
    ...overrides,
  };
}

describe("buildActiveGoalGrounding", () => {
  it("renders the block for an active goal with objective + tokens", () => {
    const block = buildActiveGoalGrounding(
      makeEntry(makeGoal({ tokensUsed: 12, tokenBudget: 50 })),
    );
    expect(block).toContain("[active_goal]");
    expect(block).toContain("objective=land the PR");
    expect(block).toContain("status=active");
    expect(block).toContain("tokens=12/50");
    expect(block).toContain("update_goal complete");
    expect(block).toContain("[/active_goal]");
  });

  it("renders nothing when there is no goal", () => {
    expect(buildActiveGoalGrounding(makeEntry(undefined))).toBe("");
    expect(buildActiveGoalGrounding(undefined)).toBe("");
  });

  it("renders nothing for non-active statuses", () => {
    const nonActive: SessionGoalStatus[] = [
      "paused",
      "blocked",
      "usage_limited",
      "budget_limited",
      "complete",
    ];
    for (const status of nonActive) {
      const block = buildActiveGoalGrounding(makeEntry(makeGoal({ status })));
      expect(block, `status ${status} should render nothing`).toBe("");
    }
  });

  it("omits the budget when no token budget is set", () => {
    const block = buildActiveGoalGrounding(makeEntry(makeGoal({ tokensUsed: 7 })));
    expect(block).toContain("tokens=7");
    expect(block).not.toContain("tokens=7/");
  });

  it("truncates a very long objective and collapses newlines", () => {
    const longObjective = `multi\nline ${"x".repeat(1000)}`;
    const block = buildActiveGoalGrounding(makeEntry(makeGoal({ objective: longObjective })));
    expect(block).toContain("…(truncated)");
    expect(block).not.toContain("\nline");
    const objectiveLine = block.split("\n").find((line) => line.startsWith("objective="));
    expect(objectiveLine).toBeDefined();
    // objective= prefix + cap + marker, bounded well under the raw 1000+ chars.
    expect((objectiveLine ?? "").length).toBeLessThan(700);
  });

  it("flips to budget_limited via projection when usage meets budget (renders nothing)", () => {
    // Goal stored as active but usage already at/over budget: the display
    // projection downgrades to budget_limited, so grounding renders nothing.
    const entry = makeEntry(
      makeGoal({ status: "active", tokenStart: 0, tokenBudget: 50, tokensUsed: 0 }),
      80,
    );
    expect(buildActiveGoalGrounding(entry)).toBe("");
  });
});
