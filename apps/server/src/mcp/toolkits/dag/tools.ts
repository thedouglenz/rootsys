/**
 * `dag_*` MCP toolkit (rootsys): lets any agent running inside a T3 thread
 * read, build, edit, and report progress on project DAGs.
 *
 * Scope resolution: a thread that is executing a DAG node (DagNode.threadId)
 * has that node/DAG bound implicitly, so `dagId`/`nodeId` may be omitted.
 * Planner and companion-editor threads pass `dagId` explicitly (it is placed
 * in their instructions).
 */
import {
  Dag,
  DagEdge,
  DagGraph,
  DagId,
  DagNode,
  DagNodeExecutionMode,
  DagNodeId,
  DagNodeStatus,
  DagQuestion,
  DagQuestionId,
  DagShell,
  ModelSelection,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  OrchestrationEngineService,
  ProjectionSnapshotQuery,
  ProviderRegistry,
];

export class DagToolError extends Schema.TaggedErrorClass<DagToolError>()("DagToolError", {
  reason: Schema.Literals([
    "capability-unavailable",
    "dag-not-found",
    "node-not-found",
    "no-bound-node",
    "invalid-input",
    "rejected",
    "internal",
  ]),
  message: TrimmedNonEmptyString,
}) {}

const OptionalDagId = Schema.optional(DagId).annotate({
  description: "DAG id. Omit when this thread is executing a DAG node — the node's DAG is used.",
});
const OptionalNodeId = Schema.optional(DagNodeId).annotate({
  description: "Node id. Omit when this thread is executing a DAG node — that node is used.",
});

const readonlyTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false) as T;

const mutatingTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.OpenWorld, false) as T;

export const DagListTool = readonlyTool(
  Tool.make("dag_list", {
    description:
      "List project DAGs (plans) in this environment with node/done/open-question counts. Filter by projectId; archived DAGs are hidden unless includeArchived=true.",
    parameters: Schema.Struct({
      projectId: Schema.optional(ProjectId),
      includeArchived: Schema.optional(Schema.Boolean),
    }),
    success: Schema.Struct({ dags: Schema.Array(DagShell) }),
    failure: DagToolError,
    dependencies,
  }).annotate(Tool.Title, "List DAGs"),
);

export const DagContext = Schema.Struct({
  graph: DagGraph,
  /** Node bound to the calling thread, when any. */
  boundNodeId: Schema.NullOr(DagNodeId),
  /** Nodes that could start now (pending with all dependencies satisfied). */
  readyNodeIds: Schema.Array(DagNodeId),
  /** Dependency order of all nodes. */
  topologicalOrder: Schema.Array(DagNodeId),
});
export type DagContext = typeof DagContext.Type;

export const DagGetTool = readonlyTool(
  Tool.make("dag_get", {
    description:
      "Read a full DAG: dag metadata, nodes (title, description, acceptance, status, executing thread, outcome), dependency edges, questions, plus derived ready nodes and topological order.",
    parameters: Schema.Struct({ dagId: OptionalDagId }),
    success: DagContext,
    failure: DagToolError,
    dependencies,
  }).annotate(Tool.Title, "Get DAG"),
);

export const DagCreateTool = mutatingTool(
  Tool.make("dag_create", {
    description:
      "Create a new, empty DAG in draft status. primaryProjectId defaults to the calling thread's project. Returns the created DAG; add nodes with dag_upsert_node.",
    parameters: Schema.Struct({
      title: TrimmedNonEmptyString,
      description: Schema.optional(TrimmedString),
      primaryProjectId: Schema.optional(ProjectId),
    }),
    success: Schema.Struct({ dag: Dag }),
    failure: DagToolError,
    dependencies,
  }).annotate(Tool.Title, "Create DAG"),
);

