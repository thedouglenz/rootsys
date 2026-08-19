import {
  CommandId,
  DagId,
  DagNodeId,
  DagQuestionId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../../orchestration/ThreadPlanProgress.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import type { ProviderInstance } from "../../provider/ProviderDriver.ts";
import { ProviderInstanceRegistry } from "../../provider/Services/ProviderInstanceRegistry.ts";
import { DagExecutionEngine } from "../Services/DagExecutionEngine.ts";
import { DagExecutionEngineLive } from "./DagExecutionEngine.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const projectId = ProjectId.make("project-1");
const dagId = DagId.make("dag-1");
const nodeA = DagNodeId.make("node-a");
const nodeB = DagNodeId.make("node-b");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5" } as const;
let commandCounter = 0;
const cmd = () => CommandId.make(`cmd-${++commandCounter}`);

const stubInstance = {
  instanceId,
  driverKind: ProviderDriverKind.make("codex"),
  continuationIdentity: { driverKind: ProviderDriverKind.make("codex"), groupKey: "codex" },
  displayName: "Codex",
  enabled: true,
  snapshot: {} as ProviderInstance["snapshot"],
  adapter: {} as ProviderInstance["adapter"],
  textGeneration: {} as ProviderInstance["textGeneration"],
} as unknown as ProviderInstance;

const StubInstanceRegistry = Layer.succeed(ProviderInstanceRegistry, {
  getInstance: (id) => Effect.succeed(id === instanceId ? stubInstance : undefined),
  listInstances: Effect.succeed([stubInstance]),
  listUnavailable: Effect.succeed([]),
  streamChanges: Stream.empty,
  subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) => PubSub.subscribe(pubsub)),
});

const OrchestrationTestLayer = Layer.mergeAll(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
  ),
  OrchestrationProjectionSnapshotQueryLive,
).pipe(
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provide(SqlitePersistenceMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-dag-engine-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

// ServerActivation defaults to undefined here, so forkParked starts the
// engine's worker immediately.
const TestLayer = DagExecutionEngineLive.pipe(
  Layer.provideMerge(OrchestrationTestLayer),
  Layer.provideMerge(StubInstanceRegistry),
);

const dispatchAll = (commands: ReadonlyArray<OrchestrationCommand>) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    for (const command of commands) {
      yield* engine.dispatch(command);
    }
  });

/** Collect domain events into a queue so the test can read what the engine dispatched. */
const recordEvents = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const queue = yield* Queue.unbounded<OrchestrationEvent>();
  yield* Stream.runForEach(engine.streamDomainEvents, (event) => Queue.offer(queue, event)).pipe(
    Effect.forkScoped,
  );
  return queue;
});

const graphOf = Effect.gen(function* () {
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const graph = yield* snapshotQuery.getDagGraph(dagId);
  return Option.getOrThrow(graph);
});

const messageText = (event: OrchestrationEvent): string =>
  event.type === "thread.message-sent" ? event.payload.text : "";

const settle = (threadId: ThreadId, status: "running" | "idle" | "error") =>
  Effect.gen(function* () {
    yield* dispatchAll([
      {
        type: "thread.session.set",
        commandId: cmd(),
        threadId,
        session: {
          threadId,
          status,
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: status === "running" ? TurnId.make(`turn-${++commandCounter}`) : null,
          lastError: null,
          updatedAt: NOW,
        },
        createdAt: NOW,
      },
    ]);
  });

