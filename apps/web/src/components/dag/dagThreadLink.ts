/**
 * Pure helpers for surfaces that show a thread's relation to a DAG: the chat
 * header chip, the sidebar glyph, and the Plan side panel. No React here so
 * the sidebar can memoize on plain data and the logic is unit-testable.
 */
import type { DagGraph, DagNode, DagNodeId, ThreadDagLink } from "@t3tools/contracts";

import type { DagNodeDisplayStatus } from "./dagModel";

/**
 * Text tint per node display status. Mirrors the `DagNodeStatusBadge`
 * variants (info/warning/error/success/destructive) so a glyph and a badge
 * for the same node never disagree.
 */
export const DAG_NODE_STATUS_TINT_CLASS: Record<DagNodeDisplayStatus, string> = {
  pending: "text-muted-foreground/70",
  ready: "text-info-foreground",
  running: "text-warning-foreground",
  blocked: "text-destructive-foreground",
  done: "text-success-foreground",
  failed: "text-destructive",
  skipped: "text-muted-foreground/50",
};

/** Background tint for status dots; same palette as the text tints. */
export const DAG_NODE_STATUS_DOT_CLASS: Record<DagNodeDisplayStatus, string> = {
  pending: "bg-muted-foreground/40",
  ready: "bg-info",
  running: "bg-warning",
  blocked: "bg-destructive",
  done: "bg-success",
  failed: "bg-destructive",
  skipped: "bg-muted-foreground/25",
};

/** Planner and companion threads have no node, so they get the neutral tint. */
export const DAG_LINK_NEUTRAL_TINT_CLASS = "text-muted-foreground/70";

/** `planner` / `companion`, or the executor's node title (`"node"` while it loads). */
export function dagLinkRoleLabel(link: ThreadDagLink, nodeTitle: string | null): string {
  switch (link.role) {
    case "planner":
      return "planner";
    case "companion":
      return "companion";
    case "executor":
      return nodeTitle ?? "node";
  }
}

/** Plan-chip / tooltip text: `Plan ▸ <role label>`. */
export function dagLinkChipLabel(link: ThreadDagLink, nodeTitle: string | null): string {
  return `Plan ▸ ${dagLinkRoleLabel(link, nodeTitle)}`;
}

/**
 * Nodes in dependency order (Kahn). Ties keep the graph's own node order so
 * the list is stable across re-renders; if the graph somehow carries a cycle
 * the leftover nodes are appended in graph order rather than dropped.
 */
export function topologicalDagNodes(
  graph: Pick<DagGraph, "nodes" | "edges">,
): ReadonlyArray<DagNode> {
  const index = new Map<DagNodeId, number>();
  graph.nodes.forEach((node, position) => index.set(node.nodeId, position));
  const indegree = new Map<DagNodeId, number>();
  const downstream = new Map<DagNodeId, DagNodeId[]>();
  for (const node of graph.nodes) indegree.set(node.nodeId, 0);
  for (const edge of graph.edges) {
    if (!index.has(edge.fromNodeId) || !index.has(edge.toNodeId)) continue;
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1);
    const list = downstream.get(edge.fromNodeId);
    if (list) list.push(edge.toNodeId);
    else downstream.set(edge.fromNodeId, [edge.toNodeId]);
  }
  const byPosition = (left: DagNodeId, right: DagNodeId) =>
    (index.get(left) ?? 0) - (index.get(right) ?? 0);
  const frontier = graph.nodes
    .filter((node) => indegree.get(node.nodeId) === 0)
    .map((node) => node.nodeId);
  const ordered: DagNode[] = [];
  const placed = new Set<DagNodeId>();
  while (frontier.length > 0) {
    frontier.sort(byPosition);
    const nodeId = frontier.shift()!;
    const node = graph.nodes[index.get(nodeId)!]!;
    ordered.push(node);
    placed.add(nodeId);
    for (const next of downstream.get(nodeId) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) frontier.push(next);
    }
  }
  if (ordered.length < graph.nodes.length) {
    for (const node of graph.nodes) if (!placed.has(node.nodeId)) ordered.push(node);
  }
  return ordered;
}

/** `done/total` for a graph, counting skipped nodes as done. */
export function dagProgress(graph: Pick<DagGraph, "nodes">): {
  readonly done: number;
  readonly total: number;
} {
  let done = 0;
  for (const node of graph.nodes) {
    if (node.status === "done" || node.status === "skipped") done += 1;
  }
  return { done, total: graph.nodes.length };
}