export const DagUpdateTool = mutatingTool(
  Tool.make("dag_update", {
    description:
      "Update DAG metadata and/or lifecycle status. Status: draft (editing), ready (validated, may run), running, paused, completed, failed, archived. Omitted fields are unchanged.",
    parameters: Schema.Struct({
      dagId: OptionalDagId,
      title: Schema.optional(TrimmedNonEmptyString),
      description: Schema.optional(TrimmedString),
      primaryProjectId: Schema.optional(Schema.NullOr(ProjectId)),
      status: Schema.optional(Dag.fields.status),
    }),
    success: Schema.Struct({ dag: Dag }),
    failure: DagToolError,
    dependencies,
  }).annotate(Tool.Title, "Update DAG"),
);

export const DagUpsertNodeTool = mutatingTool(
  Tool.make("dag_upsert_node", {
    description:
      "Create or update a node. Omit nodeId to create (a slug id is minted from the title; title required). On update, omitted fields are unchanged. dependsOn adds dependency edges (each must exist; cycles are rejected). Give every node a concrete `acceptance` — how an executor proves it is done — and set parallelSafe=true only if the node touches files no sibling touches.",
    parameters: Schema.Struct({
      dagId: OptionalDagId,
      nodeId: Schema.optional(DagNodeId),
      title: Schema.optional(TrimmedNonEmptyString),
      description: Schema.optional(TrimmedString),
      acceptance: Schema.optional(Schema.NullOr(TrimmedString)),
      projectId: Schema.optional(Schema.NullOr(ProjectId)).annotate({
        description: "Override the DAG's primary project for this node (multi-repo plans).",
      }),
      dependsOn: Schema.optional(Schema.Array(DagNodeId)),
      parallelSafe: Schema.optional(Schema.Boolean),
      executionMode: Schema.optional(DagNodeExecutionMode),
      modelSelection: Schema.optional(Schema.NullOr(ModelSelection)).annotate({
        description:
          "Run this node on a specific provider instance/model instead of the plan default. Use dag_list_models for valid instanceId/model pairs; null clears the override.",
      }),
    }),
    success: Schema.Struct({ node: DagNode, addedEdges: Schema.Array(DagEdge) }),
    failure: DagToolError,
    dependencies,
  }).annotate(Tool.Title, "Upsert DAG node"),
);

export const DagModelInstance = Schema.Struct({
  instanceId: ProviderInstanceId,
  driverKind: ProviderDriverKind,
  displayName: Schema.NullOr(TrimmedNonEmptyString),
  /** Model ids accepted as `modelSelection.model` for this instance. */
  models: Schema.Array(TrimmedNonEmptyString),
});
export type DagModelInstance = typeof DagModelInstance.Type;

export const DagListModelsTool = readonlyTool(
  Tool.make("dag_list_models", {
    description:
      "List the provider instances available in this environment and the model ids each one exposes. Use these instanceId/model pairs for dag_upsert_node's modelSelection when a node needs a specific provider or model.",
    // No `parameters` key at all. `Schema.Struct({})` renders as
    // `anyOf: [object, array]`, which is not a valid MCP inputSchema, and a
    // client that rejects one tool drops the whole server's toolset — see
    // the "every tool takes an object" guard in toolkitRegistration.test.ts.
    success: Schema.Struct({ instances: Schema.Array(DagModelInstance) }),
    failure: DagToolError,
    dependencies,
  }).annotate(Tool.Title, "List provider models"),
);

export const DagDeleteNodeTool = mutatingTool(
  Tool.make("dag_delete_node", {
    description: "Delete a node and every edge/question attached to it.",
    parameters: Schema.Struct({ dagId: OptionalDagId, nodeId: DagNodeId }),
    success: Schema.Struct({ deleted: Schema.Literal(true) }),
    failure: DagToolError,
    dependencies,
  })
    .annotate(Tool.Title, "Delete DAG node")
    .annotate(Tool.Destructive, true),
);

export const DagAddEdgeTool = mutatingTool(
  Tool.make("dag_add_edge", {
    description:
      "Add a dependency: fromNodeId must finish before toNodeId can start. Rejected if it would create a cycle.",
    parameters: Schema.Struct({ dagId: OptionalDagId, fromNodeId: DagNodeId, toNodeId: DagNodeId }),
    success: Schema.Struct({ edge: DagEdge }),
    failure: DagToolError,
    dependencies,
  }).annotate(Tool.Title, "Add DAG edge"),
);

