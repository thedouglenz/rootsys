/**
 * Pure helpers for the thread <-> plan link on mobile: the chip label shown
 * on a linked thread, and the "Threads" list a plan shows for its planner,
 * companion, and executor threads.
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { DagGraph, DagId, ThreadDagLink, ThreadDagRole } from "@t3tools/contracts";

export function threadDagRoleLabel(role: ThreadDagRole): string {
  switch (role) {
    case "executor":
      return "Executor";
    case "planner":
      return "Planner";
    case "companion":
      return "Companion";
  }
}

/**
 * Chip text for a linked thread: `Plan · <node title>` for executors (falls
 * back to "node" while the graph is loading or the node is gone), otherwise
 * `Plan · planner` / `Plan · companion`.
 */
export function threadPlanChipLabel(link: ThreadDagLink, graph: DagGraph | null): string {
  if (link.role === "executor") {
    const title =
      link.nodeId === null
        ? null
        : (graph?.nodes.find((node) => node.nodeId === link.nodeId)?.title ?? null);
    return `Plan · ${title ?? "node"}`;
  }
  return `Plan · ${link.role}`;
}

export interface LinkedPlanThread {
  readonly thread: EnvironmentThreadShell;
  readonly role: ThreadDagRole;
  /** Executor rows name their node; planner/companion rows have none. */
  readonly nodeTitle: string | null;
}

const ROLE_ORDER: Record<ThreadDagRole, number> = { planner: 0, companion: 1, executor: 2 };

/**
 * Threads linked to `dagId`, planners first, then companions, then executors;
 * newest first within a role. Archived shells are kept out so the list matches
 * what the home list shows.
 */
export function linkedPlanThreads(
  shells: ReadonlyArray<EnvironmentThreadShell>,
  dagId: DagId,
  graph: DagGraph | null,
): ReadonlyArray<LinkedPlanThread> {
  const nodeTitle = new Map(graph?.nodes.map((node) => [node.nodeId, node.title] as const) ?? []);
  const linked: LinkedPlanThread[] = [];
  for (const thread of shells) {
    const link = thread.dagLink;
    if (!link || link.dagId !== dagId || thread.archivedAt !== null) continue;
    linked.push({
      thread,
      role: link.role,
      nodeTitle: link.nodeId === null ? null : (nodeTitle.get(link.nodeId) ?? null),
    });
  }
  return linked.sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      b.thread.updatedAt.localeCompare(a.thread.updatedAt),
  );
}
