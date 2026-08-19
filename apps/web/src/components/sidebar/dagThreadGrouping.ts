/**
 * Pure grouping of sidebar thread rows by the plan they belong to (rootsys).
 * Input is an already-sorted row list; output keeps that order and folds
 * threads sharing a `dagLink.dagId` into one group placed where the first
 * (most recent) member sat. Single linked threads stay plain rows: a header
 * for one row is noise.
 */
import type { DagId, EnvironmentId, ThreadDagLink } from "@t3tools/contracts";

export interface DagGroupableThread {
  readonly environmentId: EnvironmentId;
  readonly title: string;
  readonly dagLink?: ThreadDagLink | null | undefined;
}

export type SidebarThreadListItem<T extends DagGroupableThread> =
  | { readonly kind: "thread"; readonly thread: T }
  | {
      readonly kind: "plan-group";
      /** `${environmentId}:${dagId}`, stable across renders; also the collapse key. */
      readonly key: string;
      readonly environmentId: EnvironmentId;
      readonly dagId: DagId;
      readonly threads: ReadonlyArray<T>;
    };

export const dagGroupKey = (environmentId: EnvironmentId, dagId: DagId) =>
  `${environmentId}:${dagId}`;

export function groupSidebarThreadsByDag<T extends DagGroupableThread>(
  threads: ReadonlyArray<T>,
): ReadonlyArray<SidebarThreadListItem<T>> {
  const membersByKey = new Map<string, T[]>();
  for (const thread of threads) {
    const link = thread.dagLink;
    if (!link) continue;
    const key = dagGroupKey(thread.environmentId, link.dagId);
    const members = membersByKey.get(key);
    if (members) members.push(thread);
    else membersByKey.set(key, [thread]);
  }
  const items: SidebarThreadListItem<T>[] = [];
  const emitted = new Set<string>();
  for (const thread of threads) {
    const link = thread.dagLink;
    if (!link) {
      items.push({ kind: "thread", thread });
      continue;
    }
    const key = dagGroupKey(thread.environmentId, link.dagId);
    const members = membersByKey.get(key) ?? [];
    if (members.length < 2) {
      items.push({ kind: "thread", thread });
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    items.push({
      kind: "plan-group",
      key,
      environmentId: thread.environmentId,
      dagId: link.dagId,
      threads: members,
    });
  }
  return items;
}

const ROLE_TITLE_PREFIXES = ["Plan: ", "Companion: "] as const;

/**
 * Best-effort plan title from member thread titles while the DAG graph is
 * still loading: executors are titled `"<plan>: <node>"`, planner and
 * companion threads `"Plan: <plan>"` / `"Companion: <plan>"`.
 */
export function fallbackDagTitle(threads: ReadonlyArray<DagGroupableThread>): string | null {
  for (const thread of threads) {
    if (thread.dagLink?.role !== "executor") continue;
    const index = thread.title.indexOf(": ");
    if (index > 0) return thread.title.slice(0, index);
  }
  for (const thread of threads) {
    for (const prefix of ROLE_TITLE_PREFIXES) {
      if (thread.title.startsWith(prefix) && thread.title.length > prefix.length) {
        return thread.title.slice(prefix.length);
      }
    }
  }
  return null;
}
