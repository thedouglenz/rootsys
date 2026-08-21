/**
 * Pure grouping of sidebar thread rows by the plan they belong to (rootsys).
 * Input is an already-sorted row list; output keeps that order and folds
 * threads sharing a `dagLink.dagId` into one group placed where the first
 * (most recent) member sat. Single linked threads stay plain rows: a header
 * for one row is noise.
 */
import {
  DAG_COMPANION_TITLE_PREFIX,
  DAG_PLANNER_TITLE_PREFIX,
  type DagId,
  type EnvironmentId,
  type ThreadDagLink,
} from "@t3tools/contracts";

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

/** `"Planning — "` → `"Planning"`: the role word its prefix is built from. */
const roleWord = (prefix: string) => prefix.replace(/[\s—:]+$/u, "");

// Newest first; the `"Plan: "` / `"Companion: "` forms are what servers before
// the rename produced, and remote environments can still be on those. Both
// forms resolve to the current role word, so a legacy title reads the same as
// a fresh one.
const ROLE_TITLES = {
  planner: {
    word: roleWord(DAG_PLANNER_TITLE_PREFIX),
    prefixes: [DAG_PLANNER_TITLE_PREFIX, "Plan: "],
  },
  companion: {
    word: roleWord(DAG_COMPANION_TITLE_PREFIX),
    prefixes: [DAG_COMPANION_TITLE_PREFIX, "Companion: "],
  },
} as const;

/** The plan title carried by a planner/companion title, or null. */
function planTitleFrom(thread: DagGroupableThread): string | null {
  const role = thread.dagLink?.role;
  if (role !== "planner" && role !== "companion") return null;
  for (const prefix of ROLE_TITLES[role].prefixes) {
    if (thread.title.startsWith(prefix) && thread.title.length > prefix.length) {
      return thread.title.slice(prefix.length);
    }
  }
  return null;
}

/**
 * Best-effort plan title from member thread titles while the DAG graph is
 * still loading. Only planner and companion threads carry it — executors are
 * titled after their node alone — so a group of executors falls back to null
 * and the header waits for the graph.
 */
export function fallbackDagTitle(threads: ReadonlyArray<DagGroupableThread>): string | null {
  for (const thread of threads) {
    const planTitle = planTitleFrom(thread);
    if (planTitle !== null) return planTitle;
  }
  return null;
}

/**
 * What a member row shows *inside its plan group*, where the header already
 * says which plan this is: a planner or companion thread drops the plan title
 * its stored name repeats and reads as just `Planning` / `Companion`.
 * Executors are node-titled already, and a renamed thread keeps its name.
 * Render-time only — the stored title stays meaningful in search, on mobile,
 * and anywhere the row appears outside the group.
 */
export function dagMemberDisplayTitle(thread: DagGroupableThread): string {
  const role = thread.dagLink?.role;
  if (role !== "planner" && role !== "companion") return thread.title;
  return planTitleFrom(thread) === null ? thread.title : ROLE_TITLES[role].word;
}
