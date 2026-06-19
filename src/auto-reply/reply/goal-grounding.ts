/**
 * Per-turn active-goal grounding.
 *
 * When a session has a goal with status `active`, render a compact
 * `[active_goal]` block that re-states the objective and nudges the model to
 * advance it with one concrete step per turn and self-check for drift.
 *
 * This is grounding only: it must not force a channel, approve tools, or
 * schedule work. It renders nothing for any non-active status (paused,
 * blocked, budget_limited, usage_limited, complete) so the model is never
 * pushed to work a goal the operator deliberately halted. Best-effort: any
 * failure renders nothing and never throws.
 *
 * See: shared/specs/goal-per-turn-grounding-spec-2026-06-19.md
 */
import { resolveSessionGoalDisplayState } from "../../config/sessions.js";
import type { SessionEntry } from "../../config/sessions/types.js";

/** Hard cap on rendered objective length to bound per-turn token cost. */
const OBJECTIVE_MAX_CHARS = 600;

function sanitizeObjective(objective: string): string {
  // Collapse newlines/control chars and runs of whitespace so the block stays
  // a clean single-line value, then truncate at the cap with a marker.
  const collapsed = objective
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (collapsed.length <= OBJECTIVE_MAX_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, OBJECTIVE_MAX_CHARS).trimEnd()}…(truncated)`;
}

function formatTokensLine(tokensUsed: number, tokenBudget: number | undefined): string {
  const used = Number.isFinite(tokensUsed) && tokensUsed > 0 ? Math.floor(tokensUsed) : 0;
  if (tokenBudget !== undefined && Number.isFinite(tokenBudget) && tokenBudget > 0) {
    return `tokens=${used}/${Math.floor(tokenBudget)}`;
  }
  return `tokens=${used}`;
}

/**
 * Build the `[active_goal]` grounding block for the current turn, or `""` when
 * there is no active goal (or on any read/projection failure).
 *
 * Uses the display-state projection (no persistence, no IO) so it is safe to
 * call on every turn. `adoptFreshBaseline: false` keeps it read-only.
 */
export function buildActiveGoalGrounding(
  sessionEntry: SessionEntry | undefined,
  now?: number,
): string {
  if (!sessionEntry?.goal) {
    return "";
  }
  let objective: string;
  let tokensUsed: number;
  let tokenBudget: number | undefined;
  try {
    const projected = resolveSessionGoalDisplayState(sessionEntry, now, {
      adoptFreshBaseline: false,
    });
    if (!projected || projected.status !== "active") {
      return "";
    }
    objective = sanitizeObjective(projected.objective ?? "");
    tokensUsed = projected.tokensUsed;
    tokenBudget = projected.tokenBudget;
  } catch {
    // Grounding is best-effort; never break a turn over goal projection.
    return "";
  }
  if (!objective) {
    return "";
  }
  return [
    "[active_goal]",
    `objective=${objective}`,
    "status=active",
    formatTokensLine(tokensUsed, tokenBudget),
    "instruction=Each turn, advance this objective with one concrete step, then re-evaluate. If this turn does not advance it, say why. If it is achieved, call update_goal complete. If genuinely blocked on the same condition repeatedly, call update_goal blocked.",
    "[/active_goal]",
  ].join("\n");
}
