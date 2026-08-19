import {
  CommandId,
  type DagGraph,
  type DagId,
  type DagNode,
  DAG_NODE_SATISFIED_STATUSES,
  MessageId,
  type ModelSelection,
  type OrchestrationEvent,
  readyDagNodes,
  ThreadId,
  topologicalDagOrder,
} from "@t3tools/contracts";
import { buildDagNudgeMessage, buildDagQuestionAnswerMessage } from "@t3tools/shared/dagPrompts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderInstanceRegistry } from "../../provider/Services/ProviderInstanceRegistry.ts";
import { forkParked } from "../../serverActivation.ts";
import {
  DagExecutionEngine,
  type DagExecutionEngineShape,
} from "../Services/DagExecutionEngine.ts";
import {
  DEFAULT_DAG_EXECUTION_STRATEGIES,
  resolveDagExecutionStrategy,
  type DagExecutionStrategy,
} from "../strategy.ts";

/** Session statuses that mean "the thread's turn is over". Mirrors the projector's settled rule. */
const SETTLED_SESSION_STATUSES: ReadonlySet<string> = new Set([
  "idle",
  "ready",
  "error",
  "interrupted",
  "stopped",
]);

type EngineInput =
  | { readonly kind: "schedule"; readonly dagId: DagId }
  | { readonly kind: "event"; readonly event: OrchestrationEvent };

export interface DagExecutionEngineOptions {
  readonly strategies?: ReadonlyArray<DagExecutionStrategy>;
}

