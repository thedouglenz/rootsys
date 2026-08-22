/**
 * DAG timeline (trellis): pure mapping from a DAG's `dag.*` events to the
 * flat `DagTimelineEntry` rows clients render as a run log.
 */
import type { DagTimelineActor, DagTimelineEntry, OrchestrationEvent } from "@t3tools/contracts";

/** Who drove a command, read off the commandId prefix conventions. */
export function dagTimelineActorFromCommandId(commandId: string | null): DagTimelineActor {
  if (commandId === null) return "server";
  if (commandId.startsWith("mcp:")) return "agent";
  if (commandId.startsWith("server:dag-")) return "engine";
  if (commandId.startsWith("server:") || commandId.startsWith("provider:")) return "server";
  return "user";
}

const TERMINAL_NODE_STATUSES: ReadonlySet<string> = new Set(["done", "failed", "skipped"]);

export function dagTimelineEntryFromEvent(event: OrchestrationEvent): DagTimelineEntry | null {
  const base = {
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    actor: dagTimelineActorFromCommandId(event.commandId),
    nodeId: null,
    status: null,
    threadId: null,
    questionId: null,
    detail: null,
  } as const;
  switch (event.type) {
    case "dag.created":
      return { ...base, kind: "dag-created", detail: event.payload.title };
    case "dag.status-set":
      return { ...base, kind: "dag-status", status: event.payload.status };
    case "dag.node-status-set": {
      const { payload } = event;
      return {
        ...base,
        kind: "node-status",
        nodeId: payload.nodeId,
        status: payload.status,
        // Terminal events carry the bound thread on the outcome.
        threadId: payload.threadId ?? payload.outcome?.threadId ?? null,
        detail: TERMINAL_NODE_STATUSES.has(payload.status)
          ? (payload.outcome?.summary ?? null)
          : null,
      };
    }
    case "dag.node-upserted":
      return {
        ...base,
        kind: "node-upserted",
        nodeId: event.payload.node.nodeId,
        status: event.payload.node.status,
        threadId: event.payload.node.threadId,
        detail: event.payload.node.title,
      };
    case "dag.node-deleted":
      return { ...base, kind: "node-deleted", nodeId: event.payload.nodeId };
    case "dag.edge-added":
      return {
        ...base,
        kind: "edge-added",
        nodeId: event.payload.toNodeId,
        detail: `${event.payload.fromNodeId} -> ${event.payload.toNodeId}`,
      };
    case "dag.edge-removed":
      return {
        ...base,
        kind: "edge-removed",
        nodeId: event.payload.toNodeId,
        detail: `${event.payload.fromNodeId} -> ${event.payload.toNodeId}`,
      };
    case "dag.question-asked": {
      const { question } = event.payload;
      return {
        ...base,
        kind: "question-asked",
        nodeId: question.nodeId,
        status: question.status,
        threadId: question.threadId,
        questionId: question.questionId,
        detail: question.prompt,
      };
    }
    case "dag.question-answered": {
      const { payload } = event;
      return {
        ...base,
        kind: "question-answered",
        nodeId: payload.nodeId,
        status: payload.status,
        questionId: payload.questionId,
        detail: payload.answer,
      };
    }
    default:
      return null;
  }
}

export function dagTimelineEntriesFromEvents(
  events: ReadonlyArray<OrchestrationEvent>,
): ReadonlyArray<DagTimelineEntry> {
  const entries: DagTimelineEntry[] = [];
  for (const event of events) {
    const entry = dagTimelineEntryFromEvent(event);
    if (entry !== null) entries.push(entry);
  }
  return entries;
}
