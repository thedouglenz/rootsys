/**
 * DAG command decider (rootsys). Pure: command + read model → planned events.
 *
 * Called from `decideOrchestrationCommand` for every `dag.*` command so DAG
 * events ride the same serialized dispatch, event store, and receipts as
 * projects and threads. Kept in its own module to stay rebase-friendly
 * against upstream T3 Code.
 *
 * Invariant policy: structural commands (node/edge upserts) validate shape
 * and acyclicity. Status commands are permissive about transitions — the
 * engine and MCP tools are the callers and the event log is the audit —
 * but always reject unknown nodes/questions and deleted DAGs.
 *
 * A finished node's content is frozen: see `isDagNodeContentFrozen`.
 */
import {
  type DagCommand,
  type DagEdge,
  type DagGraph,
  type DagNode,
  type DagNodeStatus,
  type DagQuestion,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  DAG_NODE_SATISFIED_STATUSES,
  DAG_NODE_TERMINAL_STATUSES,
  dagEdgeWouldCreateCycle,
  EventId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";

import { OrchestrationCommandInvariantError } from "../Errors.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

type PlannedDagEvent = Omit<OrchestrationEvent, "sequence">;

export function findDagGraph(
  readModel: OrchestrationReadModel,
  dagId: DagGraph["dag"]["dagId"],
): DagGraph | undefined {
  return readModel.dags?.find((graph) => graph.dag.dagId === dagId);
}

const invariant = (command: DagCommand, detail: string) =>
  new OrchestrationCommandInvariantError({ commandType: command.type, detail });

const requireDag = (readModel: OrchestrationReadModel, command: DagCommand) =>
  Effect.gen(function* () {
    const graph = findDagGraph(readModel, command.dagId);
    if (graph === undefined) {
      return yield* invariant(command, `DAG ${command.dagId} does not exist.`);
    }
    return graph;
  });

const requireNode = (graph: DagGraph, command: DagCommand, nodeId: DagNode["nodeId"]) =>
  Effect.gen(function* () {
    const node = graph.nodes.find((candidate) => candidate.nodeId === nodeId);
    if (node === undefined) {
      return yield* invariant(command, `Node ${nodeId} does not exist in DAG ${command.dagId}.`);
    }
    return node;
  });

const requireProjectIfPresent = (
  readModel: OrchestrationReadModel,
  command: DagCommand,
  projectId: DagGraph["dag"]["primaryProjectId"] | undefined,
) =>
  Effect.gen(function* () {
    if (projectId === undefined || projectId === null) return;
    const project = readModel.projects.find((candidate) => candidate.id === projectId);
    if (project === undefined || project.deletedAt !== null) {
      return yield* invariant(command, `Project ${projectId} does not exist.`);
    }
  });

function withDagEventBase(input: {
  readonly command: DagCommand;
  readonly occurredAt: string;
}): Effect.Effect<
  Omit<OrchestrationEvent, "sequence" | "type" | "payload">,
  PlatformError.PlatformError,
  Crypto.Crypto
> {
  return Crypto.Crypto.pipe(
    Effect.flatMap((crypto) =>
      crypto.randomUUIDv4.pipe(
        Effect.map((eventId) => ({
          eventId: EventId.make(eventId),
          aggregateKind: "dag" as const,
          aggregateId: input.command.dagId,
          occurredAt: input.occurredAt,
          commandId: input.command.commandId,
          causationEventId: null,
          correlationId: input.command.commandId,
          metadata: {},
        })),
      ),
    ),
  );
}

const edgeExists = (edges: ReadonlyArray<DagEdge>, from: string, to: string) =>
  edges.some((edge) => edge.fromNodeId === from && edge.toNodeId === to);

/**
 * A node that finished has a record worth keeping: its description is the
 * brief its executor worked from and its outcome is what actually happened.
 * Rewriting either silently rewrites history, so content edits and deletion
 * are rejected on these statuses. `failed` is deliberately absent — fixing a
 * description and retrying is the point. Lifecycle stays open in every
 * direction (`dag.node.status.set`), which is also the unlock path.
 */
export const isDagNodeContentFrozen = (status: DagNodeStatus): boolean =>
  DAG_NODE_SATISFIED_STATUSES.has(status);

/**
 * True when an upsert would change stored node content. An upsert carrying
 * none of these is a no-op and stays legal against a frozen node.
 */
const carriesContentChange = (command: Extract<DagCommand, { type: "dag.node.upsert" }>) =>
  command.title !== undefined ||
  command.description !== undefined ||
  command.acceptance !== undefined ||
  command.projectId !== undefined ||
  command.parallelSafe !== undefined ||
  command.executionMode !== undefined ||
  command.modelSelection !== undefined ||
  command.dependsOn !== undefined;

const frozenDetail = (node: DagNode, verb: "editing" | "deleting") =>
  `Node ${node.nodeId} is ${node.status} and its content is locked. Reopen it (set status pending) before ${verb}.`;

export const decideDagCommand = Effect.fn("decideDagCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: DagCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  PlannedDagEvent | ReadonlyArray<PlannedDagEvent>,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  switch (command.type) {
    case "dag.create": {
      if (findDagGraph(readModel, command.dagId) !== undefined) {
        return yield* invariant(command, `DAG ${command.dagId} already exists.`);
      }
      yield* requireProjectIfPresent(readModel, command, command.primaryProjectId);
      return {
        ...(yield* withDagEventBase({ command, occurredAt: command.createdAt })),
        type: "dag.created",
        payload: {
          dagId: command.dagId,
          title: command.title,
          description: command.description ?? "",
          primaryProjectId: command.primaryProjectId ?? null,
          defaultModelSelection: command.defaultModelSelection ?? null,
          createdAt: command.createdAt,
        },
      };
    }

    case "dag.meta.update": {
      yield* requireDag(readModel, command);
      yield* requireProjectIfPresent(readModel, command, command.primaryProjectId);
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withDagEventBase({ command, occurredAt })),
        type: "dag.meta-updated",
        payload: {
          dagId: command.dagId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.description !== undefined ? { description: command.description } : {}),
          ...(command.primaryProjectId !== undefined
            ? { primaryProjectId: command.primaryProjectId }
            : {}),
          ...(command.defaultModelSelection !== undefined
            ? { defaultModelSelection: command.defaultModelSelection }
            : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "dag.status.set": {
      const graph = yield* requireDag(readModel, command);
      const occurredAt = yield* nowIso;
      // Re-setting the same status is a duplicate; re-emit with the original
      // timestamp so the projection is a no-op.
      const unchanged = graph.dag.status === command.status;
      return {
        ...(yield* withDagEventBase({ command, occurredAt })),
        type: "dag.status-set",
        payload: {
          dagId: command.dagId,
          status: command.status,
          // Only a pause carries a reason. Any other transition records
          // `null` so a plan that runs again cannot show a stale pause note.
          reason: command.status === "paused" ? (command.reason ?? null) : null,
          updatedAt: unchanged ? graph.dag.updatedAt : occurredAt,
        },
      };
    }

    case "dag.delete": {
      yield* requireDag(readModel, command);
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withDagEventBase({ command, occurredAt })),
        type: "dag.deleted",
        payload: { dagId: command.dagId, deletedAt: occurredAt },
      };
    }

    case "dag.node.upsert": {
      const graph = yield* requireDag(readModel, command);
      const existing = graph.nodes.find((candidate) => candidate.nodeId === command.nodeId);
      if (
        existing !== undefined &&
        isDagNodeContentFrozen(existing.status) &&
        carriesContentChange(command)
      ) {
        return yield* invariant(command, frozenDetail(existing, "editing"));
      }
      yield* requireProjectIfPresent(readModel, command, command.projectId);
      const occurredAt = yield* nowIso;
      if (existing === undefined && command.title === undefined) {
        return yield* invariant(command, `Creating node ${command.nodeId} requires a title.`);
      }
      const dependsOn = command.dependsOn ?? [];
      const addedEdges: Array<DagEdge> = [];
      // Validate dependencies incrementally against the edges added so far so
      // a single command cannot smuggle in a cycle via two new edges.
      const workingEdges: Array<DagEdge> = [...graph.edges];
      for (const fromNodeId of dependsOn) {
        if (fromNodeId === command.nodeId) {
          return yield* invariant(command, `Node ${command.nodeId} cannot depend on itself.`);
        }
        if (!graph.nodes.some((candidate) => candidate.nodeId === fromNodeId)) {
          return yield* invariant(
            command,
            `Dependency ${fromNodeId} does not exist in DAG ${command.dagId}.`,
          );
        }
        if (edgeExists(workingEdges, fromNodeId, command.nodeId)) continue;
        if (dagEdgeWouldCreateCycle(workingEdges, fromNodeId, command.nodeId)) {
          return yield* invariant(
            command,
            `Edge ${fromNodeId} -> ${command.nodeId} would create a cycle.`,
          );
        }
        const edge: DagEdge = { dagId: command.dagId, fromNodeId, toNodeId: command.nodeId };
        addedEdges.push(edge);
        workingEdges.push(edge);
      }
      const node: DagNode =
        existing === undefined
          ? {
              nodeId: command.nodeId,
              dagId: command.dagId,
              projectId: command.projectId ?? null,
              title: command.title!,
              description: command.description ?? "",
              acceptance: command.acceptance ?? null,
              parallelSafe: command.parallelSafe ?? false,
              executionMode: command.executionMode ?? "auto",
              modelSelection: command.modelSelection ?? null,
              status: "pending",
              threadId: null,
              outcome: null,
              createdAt: occurredAt,
              updatedAt: occurredAt,
            }
          : {
              ...existing,
              ...(command.projectId !== undefined ? { projectId: command.projectId } : {}),
              ...(command.title !== undefined ? { title: command.title } : {}),
              ...(command.description !== undefined ? { description: command.description } : {}),
              ...(command.acceptance !== undefined ? { acceptance: command.acceptance } : {}),
              ...(command.parallelSafe !== undefined ? { parallelSafe: command.parallelSafe } : {}),
              ...(command.executionMode !== undefined
                ? { executionMode: command.executionMode }
                : {}),
              ...(command.modelSelection !== undefined
                ? { modelSelection: command.modelSelection }
                : {}),
              // An upsert carrying no content leaves the node exactly as it
              // was, so it must not move its timestamp either — same posture
              // as a duplicate dag.status.set. Keeps a re-sent command
              // (double-click, raced client) a true no-op.
              updatedAt:
                carriesContentChange(command) || addedEdges.length > 0
                  ? occurredAt
                  : existing.updatedAt,
            };
      const updatedAt = existing === undefined ? occurredAt : node.updatedAt;
      return {
        ...(yield* withDagEventBase({ command, occurredAt })),
        type: "dag.node-upserted",
        payload: { dagId: command.dagId, node, addedEdges, updatedAt },
      };
    }

    case "dag.node.delete": {
      const graph = yield* requireDag(readModel, command);
      const node = yield* requireNode(graph, command, command.nodeId);
      if (isDagNodeContentFrozen(node.status)) {
        return yield* invariant(command, frozenDetail(node, "deleting"));
      }
      const occurredAt = yield* nowIso;
      // Incident edges and open questions are removed by the projector.
      return {
        ...(yield* withDagEventBase({ command, occurredAt })),
        type: "dag.node-deleted",
        payload: { dagId: command.dagId, nodeId: command.nodeId, updatedAt: occurredAt },
      };
    }

    case "dag.edge.add": {
      const graph = yield* requireDag(readModel, command);
      yield* requireNode(graph, command, command.fromNodeId);
      yield* requireNode(graph, command, command.toNodeId);
      if (dagEdgeWouldCreateCycle(graph.edges, command.fromNodeId, command.toNodeId)) {
        return yield* invariant(
          command,
          `Edge ${command.fromNodeId} -> ${command.toNodeId} would create a cycle.`,
        );
      }
      const occurredAt = yield* nowIso;
      const duplicate = edgeExists(graph.edges, command.fromNodeId, command.toNodeId);
      return {
        ...(yield* withDagEventBase({ command, occurredAt })),
        type: "dag.edge-added",
        payload: {
          dagId: command.dagId,
          fromNodeId: command.fromNodeId,
          toNodeId: command.toNodeId,
          updatedAt: duplicate ? graph.dag.updatedAt : occurredAt,
        },
      };
    }

    case "dag.edge.remove": {
      const graph = yield* requireDag(readModel, command);
      if (!edgeExists(graph.edges, command.fromNodeId, command.toNodeId)) {
        return yield* invariant(
          command,
          `Edge ${command.fromNodeId} -> ${command.toNodeId} does not exist.`,
        );
      }
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withDagEventBase({ command, occurredAt })),
        type: "dag.edge-removed",
        payload: {
          dagId: command.dagId,
          fromNodeId: command.fromNodeId,
          toNodeId: command.toNodeId,
          updatedAt: occurredAt,
        },
      };
    }

    case "dag.node.status.set": {
      const graph = yield* requireDag(readModel, command);
      const node = yield* requireNode(graph, command, command.nodeId);
      const occurredAt = yield* nowIso;
      const threadId = command.threadId !== undefined ? command.threadId : node.threadId;
      const terminal = DAG_NODE_TERMINAL_STATUSES.has(command.status);
      return {
        ...(yield* withDagEventBase({ command, occurredAt })),
        type: "dag.node-status-set",
        payload: {
          dagId: command.dagId,
          nodeId: command.nodeId,
          status: command.status,
          ...(command.threadId !== undefined ? { threadId: command.threadId } : {}),
          outcome: terminal
            ? { summary: command.summary ?? null, threadId, completedAt: occurredAt }
            : null,
          updatedAt: occurredAt,
        },
      };
    }

    case "dag.question.ask": {
      const graph = yield* requireDag(readModel, command);
      const node = yield* requireNode(graph, command, command.nodeId);
      if (graph.questions.some((question) => question.questionId === command.questionId)) {
        return yield* invariant(command, `Question ${command.questionId} already exists.`);
      }
      const occurredAt = yield* nowIso;
      const question: DagQuestion = {
        questionId: command.questionId,
        dagId: command.dagId,
        nodeId: command.nodeId,
        threadId: command.threadId ?? node.threadId,
        prompt: command.prompt,
        options: command.options ?? [],
        status: "open",
        answer: null,
        createdAt: occurredAt,
        answeredAt: null,
      };
      const askedEvent: PlannedDagEvent = {
        ...(yield* withDagEventBase({ command, occurredAt })),
        type: "dag.question-asked",
        payload: { dagId: command.dagId, question, updatedAt: occurredAt },
      };
      // A question blocks its node unless the node has already finished.
      if (DAG_NODE_TERMINAL_STATUSES.has(node.status) || node.status === "blocked") {
        return askedEvent;
      }
      const blockedEvent: PlannedDagEvent = {
        ...(yield* withDagEventBase({ command, occurredAt })),
        type: "dag.node-status-set",
        payload: {
          dagId: command.dagId,
          nodeId: command.nodeId,
          status: "blocked",
          outcome: null,
          updatedAt: occurredAt,
        },
      };
      return [askedEvent, blockedEvent];
    }

    case "dag.question.answer": {
      const graph = yield* requireDag(readModel, command);
      const question = graph.questions.find(
        (candidate) => candidate.questionId === command.questionId,
      );
      if (question === undefined) {
        return yield* invariant(command, `Question ${command.questionId} does not exist.`);
      }
      if (question.status !== "open") {
        return yield* invariant(command, `Question ${command.questionId} is already resolved.`);
      }
      const occurredAt = yield* nowIso;
      const status = command.answer === null ? "dismissed" : "answered";
      const answeredEvent: PlannedDagEvent = {
        ...(yield* withDagEventBase({ command, occurredAt })),
        type: "dag.question-answered",
        payload: {
          dagId: command.dagId,
          questionId: command.questionId,
          nodeId: question.nodeId,
          status,
          answer: command.answer,
          answeredAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
      // Unblock the node once no other question on it remains open. The
      // node returns to `running` — the executing thread is still bound and
      // the engine resumes it with the answer.
      const node = graph.nodes.find((candidate) => candidate.nodeId === question.nodeId);
      const otherOpen = graph.questions.some(
        (candidate) =>
          candidate.nodeId === question.nodeId &&
          candidate.questionId !== question.questionId &&
          candidate.status === "open",
      );
      if (node === undefined || node.status !== "blocked" || otherOpen) {
        return answeredEvent;
      }
      const resumedStatus: DagNodeStatus = "running";
      const unblockedEvent: PlannedDagEvent = {
        ...(yield* withDagEventBase({ command, occurredAt })),
        type: "dag.node-status-set",
        payload: {
          dagId: command.dagId,
          nodeId: node.nodeId,
          status: resumedStatus,
          outcome: null,
          updatedAt: occurredAt,
        },
      };
      return [answeredEvent, unblockedEvent];
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown DAG command type: ${fallback.type}`,
      });
    }
  }
});
