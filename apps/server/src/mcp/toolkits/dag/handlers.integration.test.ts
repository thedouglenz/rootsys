import {
  CommandId,
  DagId,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type DagNodeId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationCommandReceiptRepositoryLive } from "../../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../../project/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../../config.ts";
import * as ThreadBackgroundLiveness from "../../../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../../../orchestration/ThreadPlanProgress.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineLive } from "../../../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../../../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../../../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { DagToolError, DagToolkit } from "./tools.ts";
import { DagToolkitHandlersLive } from "./handlers.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const projectId = ProjectId.make("project-1");
const instanceId = ProviderInstanceId.make("codex");
const plannerThread = ThreadId.make("thread-planner");
const executorThread = ThreadId.make("thread-executor");
let commandCounter = 0;
const cmd = () => CommandId.make(`cmd-${++commandCounter}`);

const scopeFor = (
  threadId: ThreadId,
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["dag"],
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("env-1"),
  threadId,
  providerSessionId: "session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(capabilities),
  issuedAt: 0,
});

const providerSnapshot = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  displayName: "Codex",
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: NOW,
  models: [{ slug: "gpt-5", name: "GPT-5", isCustom: false, capabilities: null }],
  slashCommands: [],
} as unknown as ServerProvider;

/** Disabled instances cannot run a node, so they must not be offered. */
const disabledSnapshot = {
  ...providerSnapshot,
  instanceId: ProviderInstanceId.make("claude"),
  enabled: false,
} as ServerProvider;