export const makeDagExecutionEngine = (options?: DagExecutionEngineOptions) =>
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const snapshotQuery = yield* ProjectionSnapshotQuery;
    const instanceRegistry = yield* ProviderInstanceRegistry;
    const crypto = yield* Crypto.Crypto;
    const strategies = options?.strategies ?? DEFAULT_DAG_EXECUTION_STRATEGIES;

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const uuid = crypto.randomUUIDv4.pipe(Effect.orDie);
    const serverCommandId = (tag: string) =>
      uuid.pipe(Effect.map((id) => CommandId.make(`server:dag-${tag}:${id}`)));

    // Executor threads observed in a running turn; a settle only counts once
    // we saw the turn run, so session start-up statuses are not mistaken for
    // an early end.
    const runningThreads = new Set<ThreadId>();
    // Threads already nudged once for ending a turn without a report.
    const nudgedThreads = new Set<ThreadId>();

    const dispatch = (command: Parameters<typeof orchestrationEngine.dispatch>[0]) =>
      orchestrationEngine.dispatch(command).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("dag engine command rejected", {
                commandType: command.type,
                cause: Cause.pretty(cause),
              }),
        ),
      );

    const setDagStatus = (dagId: DagId, status: DagGraph["dag"]["status"]) =>
      Effect.gen(function* () {
        yield* dispatch({
          type: "dag.status.set",
          commandId: yield* serverCommandId("status"),
          dagId,
          status,
        });
      });

    const setNodeStatus = (input: {
      readonly dagId: DagId;
      readonly nodeId: DagNode["nodeId"];
      readonly status: DagNode["status"];
      readonly threadId?: ThreadId | null;
      readonly summary?: string | null;
    }) =>
      Effect.gen(function* () {
        yield* dispatch({
          type: "dag.node.status.set",
          commandId: yield* serverCommandId("node-status"),
          dagId: input.dagId,
          nodeId: input.nodeId,
          status: input.status,
          ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
        });
      });

    const sendTurn = (input: {
      readonly threadId: ThreadId;
      readonly text: string;
      readonly modelSelection: ModelSelection;
      readonly interactionMode: "default" | "plan";
    }) =>
      Effect.gen(function* () {
        yield* dispatch({
          type: "thread.turn.start",
          commandId: yield* serverCommandId("turn"),
          threadId: input.threadId,
          message: {
            messageId: MessageId.make(yield* uuid),
            role: "user",
            text: input.text,
            attachments: [],
          },
          modelSelection: input.modelSelection,
          runtimeMode: "full-access",
          interactionMode: input.interactionMode,
          createdAt: yield* nowIso,
        });
      });

    /**
     * A finished node's executor thread is done work: settle it so it leaves
     * the user's active list without a click. No-op on already-settled
     * threads (decider re-emits silently); skipped while the session is still
     * starting/running since the decider would reject it.
     */
    const settleExecutorThread = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const shell = yield* snapshotQuery
          .getThreadShellById(threadId)
          .pipe(Effect.orElseSucceed(() => Option.none()));
        if (Option.isNone(shell)) return;
        const status = shell.value.session?.status;
        if (status === "starting" || status === "running") return;
        if (shell.value.settledAt !== null) return;
        yield* dispatch({
          type: "thread.settle",
          commandId: yield* serverCommandId("settle"),
          threadId,
        });
      });

    const readGraph = (dagId: DagId) =>
      snapshotQuery
        .getDagGraph(dagId)
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("dag engine could not read DAG", { dagId, error }).pipe(
              Effect.as(Option.none<DagGraph>()),
            ),
          ),
        );

    const resolveModelSelection = (graph: DagGraph, node: DagNode) =>
      Effect.gen(function* () {
        if (node.modelSelection) return node.modelSelection;
        if (graph.dag.defaultModelSelection) return graph.dag.defaultModelSelection;
        const projectId = node.projectId ?? graph.dag.primaryProjectId;
        if (projectId === null) return null;
        const project = yield* snapshotQuery
          .getProjectShellById(projectId)
          .pipe(Effect.orElseSucceed(() => Option.none()));
        return Option.isSome(project) ? project.value.defaultModelSelection : null;
      });

    /**
     * Launch one node: create its thread, bind it, send the first turn.
     * Returns false when the node cannot be launched (no project/model); the
     * DAG is paused so the user can fix the configuration.
     */
    const launchNode = (graph: DagGraph, node: DagNode) =>
      Effect.gen(function* () {
        const dagId = graph.dag.dagId;
        const projectId = node.projectId ?? graph.dag.primaryProjectId;
        if (projectId === null) {
          yield* Effect.logWarning("dag engine: node has no project; pausing DAG", {
            dagId,
            nodeId: node.nodeId,
          });
          yield* setDagStatus(dagId, "paused");
          return false;
        }
        const modelSelection = yield* resolveModelSelection(graph, node);
        if (modelSelection === null) {
          yield* Effect.logWarning("dag engine: no model selection resolvable; pausing DAG", {
            dagId,
            nodeId: node.nodeId,
          });
          yield* setDagStatus(dagId, "paused");
          return false;
        }
        const instance = yield* instanceRegistry.getInstance(modelSelection.instanceId);
        if (instance === undefined) {
          yield* Effect.logWarning("dag engine: provider instance unavailable; pausing DAG", {
            dagId,
            nodeId: node.nodeId,
            instanceId: modelSelection.instanceId,
          });
          yield* setDagStatus(dagId, "paused");
          return false;
        }
        const strategy = resolveDagExecutionStrategy(strategies, {
          graph,
          node,
          driverKind: instance.driverKind,
        });
        const launch = strategy.buildLaunch({ graph, node, driverKind: instance.driverKind });
        const threadId = ThreadId.make(yield* uuid);
        const createdAt = yield* nowIso;
        yield* dispatch({
          type: "thread.create",
          commandId: yield* serverCommandId("thread-create"),
          threadId,
          projectId,
          title: `${graph.dag.title}: ${node.title}`,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: launch.interactionMode,
          branch: null,
          worktreePath: null,
          dagLink: { dagId, nodeId: node.nodeId, role: "executor" },
          createdAt,
        });
        // Bind before the turn so the executor's first dag_get already sees
        // itself on the node.
        yield* setNodeStatus({ dagId, nodeId: node.nodeId, status: "running", threadId });
        yield* sendTurn({
          threadId,
          text: launch.prompt,
          modelSelection,
          interactionMode: launch.interactionMode,
        });
        yield* Effect.logInfo("dag engine launched node", {
          dagId,
          nodeId: node.nodeId,
          threadId,
          strategy: strategy.id,
        });
        return true;
      });

    /**
     * Evaluate one DAG's frontier. Serial by default: nothing new launches
     * while any node is running or blocked. (Parallel `parallelSafe` nodes in
     * worktrees land with thread bootstrap extraction — see docs/internals/dag.md.)
     */
    const schedule = (dagId: DagId): Effect.Effect<void> =>
      Effect.gen(function* () {
        const graphOption = yield* readGraph(dagId);
        if (Option.isNone(graphOption)) return;
        const graph = graphOption.value;
        if (graph.dag.status !== "running") return;
        if (graph.nodes.some((node) => node.status === "running" || node.status === "blocked")) {
          return;
        }
        const ready = readyDagNodes(graph);
        if (ready.length === 0) {
          if (graph.nodes.every((node) => DAG_NODE_SATISFIED_STATUSES.has(node.status))) {
            yield* setDagStatus(dagId, "completed");
          } else if (graph.nodes.some((node) => node.status === "failed")) {
            yield* setDagStatus(dagId, "failed");
          } else {
            yield* Effect.logWarning("dag engine: no ready nodes but DAG is not finished", {
              dagId,
            });
            yield* setDagStatus(dagId, "paused");
          }
          return;
        }
        const order = topologicalDagOrder(graph) ?? ready.map((node) => node.nodeId);
        const readyIds = new Set(ready.map((node) => node.nodeId));
        const nextId = order.find((id) => readyIds.has(id)) ?? ready[0]!.nodeId;
        const next = graph.nodes.find((node) => node.nodeId === nextId)!;
        yield* launchNode(graph, next);
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("dag engine schedule failed", {
                dagId,
                cause: Cause.pretty(cause),
              }),
        ),
        Effect.orDie,
      );

    const handleQuestionAnswered = (
      event: Extract<OrchestrationEvent, { type: "dag.question-answered" }>,
    ) =>
      Effect.gen(function* () {
        const graphOption = yield* readGraph(event.payload.dagId);
        if (Option.isNone(graphOption)) return;
        const graph = graphOption.value;
        const question = graph.questions.find(
          (candidate) => candidate.questionId === event.payload.questionId,
        );
        const node = graph.nodes.find((candidate) => candidate.nodeId === event.payload.nodeId);
        if (question === undefined || node === undefined) return;
        const threadId = question.threadId ?? node.threadId;
        // Only resume a node that is now running again (the decider unblocks
        // it once its last open question is answered).
        if (threadId === null || node.status !== "running") return;
        const modelSelection = yield* resolveModelSelection(graph, node);
        if (modelSelection === null) return;
        nudgedThreads.delete(threadId);
        yield* sendTurn({
          threadId,
          text: buildDagQuestionAnswerMessage({
            prompt: question.prompt,
            answer: event.payload.answer,
          }),
          modelSelection,
          interactionMode: "default",
        });
      });

    const handleSessionSet = (event: Extract<OrchestrationEvent, { type: "thread.session-set" }>) =>
      Effect.gen(function* () {
        const { threadId, session } = event.payload;
        if (session.status === "running") {
          runningThreads.add(threadId);
          return;
        }
        if (!SETTLED_SESSION_STATUSES.has(session.status) || !runningThreads.has(threadId)) {
          return;
        }
        runningThreads.delete(threadId);
        const bound = yield* snapshotQuery
          .findDagNodeByThreadId(threadId)
          .pipe(Effect.orElseSucceed(() => Option.none()));
        if (Option.isNone(bound)) return;
        const { dagId, node } = bound.value;
        // Normal ordering: the executor reported done mid-turn, then the turn
        // ended. Nothing left for this thread to do.
        if (DAG_NODE_SATISFIED_STATUSES.has(node.status)) {
          yield* settleExecutorThread(threadId);
          return;
        }
        if (node.status !== "running") return;
        if (session.status === "error") {
          yield* setNodeStatus({
            dagId,
            nodeId: node.nodeId,
            status: "failed",
            summary: "Executor session ended with an error.",
          });
          return;
        }
        if (!nudgedThreads.has(threadId)) {
          nudgedThreads.add(threadId);
          const graphOption = yield* readGraph(dagId);
          if (Option.isNone(graphOption)) return;
          const modelSelection = yield* resolveModelSelection(graphOption.value, node);
          if (modelSelection === null) return;
          yield* sendTurn({
            threadId,
            text: buildDagNudgeMessage(),
            modelSelection,
            interactionMode: "default",
          });
          return;
        }
        nudgedThreads.delete(threadId);
        yield* setNodeStatus({
          dagId,
          nodeId: node.nodeId,
          status: "failed",
          summary: "Executor ended twice without reporting a status.",
        });
      });

    const process = (input: EngineInput) =>
      Effect.gen(function* () {
        if (input.kind === "schedule") {
          return yield* schedule(input.dagId);
        }
        const { event } = input;
        switch (event.type) {
          case "dag.status-set":
            if (event.payload.status === "running") yield* schedule(event.payload.dagId);
            return;
          case "dag.node-status-set": {
            // Late completion (e.g. the user marks a node done after its
            // executor already went idle): settle the executor now.
            const { status, outcome } = event.payload;
            const threadId = event.payload.threadId ?? outcome?.threadId ?? null;
            if (
              DAG_NODE_SATISFIED_STATUSES.has(status) &&
              threadId !== null &&
              !runningThreads.has(threadId)
            ) {
              yield* settleExecutorThread(threadId);
            }
            yield* schedule(event.payload.dagId);
            return;
          }
          case "dag.question-answered":
            yield* handleQuestionAnswered(event);
            return;
          case "thread.session-set":
            yield* handleSessionSet(event);
            return;
          default:
            return;
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("dag engine failed to process input", {
                kind: input.kind,
                cause: Cause.pretty(cause),
              }),
        ),
      );

    const worker = yield* makeDrainableWorker(process);

    const start: DagExecutionEngineShape["start"] = Effect.fn("DagExecutionEngine.start")(
      function* () {
        yield* forkParked(
          Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
            switch (event.type) {
              case "dag.status-set":
              case "dag.node-status-set":
              case "dag.question-answered":
              case "thread.session-set":
                return worker.enqueue({ kind: "event", event });
              default:
                return Effect.void;
            }
          }),
        );
      },
    );

    return {
      start,
      drain: worker.drain,
      schedule: (dagId) => worker.enqueue({ kind: "schedule", dagId }),
    } satisfies DagExecutionEngineShape;
  });

export const DagExecutionEngineLive = Layer.effect(DagExecutionEngine, makeDagExecutionEngine());