export const DagRemoveEdgeTool = mutatingTool(
  Tool.make("dag_remove_edge", {
    description: "Remove a dependency edge.",
    parameters: Schema.Struct({ dagId: OptionalDagId, fromNodeId: DagNodeId, toNodeId: DagNodeId }),
    success: Schema.Struct({ removed: Schema.Literal(true) }),
    failure: DagToolError,
    dependencies,
  }).annotate(Tool.Title, "Remove DAG edge"),
);

export const DagValidationIssue = Schema.Struct({
  severity: Schema.Literals(["error", "warning"]),
  nodeId: Schema.NullOr(DagNodeId),
  message: TrimmedNonEmptyString,
});
export type DagValidationIssue = typeof DagValidationIssue.Type;

export const DagValidateTool = readonlyTool(
  Tool.make("dag_validate", {
    description:
      "Check a DAG for problems before marking it ready: empty graph, cycles (should be impossible), nodes missing description or acceptance, disconnected clusters, and terminal nodes with unfinished upstream. Returns issues; ok=true when there are no errors.",
    parameters: Schema.Struct({ dagId: OptionalDagId }),
    success: Schema.Struct({
      ok: Schema.Boolean,
      issues: Schema.Array(DagValidationIssue),
      topologicalOrder: Schema.Array(DagNodeId),
    }),
    failure: DagToolError,
    dependencies,
  }).annotate(Tool.Title, "Validate DAG"),
);

export const DagSetNodeStatusTool = mutatingTool(
  Tool.make("dag_set_node_status", {
    description:
      "Report a node's execution status. Call with status=running when you begin a node (this binds your thread to it), then status=done with a concise `summary` of what was built/decided (it becomes context for downstream nodes) or status=failed. Planners may use skipped. Omit nodeId when this thread is already bound to the node.",
    parameters: Schema.Struct({
      dagId: OptionalDagId,
      nodeId: OptionalNodeId,
      status: DagNodeStatus,
      summary: Schema.optional(TrimmedString),
    }),
    success: Schema.Struct({ node: DagNode }),
    failure: DagToolError,
    dependencies,
  }).annotate(Tool.Title, "Set DAG node status"),
);

export const DagAskUserTool = mutatingTool(
  Tool.make("dag_ask_user", {
    description:
      "Ask the human a question that blocks this node until answered. Returns immediately with the questionId; the node moves to `blocked`, other independent nodes keep running, and the answer arrives later as a follow-up message in this thread. Provide options when the choice is discrete. Only use when the answer materially changes the work.",
    parameters: Schema.Struct({
      dagId: OptionalDagId,
      nodeId: OptionalNodeId,
      question: TrimmedNonEmptyString,
      options: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
    }),
    success: Schema.Struct({ question: DagQuestion }),
    failure: DagToolError,
    dependencies,
  }).annotate(Tool.Title, "Ask the user (blocks node)"),
);

export const DagAnswerQuestionTool = mutatingTool(
  Tool.make("dag_answer_question", {
    description:
      "Record an answer to an open DAG question on the user's behalf (companion/editor use only when the user has told you the answer). answer=null dismisses it.",
    parameters: Schema.Struct({
      dagId: OptionalDagId,
      questionId: DagQuestionId,
      answer: Schema.NullOr(TrimmedString),
    }),
    success: Schema.Struct({ question: DagQuestion }),
    failure: DagToolError,
    dependencies,
  }).annotate(Tool.Title, "Answer DAG question"),
);

export const DagToolkit = Toolkit.make(
  DagListTool,
  DagGetTool,
  DagCreateTool,
  DagUpdateTool,
  DagUpsertNodeTool,
  DagListModelsTool,
  DagDeleteNodeTool,
  DagAddEdgeTool,
  DagRemoveEdgeTool,
  DagValidateTool,
  DagSetNodeStatusTool,
  DagAskUserTool,
  DagAnswerQuestionTool,
);

// Re-exported so handlers can reference thread ids without importing contracts twice.
export type { ThreadId };