const StubProviderRegistry = Layer.mock(ProviderRegistry)({
  getProviders: Effect.succeed([providerSnapshot, disabledSnapshot]),
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
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-dag-toolkit-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

const TestLayer = DagToolkitHandlersLive.pipe(
  Layer.provideMerge(OrchestrationTestLayer),
  Layer.provideMerge(StubProviderRegistry),
);

/**
 * A tool's JSON result. Named rather than `unknown` so `Effect.flip` on a call does
 * not move `unknown` into the error channel.
 */
type ToolResult = { readonly [key: string]: unknown };

/** Runs a toolkit call as if the MCP server had received it from `threadId`. */
const call = <Name extends keyof typeof DagToolkit.tools>(
  threadId: ThreadId,
  name: Name,
  input: unknown,
  capabilities?: ReadonlyArray<McpInvocationContext.McpCapability>,
) =>
  Effect.gen(function* () {
    const toolkit = yield* DagToolkit;
    const stream = yield* toolkit.handle(name, input as never);
    const results = yield* Stream.runCollect(stream);
    const last = results[results.length - 1];
    if (last === undefined) return yield* Effect.die("tool produced no result");
    // Declared failures are returned as results (isFailure), not raised.
    if (last.isFailure) return yield* Effect.fail(last.result as DagToolError);
    return last.result as ToolResult;
  }).pipe(
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      scopeFor(threadId, capabilities),
    ),
  );

it.layer(TestLayer)("dag toolkit handlers", (it) => {
  it.effect("plans, executes and questions a DAG end to end", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      yield* engine.dispatch({
        type: "project.create",
        commandId: cmd(),
        projectId,
        title: "Project",
        workspaceRoot: "/tmp/trellis-dag-toolkit-test",
        createdAt: NOW,
      });

      // Capability gate.
      const denied = yield* Effect.flip(call(plannerThread, "dag_list", {}, []));
      expect(denied).toBeInstanceOf(DagToolError);
      expect(denied.reason).toBe("capability-unavailable");

      // Planner (no bound node) creates a DAG explicitly scoped to the project.
      const created = (yield* call(plannerThread, "dag_create", {
        title: "Ship auth",
        description: "Add login",
        primaryProjectId: projectId,
      })) as { dag: { dagId: DagId; status: string } };
      const dagId = created.dag.dagId;
      expect(created.dag.status).toBe("draft");

      const a = (yield* call(plannerThread, "dag_upsert_node", {
        dagId,
        title: "Design schema",
        description: "Users table",
        acceptance: "migration applies",
      })) as { node: { nodeId: DagNodeId } };
      expect(a.node.nodeId).toMatch(/^design-schema-[0-9a-f]{6}$/);
      const b = (yield* call(plannerThread, "dag_upsert_node", {
        dagId,
        title: "Build login form",
        description: "React form",
        acceptance: "e2e passes",
        dependsOn: [a.node.nodeId],
      })) as { node: { nodeId: DagNodeId }; addedEdges: ReadonlyArray<unknown> };
      expect(b.addedEdges).toHaveLength(1);

      // Provider instances/models the planner may pin a node to.
      const models = (yield* call(plannerThread, "dag_list_models", {})) as {
        instances: ReadonlyArray<{
          instanceId: string;
          driverKind: string;
          displayName: string | null;
          models: ReadonlyArray<string>;
        }>;
      };
      expect(models.instances).toEqual([
        { instanceId, driverKind: "codex", displayName: "Codex", models: ["gpt-5"] },
      ]);

      // A node may pin its own provider instance/model.
      const pinned = (yield* call(plannerThread, "dag_upsert_node", {
        dagId,
        nodeId: a.node.nodeId,
        modelSelection: { instanceId, model: "gpt-5" },
      })) as { node: { modelSelection: { instanceId: string; model: string } | null } };
      expect(pinned.node.modelSelection).toEqual({ instanceId, model: "gpt-5" });

      // Missing nodeId without a title is rejected.
      const invalid = yield* Effect.flip(
        call(plannerThread, "dag_upsert_node", { dagId, description: "x" }),
      );
      expect(invalid.reason).toBe("invalid-input");

      // Cycle rejected through the decider.
      const cyclic = yield* Effect.flip(
        call(plannerThread, "dag_add_edge", {
          dagId,
          fromNodeId: b.node.nodeId,
          toNodeId: a.node.nodeId,
        }),
      );
      expect(cyclic.reason).toBe("rejected");

      const validation = (yield* call(plannerThread, "dag_validate", { dagId })) as {
        ok: boolean;
        topologicalOrder: ReadonlyArray<DagNodeId>;
      };
      expect(validation.ok).toBe(true);
      expect(validation.topologicalOrder).toEqual([a.node.nodeId, b.node.nodeId]);

      const context = (yield* call(plannerThread, "dag_get", { dagId })) as {
        readyNodeIds: ReadonlyArray<DagNodeId>;
        boundNodeId: DagNodeId | null;
      };
      expect(context.readyNodeIds).toEqual([a.node.nodeId]);
      expect(context.boundNodeId).toBeNull();

      // Executor thread: unbound at first, so implicit scope fails ...
      const unbound = yield* Effect.flip(
        call(executorThread, "dag_set_node_status", { status: "running" }),
      );
      expect(unbound.reason).toBe("no-bound-node");
      // ... but starting work (running) on an explicit unbound node binds the thread to it.
      yield* call(executorThread, "dag_set_node_status", {
        dagId,
        nodeId: a.node.nodeId,
        status: "running",
      });
      const bound = yield* snapshotQuery.findDagNodeByThreadId(executorThread);
      expect(Option.isSome(bound) && bound.value.node.nodeId).toBe(a.node.nodeId);

      // Now the executor can omit ids: ask a question, which blocks its node.
      const asked = (yield* call(executorThread, "dag_ask_user", {
        question: "Postgres or SQLite?",
        options: ["postgres", "sqlite"],
      })) as { question: { questionId: string; nodeId: DagNodeId; status: string } };
      expect(asked.question.nodeId).toBe(a.node.nodeId);
      const blocked = (yield* call(executorThread, "dag_get", {})) as {
        graph: { nodes: ReadonlyArray<{ nodeId: DagNodeId; status: string }> };
        boundNodeId: DagNodeId | null;
      };
      expect(blocked.boundNodeId).toBe(a.node.nodeId);
      expect(blocked.graph.nodes.find((n) => n.nodeId === a.node.nodeId)?.status).toBe("blocked");

      // Companion answers on the user's behalf → node resumes.
      yield* call(plannerThread, "dag_answer_question", {
        dagId,
        questionId: asked.question.questionId,
        answer: "postgres",
      });
      const done = (yield* call(executorThread, "dag_set_node_status", {
        status: "done",
        summary: "users table + migration 001",
      })) as { node: { status: string; outcome: { summary: string } | null } };
      expect(done.node.status).toBe("done");
      expect(done.node.outcome?.summary).toBe("users table + migration 001");

      const after = (yield* call(plannerThread, "dag_get", { dagId })) as {
        readyNodeIds: ReadonlyArray<DagNodeId>;
      };
      expect(after.readyNodeIds).toEqual([b.node.nodeId]);

      const list = (yield* call(plannerThread, "dag_list", { projectId })) as {
        dags: ReadonlyArray<{ dagId: DagId; doneCount: number; nodeCount: number }>;
      };
      expect(list.dags.map((d) => [d.dagId, d.nodeCount, d.doneCount])).toEqual([[dagId, 2, 1]]);
    }),
  );
});
