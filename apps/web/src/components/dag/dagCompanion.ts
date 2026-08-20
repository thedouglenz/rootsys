/**
 * Pure helpers for the plan page's docked companion chat: which thread the
 * dock adopts, how the dock's open state is persisted, and how a companion
 * thread's messages are shaped for a 380px pane. No React here so the picking
 * rules stay unit-testable and the dock itself stays dumb.
 */
import type { DagId, MessageId, ThreadDagLink, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/**
 * `closed` costs nothing (no thread subscription), `collapsed` keeps the bar
 * and its state dot, `open` shows the transcript.
 */
export const DagCompanionDockState = Schema.Literals(["closed", "collapsed", "open"]);
export type DagCompanionDockState = typeof DagCompanionDockState.Type;

export const DEFAULT_DAG_COMPANION_DOCK_STATE: DagCompanionDockState = "closed";

/** Per-plan, so opening one plan's dock does not open every plan's. */
export const dagCompanionDockStorageKey = (dagId: DagId) => `t3code:plan-companion:${dagId}`;

/** The thread-shell fields the dock needs to adopt an existing companion. */
export interface DagCompanionThreadCandidate {
  readonly id: ThreadId;
  readonly dagLink?: ThreadDagLink | null | undefined;
  readonly archivedAt?: string | null | undefined;
  readonly updatedAt: string;
}

/**
 * The live companion thread for a plan: most recently updated, never
 * archived. Opening the dock reuses it instead of spawning a new thread (and
 * a new brief) on every click.
 */
export function selectCompanionThread<T extends DagCompanionThreadCandidate>(
  threads: ReadonlyArray<T>,
  dagId: DagId,
): T | null {
  let best: T | null = null;
  for (const thread of threads) {
    const link = thread.dagLink;
    if (!link || link.role !== "companion" || link.dagId !== dagId) continue;
    if (thread.archivedAt !== null && thread.archivedAt !== undefined) continue;
    // Ties keep the earlier candidate so the adopted thread is stable.
    if (best === null || thread.updatedAt > best.updatedAt) best = thread;
  }
  return best;
}

/** Rendered message cap. Older turns stay reachable via "Open full thread". */
export const DAG_COMPANION_TRANSCRIPT_LIMIT = 50;

export interface DagCompanionMessageLike {
  readonly id: MessageId;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly streaming?: boolean;
}

export interface DagCompanionTranscriptEntry {
  readonly id: MessageId;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly streaming: boolean;
}

export interface DagCompanionTranscript {
  /** The seeded brief, shown as a collapsed chip rather than a wall of text. */
  readonly brief: string | null;
  readonly entries: ReadonlyArray<DagCompanionTranscriptEntry>;
  /** Entries dropped off the top by the cap. */
  readonly hiddenCount: number;
}

const EMPTY_TRANSCRIPT: DagCompanionTranscript = { brief: null, entries: [], hiddenCount: 0 };

/**
 * Split a companion thread into its seeded brief (the first user message,
 * which is a system-ish prompt) and the conversation after it, capped to the
 * last `limit` entries. Empty and system messages are dropped: tool activity
 * is summarized by the dock, not listed.
 */
export function buildCompanionTranscript(
  messages: ReadonlyArray<DagCompanionMessageLike>,
  limit: number = DAG_COMPANION_TRANSCRIPT_LIMIT,
): DagCompanionTranscript {
  if (messages.length === 0) return EMPTY_TRANSCRIPT;
  const first = messages[0]!;
  const brief = first.role === "user" ? first.text : null;
  const rest = brief === null ? messages : messages.slice(1);
  const kept: DagCompanionTranscriptEntry[] = [];
  for (const message of rest) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (message.text.trim().length === 0) continue;
    kept.push({
      id: message.id,
      role: message.role,
      text: message.text,
      streaming: message.streaming ?? false,
    });
  }
  const hiddenCount = Math.max(0, kept.length - limit);
  return {
    brief,
    entries: hiddenCount === 0 ? kept : kept.slice(hiddenCount),
    hiddenCount,
  };
}
