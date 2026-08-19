import {
  CommandId,
  DagId,
  DagNodeId,
  DagQuestionId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { ProjectionStateRepositoryLive } from "../../persistence/Layers/ProjectionState.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProjectionStateRepository } from "../../persistence/Services/ProjectionState.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../config.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import {
  ORCHESTRATION_PROJECTOR_NAMES,
  OrchestrationProjectionPipelineLive,
} from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const projectId = ProjectId.make("project-1");
const dagId = DagId.make("dag-1");
const nodeA = DagNodeId.make("node-a");
const nodeB = DagNodeId.make("node-b");
const threadId = ThreadId.make("thread-a");
let commandCounter = 0;
const cmd = () => CommandId.make(`cmd-${++commandCounter}`);

const TestLayer = Layer.mergeAll(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
  ),
  OrchestrationProjectionSnapshotQueryLive,
  ProjectionStateRepositoryLive,
).pipe(
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provide(SqlitePersistenceMemory),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-projection-pipeline-dag-test-" }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const dispatchAll = (commands: ReadonlyArray<OrchestrationCommand>) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    for (const command of commands) {
      yield* engine.dispatch(command);
    }
  });

it.layer(TestLayer)("ProjectionPipeline dags projector", (it) => {
  it.effect(
    "persists DAG graphs, serves them through the snapshot query, and removes them on delete",
    () =>
      Effect.gen(function* () {
        const snapshotQuery = yield* ProjectionSnapshotQuery;
        const projectionState = yield* ProjectionStateRepository;

        yield* dispatchAll([
          {
            type: "project.create",
            commandId: cmd(),
            projectId,
            title: "Project 1",
            workspaceRoot: "/tmp/project-1",
            defaultModelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5-codex",
            },
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
          { type: "dag.node.upsert", commandId: cmd(), dagId, nodeId: nodeA, title: "A" },
          {
            type: "dag.node.upsert",
            commandId: cmd(),
            dagId,
            nodeId: nodeB,
            title: "B",
            dependsOn: [nodeA],
          },
          {
            type: "dag.node.status.set",
            commandId: cmd(),
            dagId,
            nodeId: nodeA,
            status: "done",
            threadId,
            summary: "did A",
          },
          {
            type: "dag.question.ask",
            commandId: cmd(),
            dagId,
            nodeId: nodeB,
            questionId: DagQuestionId.make("q-1"),
            prompt: "Which approach?",
            options: ["x", "y"],
          },
        ]);

        const graph = yield* snapshotQuery.getDagGraph(dagId);
        expect(Option.isSome(graph)).toBe(true);
        if (Option.isNone(graph)) return;
        expect(graph.value.dag).toMatchObject({
          dagId,
          title: "Plan",
          primaryProjectId: projectId,
          status: "draft",
        });
        expect(graph.value.nodes.map((node) => [node.nodeId, node.status])).toEqual([
          [nodeA, "done"],
          [nodeB, "blocked"],
        ]);
        expect(graph.value.nodes[0]?.threadId).toBe(threadId);
        expect(graph.value.nodes[0]?.outcome?.summary).toBe("did A");
        expect(graph.value.edges).toEqual([{ dagId, fromNodeId: nodeA, toNodeId: nodeB }]);
        expect(graph.value.questions.map((question) => question.status)).toEqual(["open"]);

        expect(yield* snapshotQuery.listDagShells({})).toEqual([
          expect.objectContaining({ dagId, nodeCount: 2, doneCount: 1, openQuestionCount: 1 }),
        ]);
        expect(yield* snapshotQuery.listDagShells({ projectId })).toHaveLength(1);
        expect(
          yield* snapshotQuery.listDagShells({ projectId: ProjectId.make("project-other") }),
        ).toEqual([]);

        const readModel = yield* snapshotQuery.getCommandReadModel();
        expect(readModel.dags).toEqual([graph.value]);

        const dagSnapshot = yield* snapshotQuery.getDagSnapshot(dagId);
        expect(Option.isSome(dagSnapshot)).toBe(true);
        if (Option.isSome(dagSnapshot)) {
          expect(dagSnapshot.value.graph).toEqual(graph.value);
          expect(dagSnapshot.value.snapshotSequence).toBe(readModel.snapshotSequence);
        }

        const binding = yield* snapshotQuery.findDagNodeByThreadId(threadId);
        expect(Option.map(binding, (value) => [value.dagId, value.node.nodeId])).toEqual(
          Option.some([dagId, nodeA]),
        );
        expect(
          Option.isNone(yield* snapshotQuery.findDagNodeByThreadId(ThreadId.make("thread-none"))),
        ).toBe(true);

        const cursor = yield* projectionState.getByProjector({
          projector: ORCHESTRATION_PROJECTOR_NAMES.dags,
        });
        expect(Option.map(cursor, (row) => row.lastAppliedSequence)).toEqual(
          Option.some(readModel.snapshotSequence),
        );

        yield* dispatchAll([{ type: "dag.delete", commandId: cmd(), dagId }]);
        expect(Option.isNone(yield* snapshotQuery.getDagGraph(dagId))).toBe(true);
        expect(yield* snapshotQuery.listDagShells({})).toEqual([]);
        expect((yield* snapshotQuery.getCommandReadModel()).dags).toEqual([]);
      }),
  );

  it.effect("mirrors node bindings and creation-time links onto thread shells and details", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const linkDagId = DagId.make("dag-link");
      const executorThreadId = ThreadId.make("thread-executor");
      const plannerThreadId = ThreadId.make("thread-planner");
      const modelSelection = {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      };
      const linkProjectId = ProjectId.make("project-link");

      yield* dispatchAll([
        {
          type: "project.create",
          commandId: cmd(),
          projectId: linkProjectId,
          title: "Project link",
          workspaceRoot: "/tmp/project-link",
          defaultModelSelection: modelSelection,
          createdAt: NOW,
        },
        {
          type: "dag.create",
          commandId: cmd(),
          dagId: linkDagId,
          title: "Plan link",
          primaryProjectId: linkProjectId,
          createdAt: NOW,
        },
        { type: "dag.node.upsert", commandId: cmd(), dagId: linkDagId, nodeId: nodeA, title: "A" },
        // A chat thread that later binds itself to a node via the MCP tool.
        {
          type: "thread.create",
          commandId: cmd(),
          threadId: executorThreadId,
          projectId: linkProjectId,
          title: "Chat",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: NOW,
        },
        // A planner thread tagged at creation.
        {
          type: "thread.create",
          commandId: cmd(),
          threadId: plannerThreadId,
          projectId: linkProjectId,
          title: "Planner",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          dagLink: { dagId: linkDagId, nodeId: null, role: "planner" },
          createdAt: NOW,
        },
      ]);

      expect(
        Option.map(yield* snapshotQuery.getThreadShellById(executorThreadId), (s) => s.dagLink),
      ).toEqual(Option.some(null));

      yield* dispatchAll([
        {
          type: "dag.node.status.set",
          commandId: cmd(),
          dagId: linkDagId,
          nodeId: nodeA,
          status: "running",
          threadId: executorThreadId,
        },
      ]);

      const executorLink = { dagId: linkDagId, nodeId: nodeA, role: "executor" };
      expect(
        Option.map(yield* snapshotQuery.getThreadShellById(executorThreadId), (s) => s.dagLink),
      ).toEqual(Option.some(executorLink));
      expect(
        Option.map(yield* snapshotQuery.getThreadDetailById(executorThreadId), (t) => t.dagLink),
      ).toEqual(Option.some(executorLink));

      const plannerLink = { dagId: linkDagId, nodeId: null, role: "planner" };
      expect(
        Option.map(yield* snapshotQuery.getThreadShellById(plannerThreadId), (s) => s.dagLink),
      ).toEqual(Option.some(plannerLink));
      expect(
        Option.map(yield* snapshotQuery.getThreadDetailById(plannerThreadId), (t) => t.dagLink),
      ).toEqual(Option.some(plannerLink));

      // The in-memory command read model agrees with the persisted rows.
      const readModel = yield* snapshotQuery.getCommandReadModel();
      expect(readModel.threads.find((t) => t.id === executorThreadId)?.dagLink).toEqual(
        executorLink,
      );
      expect(readModel.threads.find((t) => t.id === plannerThreadId)?.dagLink).toEqual(plannerLink);
    }),
  );

  it.effect("prefers the active node when several nodes bind the same thread", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const otherDagId = DagId.make("dag-2");
      const otherThreadId = ThreadId.make("thread-shared");

      yield* dispatchAll([
        {
          type: "dag.create",
          commandId: cmd(),
          dagId: otherDagId,
          title: "Plan 2",
          createdAt: NOW,
        },
        { type: "dag.node.upsert", commandId: cmd(), dagId: otherDagId, nodeId: nodeA, title: "A" },
        { type: "dag.node.upsert", commandId: cmd(), dagId: otherDagId, nodeId: nodeB, title: "B" },
        {
          type: "dag.node.status.set",
          commandId: cmd(),
          dagId: otherDagId,
          nodeId: nodeA,
          status: "done",
          threadId: otherThreadId,
        },
        {
          type: "dag.node.status.set",
          commandId: cmd(),
          dagId: otherDagId,
          nodeId: nodeB,
          status: "running",
          threadId: otherThreadId,
        },
      ]);

      const binding = yield* snapshotQuery.findDagNodeByThreadId(otherThreadId);
      expect(Option.map(binding, (value) => value.node.nodeId)).toEqual(Option.some(nodeB));
    }),
  );
});
