import {
  CommandId,
  DagId,
  DagNodeId,
  DagQuestionId,
  type DagCommand,
  type DagGraph,
  type DagNode,
  readyDagNodes,
  topologicalDagOrder,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { DagToolError, DagToolkit, type DagContext, type DagValidationIssue } from "./tools.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const internal = (message: string) => (cause: unknown) =>
  new DagToolError({
    reason: "internal",
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

/** Slug ids read well in the canvas and in agent transcripts; the suffix keeps them unique. */
export function mintNodeId(title: string, suffix: string): DagNodeId {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "node";
  return DagNodeId.make(`${slug}-${suffix}`);
}

/**
 * Structural checks a planner should run before promoting a DAG to `ready`.
 * Pure so it can be unit-tested and reused by the web canvas later.
 */
export function validateDagGraph(graph: DagGraph): {
  readonly ok: boolean;
  readonly issues: ReadonlyArray<DagValidationIssue>;
  readonly topologicalOrder: ReadonlyArray<DagNodeId>;
} {
  const issues: Array<DagValidationIssue> = [];
  if (graph.nodes.length === 0) {
    issues.push({ severity: "error", nodeId: null, message: "DAG has no nodes." });
  }
  const order = topologicalDagOrder(graph);
  if (order === null) {
    issues.push({ severity: "error", nodeId: null, message: "DAG contains a cycle." });
  }
  for (const node of graph.nodes) {
    if (node.description.trim() === "") {
      issues.push({
        severity: "warning",
        nodeId: node.nodeId,
        message: "Node has no description.",
      });
    }
    if (node.acceptance === null || node.acceptance.trim() === "") {
      issues.push({
        severity: "warning",
        nodeId: node.nodeId,
        message: "Node has no acceptance criteria; the executor cannot self-verify.",
      });
    }
  }
  // Disconnected clusters are legal but usually mean the planner forgot an
  // edge; flag as a warning when more than one component exists.
  if (graph.nodes.length > 1) {
    const parent = new Map<string, string>(graph.nodes.map((n) => [n.nodeId, n.nodeId]));
    const find = (x: string): string => {
      let root = x;
      while (parent.get(root) !== root) root = parent.get(root)!;
      return root;
    };
    for (const edge of graph.edges) {
      if (parent.has(edge.fromNodeId) && parent.has(edge.toNodeId)) {
        parent.set(find(edge.fromNodeId), find(edge.toNodeId));
      }
    }
    const roots = new Set(graph.nodes.map((n) => find(n.nodeId)));
    if (roots.size > 1) {
      issues.push({
        severity: "warning",
        nodeId: null,
        message: `DAG has ${roots.size} disconnected clusters; confirm no dependencies are missing.`,
      });
    }
  }
  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
    topologicalOrder: order ?? [],
  };
}

const makeHandlers = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;

  const requireDagCapability = Effect.gen(function* () {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    if (!invocation.capabilities.has("dag")) {
      return yield* new DagToolError({
        reason: "capability-unavailable",
        message: "DAG tools are not enabled for this session.",
      });
    }
    return invocation;
  });

  const boundNode = Effect.gen(function* () {
    const invocation = yield* requireDagCapability;
    return yield* snapshotQuery
      .findDagNodeByThreadId(invocation.threadId)
      .pipe(Effect.mapError(internal("Failed to resolve bound DAG node")));
  });

  const resolveDagId = (dagId: DagId | undefined) =>
    Effect.gen(function* () {
      if (dagId !== undefined) return dagId;
      const bound = yield* boundNode;
      if (Option.isNone(bound)) {
        return yield* new DagToolError({
          reason: "no-bound-node",
          message: "This thread is not executing a DAG node; pass dagId explicitly.",
        });
      }
      return bound.value.dagId;
    });

  const resolveNodeId = (dagId: DagId, nodeId: DagNodeId | undefined) =>
    Effect.gen(function* () {
      if (nodeId !== undefined) return nodeId;
      const bound = yield* boundNode;
      if (Option.isNone(bound) || bound.value.dagId !== dagId) {
        return yield* new DagToolError({
          reason: "no-bound-node",
          message: "This thread is not executing a node of that DAG; pass nodeId explicitly.",
        });
      }
      return bound.value.node.nodeId;
    });

  const readGraph = (dagId: DagId) =>
    Effect.gen(function* () {
      const graph = yield* snapshotQuery
        .getDagGraph(dagId)
        .pipe(Effect.mapError(internal("Failed to read DAG")));
      if (Option.isNone(graph)) {
        return yield* new DagToolError({
          reason: "dag-not-found",
          message: `DAG ${dagId} not found.`,
        });
      }
      return graph.value;
    });

  const requireNode = (
    graph: DagGraph,
    nodeId: DagNodeId,
  ): Effect.Effect<DagNode, DagToolError> => {
    const node = graph.nodes.find((candidate) => candidate.nodeId === nodeId);
    return node === undefined
      ? Effect.fail(
          new DagToolError({ reason: "node-not-found", message: `Node ${nodeId} not found.` }),
        )
      : Effect.succeed(node);
  };

  const commandId = crypto.randomUUIDv4.pipe(
    Effect.map((uuid) => CommandId.make(`mcp:dag:${uuid}`)),
    Effect.orDie,
  );

  const dispatch = (command: DagCommand) =>
    engine.dispatch(command).pipe(
      Effect.mapError(
        (error) =>
          new DagToolError({
            reason: "rejected",
            message:
              "detail" in error && typeof error.detail === "string"
                ? error.detail
                : `Command ${command.type} was rejected: ${String(error)}`,
          }),
      ),
    );

  const contextFor = (graph: DagGraph, threadId: string): DagContext => ({
    graph,
    boundNodeId:
      graph.nodes.find((node) => node.threadId === threadId && node.status !== "done")?.nodeId ??
      null,
    readyNodeIds: readyDagNodes(graph).map((node) => node.nodeId),
    topologicalOrder: topologicalDagOrder(graph) ?? [],
  });

  return {
    dag_list: (input) =>
      Effect.gen(function* () {
        yield* requireDagCapability;
        const dags = yield* snapshotQuery
          .listDagShells({
            ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
            ...(input.includeArchived !== undefined
              ? { includeArchived: input.includeArchived }
              : {}),
          })
          .pipe(Effect.mapError(internal("Failed to list DAGs")));
        return { dags };
      }),

    dag_get: (input) =>
      Effect.gen(function* () {
        const invocation = yield* requireDagCapability;
        const dagId = yield* resolveDagId(input.dagId);
        return contextFor(yield* readGraph(dagId), invocation.threadId);
      }),

    dag_create: (input) =>
      Effect.gen(function* () {
        const invocation = yield* requireDagCapability;
        let primaryProjectId = input.primaryProjectId ?? null;
        if (primaryProjectId === null) {
          const shell = yield* snapshotQuery
            .getThreadShellById(invocation.threadId)
            .pipe(Effect.mapError(internal("Failed to read thread")));
          primaryProjectId = Option.isSome(shell) ? shell.value.projectId : null;
        }
        const dagId = DagId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
        yield* dispatch({
          type: "dag.create",
          commandId: yield* commandId,
          dagId,
          title: input.title,
          ...(input.description !== undefined ? { description: input.description } : {}),
          primaryProjectId,
          createdAt: yield* nowIso,
        });
        return { dag: (yield* readGraph(dagId)).dag };
      }),

    dag_update: (input) =>
      Effect.gen(function* () {
        yield* requireDagCapability;
        const dagId = yield* resolveDagId(input.dagId);
        yield* readGraph(dagId);
        const { status, dagId: _ignored, ...meta } = input;
        if (Object.values(meta).some((value) => value !== undefined)) {
          yield* dispatch({
            type: "dag.meta.update",
            commandId: yield* commandId,
            dagId,
            ...(meta.title !== undefined ? { title: meta.title } : {}),
            ...(meta.description !== undefined ? { description: meta.description } : {}),
            ...(meta.primaryProjectId !== undefined
              ? { primaryProjectId: meta.primaryProjectId }
              : {}),
          });
        }
        if (status !== undefined) {
          yield* dispatch({ type: "dag.status.set", commandId: yield* commandId, dagId, status });
        }
        return { dag: (yield* readGraph(dagId)).dag };
      }),

    dag_upsert_node: (input) =>
      Effect.gen(function* () {
        yield* requireDagCapability;
        const dagId = yield* resolveDagId(input.dagId);
        const graph = yield* readGraph(dagId);
        let nodeId = input.nodeId;
        if (nodeId === undefined) {
          if (input.title === undefined) {
            return yield* new DagToolError({
              reason: "invalid-input",
              message: "title is required when creating a node.",
            });
          }
          const suffix = (yield* crypto.randomUUIDv4.pipe(Effect.orDie)).slice(0, 6);
          nodeId = mintNodeId(input.title, suffix);
        } else if (
          input.title === undefined &&
          !graph.nodes.some((node) => node.nodeId === nodeId)
        ) {
          return yield* new DagToolError({
            reason: "invalid-input",
            message: `Node ${nodeId} does not exist; provide a title to create it.`,
          });
        }
        const before = graph.edges.length;
        yield* dispatch({
          type: "dag.node.upsert",
          commandId: yield* commandId,
          dagId,
          nodeId,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.acceptance !== undefined ? { acceptance: input.acceptance } : {}),
          ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
          ...(input.parallelSafe !== undefined ? { parallelSafe: input.parallelSafe } : {}),
          ...(input.executionMode !== undefined ? { executionMode: input.executionMode } : {}),
          ...(input.dependsOn !== undefined ? { dependsOn: input.dependsOn } : {}),
        });
        const after = yield* readGraph(dagId);
        const node = yield* requireNode(after, nodeId);
        return { node, addedEdges: after.edges.slice(before) };
      }),

    dag_delete_node: (input) =>
      Effect.gen(function* () {
        yield* requireDagCapability;
        const dagId = yield* resolveDagId(input.dagId);
        yield* requireNode(yield* readGraph(dagId), input.nodeId);
        yield* dispatch({
          type: "dag.node.delete",
          commandId: yield* commandId,
          dagId,
          nodeId: input.nodeId,
        });
        return { deleted: true as const };
      }),

    dag_add_edge: (input) =>
      Effect.gen(function* () {
        yield* requireDagCapability;
        const dagId = yield* resolveDagId(input.dagId);
        yield* dispatch({
          type: "dag.edge.add",
          commandId: yield* commandId,
          dagId,
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
        });
        return { edge: { dagId, fromNodeId: input.fromNodeId, toNodeId: input.toNodeId } };
      }),

    dag_remove_edge: (input) =>
      Effect.gen(function* () {
        yield* requireDagCapability;
        const dagId = yield* resolveDagId(input.dagId);
        yield* dispatch({
          type: "dag.edge.remove",
          commandId: yield* commandId,
          dagId,
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
        });
        return { removed: true as const };
      }),

    dag_validate: (input) =>
      Effect.gen(function* () {
        yield* requireDagCapability;
        const dagId = yield* resolveDagId(input.dagId);
        return validateDagGraph(yield* readGraph(dagId));
      }),

    dag_set_node_status: (input) =>
      Effect.gen(function* () {
        const invocation = yield* requireDagCapability;
        const dagId = yield* resolveDagId(input.dagId);
        const nodeId = yield* resolveNodeId(dagId, input.nodeId);
        const node = yield* requireNode(yield* readGraph(dagId), nodeId);
        yield* dispatch({
          type: "dag.node.status.set",
          commandId: yield* commandId,
          dagId,
          nodeId,
          status: input.status,
          // A thread that starts work on an unbound node becomes its executor.
          // Terminal/skip transitions from a planner do not bind.
          ...(node.threadId === null && input.status === "running"
            ? { threadId: invocation.threadId }
            : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
        });
        return { node: yield* requireNode(yield* readGraph(dagId), nodeId) };
      }),

    dag_ask_user: (input) =>
      Effect.gen(function* () {
        const invocation = yield* requireDagCapability;
        const dagId = yield* resolveDagId(input.dagId);
        const nodeId = yield* resolveNodeId(dagId, input.nodeId);
        const questionId = DagQuestionId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
        yield* dispatch({
          type: "dag.question.ask",
          commandId: yield* commandId,
          dagId,
          nodeId,
          questionId,
          threadId: invocation.threadId,
          prompt: input.question,
          ...(input.options !== undefined ? { options: input.options } : {}),
        });
        const graph = yield* readGraph(dagId);
        const question = graph.questions.find((candidate) => candidate.questionId === questionId);
        if (question === undefined) {
          return yield* new DagToolError({
            reason: "internal",
            message: "Question was not recorded.",
          });
        }
        return { question };
      }),

    dag_answer_question: (input) =>
      Effect.gen(function* () {
        yield* requireDagCapability;
        const dagId = yield* resolveDagId(input.dagId);
        yield* dispatch({
          type: "dag.question.answer",
          commandId: yield* commandId,
          dagId,
          questionId: input.questionId,
          answer: input.answer,
        });
        const graph = yield* readGraph(dagId);
        const question = graph.questions.find(
          (candidate) => candidate.questionId === input.questionId,
        );
        if (question === undefined) {
          return yield* new DagToolError({
            reason: "internal",
            message: "Question was not found after answering.",
          });
        }
        return { question };
      }),
  } satisfies Parameters<typeof DagToolkit.toLayer>[0];
});

export const DagToolkitHandlersLive = DagToolkit.toLayer(makeHandlers);
