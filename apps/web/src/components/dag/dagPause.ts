/**
 * Pure helpers for self-inflicted plan pauses. The engine parks a plan when a
 * provider refuses a turn, when nothing resolves, and so on; these turn that
 * record into the sentences the banner and the resume confirmation show.
 */
import type { DagPauseReason } from "@t3tools/contracts";

/** What the banner offers to fix, if anything. */
export type DagPauseAction = "change-model" | null;

export interface DagPauseDescription {
  readonly headline: string;
  readonly action: DagPauseAction;
}

const DESCRIPTIONS: Record<DagPauseReason["kind"], DagPauseDescription> = {
  "provider-refused": {
    headline: "Paused automatically — the model refused the last turn.",
    action: "change-model",
  },
  "provider-unavailable": {
    // Picking a different instance is the fix, so offer the same action.
    headline: "Paused — that provider instance isn't available.",
    action: "change-model",
  },
  "no-model": {
    headline: "Paused — no model is set for this node or plan.",
    action: "change-model",
  },
  "no-project": { headline: "Paused — this node has no project.", action: null },
  unresolved: { headline: "Paused — nothing could be scheduled.", action: null },
};

export function describeDagPauseReason(reason: DagPauseReason): DagPauseDescription {
  return DESCRIPTIONS[reason.kind];
}

export const DAG_PAUSE_MESSAGE_LIMIT = 200;

/** Provider text for a one-line quote; the full string stays in a `title`. */
export function truncateProviderMessage(
  message: string,
  limit: number = DAG_PAUSE_MESSAGE_LIMIT,
): string {
  const collapsed = message.replace(/\s+/g, " ").trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1).trimEnd()}…`;
}

/** A refusal older than this is probably stale, so resuming needs no warning. */
export const DAG_RESUME_CONFIRM_WINDOW_MS = 10 * 60 * 1000;

/**
 * True when resuming would immediately retry a model that just refused. Clock
 * skew (a pause stamped in the future) counts as recent.
 */
export function shouldConfirmDagResume(
  reason: DagPauseReason | null | undefined,
  nowMs: number,
): boolean {
  if (!reason || reason.kind !== "provider-refused") return false;
  const pausedAtMs = Date.parse(reason.pausedAt);
  if (Number.isNaN(pausedAtMs)) return false;
  return nowMs - pausedAtMs < DAG_RESUME_CONFIRM_WINDOW_MS;
}

/**
 * Confirmation body for resuming a plan the provider just refused. `ageLabel`
 * comes from the app's relative-time formatter so the wording matches the
 * banner the user is looking at.
 */
export function buildDagResumeConfirmMessage(reason: DagPauseReason, ageLabel: string): string {
  const when = ageLabel.trim().length === 0 ? "recently" : ageLabel;
  const quote =
    reason.providerMessage === null ? "" : `\n"${truncateProviderMessage(reason.providerMessage)}"`;
  return [
    `This plan paused ${when} because the model refused the turn.${quote}`,
    "Resuming tries the same model again. If the limit is still in effect, change the model on the parked node first.",
    "Resume anyway?",
  ].join("\n");
}
