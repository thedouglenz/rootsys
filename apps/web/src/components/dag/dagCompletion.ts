/**
 * Pure helpers for "this plan is finished": the counts and timings the
 * completion banner reads. Kept out of the component so the arithmetic and
 * the wording can be tested without rendering.
 */
import type { DagGraph } from "@t3tools/contracts";

export interface DagCompletionSummary {
  readonly total: number;
  readonly done: number;
  readonly skipped: number;
  readonly failed: number;
  /** When the last node finished; null when no node recorded a finish. */
  readonly finishedAt: string | null;
  /**
   * Time between the first and the last node finishing. Nodes record no start
   * time, so this is the span of the run's finishes rather than its full wall
   * clock; null when fewer than two nodes finished.
   */
  readonly nodeSpanMs: number | null;
}

/**
 * Counts every node and, from the terminal ones, when the run finished.
 * `outcome.completedAt` is the recorded finish; `updatedAt` is the fallback
 * for nodes stored before outcomes existed.
 */
export function summarizeDagCompletion(graph: Pick<DagGraph, "nodes">): DagCompletionSummary {
  let done = 0;
  let skipped = 0;
  let failed = 0;
  let firstFinishMs: number | null = null;
  let lastFinishMs: number | null = null;
  for (const node of graph.nodes) {
    if (node.status === "done") done += 1;
    else if (node.status === "skipped") skipped += 1;
    else if (node.status === "failed") failed += 1;
    else continue;
    const finishedMs = Date.parse(node.outcome?.completedAt ?? node.updatedAt);
    if (Number.isNaN(finishedMs)) continue;
    if (firstFinishMs === null || finishedMs < firstFinishMs) firstFinishMs = finishedMs;
    if (lastFinishMs === null || finishedMs > lastFinishMs) lastFinishMs = finishedMs;
  }
  const spanMs =
    firstFinishMs === null || lastFinishMs === null || lastFinishMs <= firstFinishMs
      ? null
      : lastFinishMs - firstFinishMs;
  return {
    total: graph.nodes.length,
    done,
    skipped,
    failed,
    finishedAt: lastFinishMs === null ? null : new Date(lastFinishMs).toISOString(),
    nodeSpanMs: spanMs,
  };
}

/** `19 of 21 nodes done · 2 skipped`; zero counts are left out. */
export function describeDagCompletionCounts(summary: DagCompletionSummary): string {
  const parts = [`${summary.done} of ${summary.total} node${summary.total === 1 ? "" : "s"} done`];
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  return parts.join(" · ");
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Compact span label for a run: `45s`, `12m`, `2h 5m`, `1d 3h`. */
export function formatDagDurationLabel(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < MINUTE_MS) {
    return `${Math.max(1, Math.round(Math.max(durationMs, 0) / 1_000))}s`;
  }
  if (durationMs < HOUR_MS) return `${Math.floor(durationMs / MINUTE_MS)}m`;
  if (durationMs < DAY_MS) {
    const hours = Math.floor(durationMs / HOUR_MS);
    const minutes = Math.floor((durationMs % HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  const days = Math.floor(durationMs / DAY_MS);
  const hours = Math.floor((durationMs % DAY_MS) / HOUR_MS);
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}
