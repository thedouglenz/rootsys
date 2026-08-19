/**
 * Pure presentation helpers for the mobile Plans surface: status tones for
 * the pills and the dependency-ordered node list the detail screen renders.
 */
import {
  buildDagNodeViews,
  type DagNodeDisplayStatus,
  type DagNodeView,
} from "@t3tools/client-runtime/state/dags";
import { type DagGraph, type DagStatus, topologicalDagOrder } from "@t3tools/contracts";

import type { StatusTone } from "../../components/StatusPill";

const NEUTRAL_TONE = {
  pillClassName: "bg-neutral-500/10 dark:bg-neutral-500/16",
  textClassName: "text-neutral-600 dark:text-neutral-300",
} as const;
const SKY_TONE = {
  pillClassName: "bg-sky-500/12 dark:bg-sky-500/16",
  textClassName: "text-sky-700 dark:text-sky-300",
} as const;
const AMBER_TONE = {
  pillClassName: "bg-amber-500/12 dark:bg-amber-500/16",
  textClassName: "text-amber-700 dark:text-amber-300",
} as const;
const EMERALD_TONE = {
  pillClassName: "bg-emerald-500/12 dark:bg-emerald-500/16",
  textClassName: "text-emerald-700 dark:text-emerald-300",
} as const;
const ROSE_TONE = {
  pillClassName: "bg-rose-500/12 dark:bg-rose-500/16",
  textClassName: "text-rose-700 dark:text-rose-300",
} as const;
const VIOLET_TONE = {
  pillClassName: "bg-violet-500/12 dark:bg-violet-500/16",
  textClassName: "text-violet-700 dark:text-violet-300",
} as const;

export function dagStatusTone(status: DagStatus): StatusTone {
  switch (status) {
    case "draft":
      return { label: "Draft", ...NEUTRAL_TONE };
    case "ready":
      return { label: "Ready", ...VIOLET_TONE };
    case "running":
      return { label: "Running", ...SKY_TONE };
    case "paused":
      return { label: "Paused", ...AMBER_TONE };
    case "completed":
      return { label: "Completed", ...EMERALD_TONE };
    case "failed":
      return { label: "Failed", ...ROSE_TONE };
    case "archived":
      return { label: "Archived", ...NEUTRAL_TONE };
  }
}

export function dagNodeStatusTone(status: DagNodeDisplayStatus): StatusTone {
  switch (status) {
    case "pending":
      return { label: "Pending", ...NEUTRAL_TONE };
    case "ready":
      return { label: "Ready", ...VIOLET_TONE };
    case "running":
      return { label: "Running", ...SKY_TONE };
    case "blocked":
      return { label: "Blocked", ...AMBER_TONE };
    case "done":
      return { label: "Done", ...EMERALD_TONE };
    case "failed":
      return { label: "Failed", ...ROSE_TONE };
    case "skipped":
      return { label: "Skipped", ...NEUTRAL_TONE };
  }
}

/**
 * Node views in dependency order (upstream before downstream). Falls back to
 * stored order if the graph somehow has a cycle, so the list never goes blank.
 */
export function orderedDagNodeViews(graph: DagGraph): ReadonlyArray<DagNodeView> {
  const views = buildDagNodeViews(graph);
  const order = topologicalDagOrder(graph);
  if (order === null) return views;
  const byId = new Map(views.map((view) => [view.node.nodeId, view] as const));
  return order.flatMap((nodeId) => {
    const view = byId.get(nodeId);
    return view === undefined ? [] : [view];
  });
}

/** One-line summary under a node: outcome summary, else a description excerpt. */
export function dagNodeSummaryLine(view: DagNodeView): string | null {
  const summary = view.node.outcome?.summary;
  if (summary !== null && summary !== undefined && summary.length > 0) return summary;
  return view.node.description.length > 0 ? view.node.description : null;
}
