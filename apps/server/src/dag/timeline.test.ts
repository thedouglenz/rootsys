import {
  CommandId,
  DagId,
  DagNodeId,
  DagQuestionId,
  EventId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { dagTimelineActorFromCommandId, dagTimelineEntriesFromEvents } from "./timeline.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const dagId = DagId.make("dag-1");
const nodeA = DagNodeId.make("node-a");
const nodeB = DagNodeId.make("node-b");
const threadId = ThreadId.make("thread-1");
const questionId = DagQuestionId.make("q-1");

function event(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly commandId?: string | null;
  readonly payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: "dag",
    aggregateId: dagId,
    occurredAt: NOW,
    commandId:
      input.commandId === null ? null : CommandId.make(input.commandId ?? `cmd-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

describe("dagTimelineActorFromCommandId", () => {
  it("reads the actor off the command id prefix", () => {
    expect(dagTimelineActorFromCommandId("mcp:dag:1")).toBe("agent");
    expect(dagTimelineActorFromCommandId("server:dag-node-status:1")).toBe("engine");
    expect(dagTimelineActorFromCommandId("server:other:1")).toBe("server");
    expect(dagTimelineActorFromCommandId("provider:1")).toBe("server");
    expect(dagTimelineActorFromCommandId(null)).toBe("server");
    expect(dagTimelineActorFromCommandId("cmd-from-ui")).toBe("user");
  });
});

describe("dagTimelineEntriesFromEvents", () => {
  it("maps each DAG event kind to a flat entry and skips the rest", () => {
    const entries = dagTimelineEntriesFromEvents([
      event({
        sequence: 1,
        type: "dag.created",
        payload: {
          dagId,
          title: "Plan",
          description: "",
          primaryProjectId: null,
          defaultModelSelection: null,
          createdAt: NOW,
        },
      }),
      event({
        sequence: 2,
        type: "dag.node-upserted",
        commandId: "mcp:dag:2",
        payload: {
          dagId,
          node: { nodeId: nodeA, title: "A", status: "pending", threadId: null },
          addedEdges: [],
          updatedAt: NOW,
        },
      }),
      event({
        sequence: 3,
        type: "dag.edge-added",
        payload: { dagId, fromNodeId: nodeA, toNodeId: nodeB, updatedAt: NOW },
      }),
      event({
        sequence: 4,
        type: "dag.status-set",
        payload: { dagId, status: "running", updatedAt: NOW },
      }),
      event({
        sequence: 5,
        type: "dag.node-status-set",
        commandId: "server:dag-node-status:5",
        payload: { dagId, nodeId: nodeA, status: "running", threadId, updatedAt: NOW },
      }),
      event({
        sequence: 6,
        type: "dag.question-asked",
        commandId: "mcp:dag:6",
        payload: {
          dagId,
          question: {
            questionId,
            dagId,
            nodeId: nodeA,
            threadId,
            prompt: "Which DB?",
            options: [],
            status: "open",
            answer: null,
            createdAt: NOW,
            answeredAt: null,
          },
          updatedAt: NOW,
        },
      }),
      event({
        sequence: 7,
        type: "dag.question-answered",
        payload: {
          dagId,
          questionId,
          nodeId: nodeA,
          status: "answered",
          answer: "postgres",
          answeredAt: NOW,
          updatedAt: NOW,
        },
      }),
      event({
        sequence: 8,
        type: "dag.node-status-set",
        commandId: "mcp:dag:8",
        payload: {
          dagId,
          nodeId: nodeA,
          status: "done",
          outcome: { summary: "a done", threadId, completedAt: NOW },
          updatedAt: NOW,
        },
      }),
      event({
        sequence: 9,
        type: "dag.edge-removed",
        payload: { dagId, fromNodeId: nodeA, toNodeId: nodeB, updatedAt: NOW },
      }),
      event({
        sequence: 10,
        type: "dag.node-deleted",
        payload: { dagId, nodeId: nodeB, updatedAt: NOW },
      }),
      event({
        sequence: 11,
        type: "dag.meta-updated",
        payload: { dagId, title: "Renamed", updatedAt: NOW },
      }),
    ]);

    expect(entries.map((entry) => [entry.sequence, entry.kind, entry.actor])).toEqual([
      [1, "dag-created", "user"],
      [2, "node-upserted", "agent"],
      [3, "edge-added", "user"],
      [4, "dag-status", "user"],
      [5, "node-status", "engine"],
      [6, "question-asked", "agent"],
      [7, "question-answered", "user"],
      [8, "node-status", "agent"],
      [9, "edge-removed", "user"],
      [10, "node-deleted", "user"],
    ]);
    expect(entries[0]).toMatchObject({ detail: "Plan", nodeId: null, threadId: null });
    expect(entries[1]).toMatchObject({ nodeId: nodeA, status: "pending", detail: "A" });
    expect(entries[2]).toMatchObject({ nodeId: nodeB, detail: `${nodeA} -> ${nodeB}` });
    expect(entries[3]).toMatchObject({ status: "running", nodeId: null });
    // Non-terminal status: bound thread is reported, no outcome detail.
    expect(entries[4]).toMatchObject({
      nodeId: nodeA,
      status: "running",
      threadId,
      detail: null,
    });
    expect(entries[5]).toMatchObject({
      nodeId: nodeA,
      questionId,
      threadId,
      status: "open",
      detail: "Which DB?",
    });
    expect(entries[6]).toMatchObject({ questionId, status: "answered", detail: "postgres" });
    // Terminal status: outcome summary is the detail.
    expect(entries[7]).toMatchObject({ status: "done", detail: "a done", threadId });
    expect(entries[9]).toMatchObject({ nodeId: nodeB });
    expect(entries.every((entry) => entry.occurredAt === NOW)).toBe(true);
  });
});