it.layer(TestLayer)("DagExecutionEngine", (it) => {
  it.effect("runs a two-node DAG serially, routes answers, nudges, and completes", () =>
    Effect.gen(function* () {
      const engine = yield* DagExecutionEngine;
      const events = yield* recordEvents;
      yield* engine.start();

      yield* dispatchAll([
        {
          type: "project.create",
          commandId: cmd(),
          projectId,
          title: "Project",
          workspaceRoot: "/tmp/rootsys-dag-engine-test",
          defaultModelSelection: modelSelection,
          createdAt: NOW,
        },
        {
          type: "dag.create",
          commandId: cmd(),
          dagId,
          title: "Plan",
          primaryProjectId: projectId,
          createdAt: NOW,
        },
        {
          type: "dag.node.upsert",
          commandId: cmd(),
          dagId,
          nodeId: nodeA,
          title: "A",
          description: "do a",
        },
        {
          type: "dag.node.upsert",
          commandId: cmd(),
          dagId,
          nodeId: nodeB,
          title: "B",
          description: "do b",
          dependsOn: [nodeA],
        },
        { type: "dag.status.set", commandId: cmd(), dagId, status: "running" },
      ]);
      yield* engine.drain;

      // Node A launched: thread created, bound, turn started.
      let graph = yield* graphOf;
      const a = graph.nodes.find((n) => n.nodeId === nodeA)!;
      expect(a.status).toBe("running");
      expect(a.threadId).not.toBeNull();
      const threadA = a.threadId!;
      expect(graph.nodes.find((n) => n.nodeId === nodeB)!.status).toBe("pending");
      const drained = yield* Queue.takeAll(events);
      const turnStarts = drained.filter((e) => e.type === "thread.turn-start-requested");
      expect(turnStarts).toHaveLength(1);
      const created = drained.find((e) => e.type === "thread.created");
      expect(created?.aggregateId).toBe(threadA);

      // Executor asks a question → node blocked; engine must not launch B.
      const questionId = DagQuestionId.make("q-1");
      yield* settle(threadA, "running");
      yield* dispatchAll([
        {
          type: "dag.question.ask",
          commandId: cmd(),
          dagId,
          nodeId: nodeA,
          questionId,
          threadId: threadA,
          prompt: "Which DB?",
        },
      ]);
      yield* engine.drain;
      yield* settle(threadA, "idle"); // agent ended its turn while blocked
      yield* engine.drain;
      graph = yield* graphOf;
      expect(graph.nodes.find((n) => n.nodeId === nodeA)!.status).toBe("blocked");
      yield* Queue.takeAll(events);

      // Answer → node resumes and the engine sends the answer as a new turn on thread A.
      yield* dispatchAll([
        { type: "dag.question.answer", commandId: cmd(), dagId, questionId, answer: "postgres" },
      ]);
      yield* engine.drain;
      const afterAnswer = yield* Queue.takeAll(events);
      const answerTurn = afterAnswer.find(
        (e) => e.type === "thread.message-sent" && e.aggregateId === threadA,
      );
      expect(answerTurn).toBeDefined();
      expect(messageText(answerTurn!)).toContain("postgres");
      expect((yield* graphOf).nodes.find((n) => n.nodeId === nodeA)!.status).toBe("running");

      // Executor ends its turn without reporting → one nudge turn, still running.
      yield* settle(threadA, "running");
      yield* settle(threadA, "idle");
      yield* engine.drain;
      const afterNudge = yield* Queue.takeAll(events);
      expect(
        afterNudge.filter((e) => e.type === "thread.message-sent" && e.aggregateId === threadA),
      ).toHaveLength(1);
      expect((yield* graphOf).nodes.find((n) => n.nodeId === nodeA)!.status).toBe("running");

      // Executor reports done → B launches on a new thread.
      yield* dispatchAll([
        {
          type: "dag.node.status.set",
          commandId: cmd(),
          dagId,
          nodeId: nodeA,
          status: "done",
          summary: "a done",
        },
      ]);
      yield* engine.drain;
      graph = yield* graphOf;
      const b = graph.nodes.find((n) => n.nodeId === nodeB)!;
      expect(b.status).toBe("running");
      expect(b.threadId).not.toBeNull();
      expect(b.threadId).not.toBe(threadA);
      const launchB = yield* Queue.takeAll(events);
      const promptB = launchB.find(
        (e) => e.type === "thread.message-sent" && e.aggregateId === b.threadId,
      );
      // Upstream outcome is fed to the downstream prompt.
      expect(messageText(promptB!)).toContain("a done");

      // B's session errors twice-without-report path: first idle → nudge, second idle → failed.
      yield* settle(b.threadId!, "running");
      yield* settle(b.threadId!, "idle");
      yield* engine.drain;
      yield* settle(b.threadId!, "running");
      yield* settle(b.threadId!, "idle");
      yield* engine.drain;
      graph = yield* graphOf;
      expect(graph.nodes.find((n) => n.nodeId === nodeB)!.status).toBe("failed");
      expect(graph.dag.status).toBe("failed");

      // User retries B → DAG resumes: set node pending and DAG running again.
      yield* dispatchAll([
        {
          type: "dag.node.status.set",
          commandId: cmd(),
          dagId,
          nodeId: nodeB,
          status: "pending",
          threadId: null,
        },
        { type: "dag.status.set", commandId: cmd(), dagId, status: "running" },
      ]);
      yield* engine.drain;
      graph = yield* graphOf;
      expect(graph.nodes.find((n) => n.nodeId === nodeB)!.status).toBe("running");
      yield* dispatchAll([
        {
          type: "dag.node.status.set",
          commandId: cmd(),
          dagId,
          nodeId: nodeB,
          status: "done",
          summary: "b done",
        },
      ]);
      yield* engine.drain;
      expect((yield* graphOf).dag.status).toBe("completed");
    }),
  );
});
