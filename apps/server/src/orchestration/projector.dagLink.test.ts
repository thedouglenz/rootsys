import {
  CommandId,
  DagId,
  DagNodeId,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const threadId = ThreadId.make("thread-1");
const dagId = DagId.make("dag-1");
const nodeId = DagNodeId.make("node-1");

function makeEvent(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly aggregateKind?: OrchestrationEvent["aggregateKind"];
  readonly aggregateId?: string;
  readonly payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: input.aggregateKind ?? "thread",
    aggregateId: input.aggregateId ?? threadId,
    occurredAt: NOW,
    commandId: CommandId.make(`command-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as unknown as OrchestrationEvent;
}

const threadCreated = (sequence: number, dagLink?: unknown) =>
  makeEvent({
    sequence,
    type: "thread.created",
    payload: {
      threadId,
      projectId: ProjectId.make("project-1"),
      title: "Thread",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      ...(dagLink !== undefined ? { dagLink } : {}),
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

it.effect("thread.created carries its dagLink into the read model", () =>
  Effect.gen(function* () {
    const plannerLink = { dagId, nodeId: null, role: "planner" };
    const withLink = yield* projectEvent(createEmptyReadModel(NOW), threadCreated(1, plannerLink));
    expect(withLink.threads[0]?.dagLink).toEqual(plannerLink);

    const withoutLink = yield* projectEvent(createEmptyReadModel(NOW), threadCreated(1));
    expect(withoutLink.threads[0]?.dagLink ?? null).toBeNull();
  }),
);

it.effect("dag.node-status-set with a threadId binds an existing thread as executor", () =>
  Effect.gen(function* () {
    const created = yield* projectEvent(createEmptyReadModel(NOW), threadCreated(1));
    const dagCreated = yield* projectEvent(
      created,
      makeEvent({
        sequence: 2,
        type: "dag.created",
        aggregateKind: "dag",
        aggregateId: dagId,
        payload: {
          dagId,
          title: "Plan",
          description: "",
          primaryProjectId: null,
          defaultModelSelection: null,
          createdAt: NOW,
        },
      }),
    );
    const bound = yield* projectEvent(
      dagCreated,
      makeEvent({
        sequence: 3,
        type: "dag.node-status-set",
        aggregateKind: "dag",
        aggregateId: dagId,
        payload: { dagId, nodeId, status: "running", threadId, updatedAt: NOW },
      }),
    );
    expect(bound.threads[0]?.dagLink).toEqual({ dagId, nodeId, role: "executor" });

    // Unknown threads are ignored; status changes without a binding leave the link alone.
    const unknownThread = yield* projectEvent(
      bound,
      makeEvent({
        sequence: 4,
        type: "dag.node-status-set",
        aggregateKind: "dag",
        aggregateId: dagId,
        payload: {
          dagId,
          nodeId,
          status: "running",
          threadId: ThreadId.make("thread-other"),
          updatedAt: NOW,
        },
      }),
    );
    expect(unknownThread.threads).toHaveLength(1);
    const statusOnly = yield* projectEvent(
      unknownThread,
      makeEvent({
        sequence: 5,
        type: "dag.node-status-set",
        aggregateKind: "dag",
        aggregateId: dagId,
        payload: { dagId, nodeId, status: "done", updatedAt: NOW },
      }),
    );
    expect(statusOnly.threads[0]?.dagLink).toEqual({ dagId, nodeId, role: "executor" });
  }),
);
