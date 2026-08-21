/**
 * DAG contracts — the project plan graph that rootsys layers on top of T3 Code.
 *
 * A `Dag` is an environment-scoped aggregate: it is not owned by a project so
 * that its nodes can eventually target more than one project/repo. Today
 * every node inherits `Dag.primaryProjectId` unless it names its own
 * `projectId`.
 *
 * Nodes carry the *what* (title/description/acceptance) and their execution
 * linkage (status, executing thread, outcome). Edges are plain dependency
 * pairs. Readiness ("all deps done") is derived, never stored, so the
 * scheduler and the canvas cannot disagree about it.
 *
 * Commands and event payloads live here; the event/command unions themselves
 * are wired into `orchestration.ts` so DAG events ride the same event store,
 * decider, and projector as projects and threads.
 */
import * as Schema from "effect/Schema";

import {
  CommandId,
  DagId,
  DagNodeId,
  DagQuestionId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/**
 * Lifecycle of the plan as a whole. `draft` while being built/edited, `ready`
 * once validated and eligible to run, then the run states. `paused` keeps
 * in-flight nodes but schedules nothing new.
 */
export const DagStatus = Schema.Literals([
  "draft",
  "ready",
  "running",
  "paused",
  "completed",
  "failed",
  "archived",
]);
export type DagStatus = typeof DagStatus.Type;

/**
 * Stored node status. `ready` is intentionally absent: it is derived from
 * `pending` + every upstream node `done`/`skipped`. `blocked` means the node
 * is waiting on a human (an open question); the executing thread stays bound.
 */
export const DagNodeStatus = Schema.Literals([
  "pending",
  "running",
  "blocked",
  "done",
  "failed",
  "skipped",
]);
export type DagNodeStatus = typeof DagNodeStatus.Type;

export const DAG_NODE_TERMINAL_STATUSES: ReadonlySet<DagNodeStatus> = new Set([
  "done",
  "failed",
  "skipped",
]);

/** Statuses that count as "satisfied" for downstream readiness. */
export const DAG_NODE_SATISFIED_STATUSES: ReadonlySet<DagNodeStatus> = new Set(["done", "skipped"]);

/**
 * How the executor should run a node. `auto` lets the engine pick per
 * provider (Claude → workflow when the node is fan-out shaped, otherwise a
 * plain turn). Explicit values pin a strategy.
 */
export const DagNodeExecutionMode = Schema.Literals(["auto", "turn", "workflow"]);
export type DagNodeExecutionMode = typeof DagNodeExecutionMode.Type;

/**
 * Recorded when a node reaches a terminal status. `summary` is what the
 * executor reports back and is fed into downstream node prompts as context.
 */
export const DagNodeOutcome = Schema.Struct({
  summary: Schema.NullOr(TrimmedString),
  threadId: Schema.NullOr(ThreadId),
  completedAt: IsoDateTime,
});
export type DagNodeOutcome = typeof DagNodeOutcome.Type;

export const DagNode = Schema.Struct({
  nodeId: DagNodeId,
  dagId: DagId,
  // Null = inherit Dag.primaryProjectId. Non-null lets one DAG span repos.
  projectId: Schema.NullOr(ProjectId),
  title: TrimmedNonEmptyString,
  description: TrimmedString,
  // How the executor proves the node is done. Optional but strongly
  // encouraged by the planner; the engine passes it into the node prompt.
  acceptance: Schema.NullOr(TrimmedString),
  // Planner-declared: this node does not touch files any concurrently
  // runnable sibling touches, so it may run in its own worktree in parallel.
  parallelSafe: Schema.Boolean,
  executionMode: DagNodeExecutionMode,
  // Per-node override; null = use the DAG default / project default.
  modelSelection: Schema.NullOr(ModelSelection),
  status: DagNodeStatus,
  // Thread currently (or last) executing this node.
  threadId: Schema.NullOr(ThreadId),
  outcome: Schema.NullOr(DagNodeOutcome),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type DagNode = typeof DagNode.Type;

export const DagEdge = Schema.Struct({
  dagId: DagId,
  // fromNodeId must complete before toNodeId may start.
  fromNodeId: DagNodeId,
  toNodeId: DagNodeId,
});
export type DagEdge = typeof DagEdge.Type;

export const DagQuestionStatus = Schema.Literals(["open", "answered", "dismissed"]);
export type DagQuestionStatus = typeof DagQuestionStatus.Type;

/**
 * A question raised mid-execution (typically via the `dag_ask_user` MCP tool)
 * that blocks its node until answered. Other frontier nodes keep running.
 */
export const DagQuestion = Schema.Struct({
  questionId: DagQuestionId,
  dagId: DagId,
  nodeId: DagNodeId,
  // Thread that asked, so the answer can be routed back into the same turn.
  threadId: Schema.NullOr(ThreadId),
  prompt: TrimmedNonEmptyString,
  options: Schema.Array(TrimmedNonEmptyString),
  status: DagQuestionStatus,
  answer: Schema.NullOr(TrimmedString),
  createdAt: IsoDateTime,
  answeredAt: Schema.NullOr(IsoDateTime),
});
export type DagQuestion = typeof DagQuestion.Type;

/**
 * Why the engine paused a plan on its own. `providerMessage` carries the
 * executor's last words (e.g. a rate-limit notice) so the UI can explain the
 * pause without the user reading server logs.
 */
export const DagPauseReason = Schema.Struct({
  kind: Schema.Literals([
    "provider-refused",
    "provider-unavailable",
    "no-model",
    "no-project",
    "unresolved",
  ]),
  nodeId: Schema.NullOr(DagNodeId),
  threadId: Schema.NullOr(ThreadId),
  providerMessage: Schema.NullOr(TrimmedString),
  pausedAt: IsoDateTime,
});
export type DagPauseReason = typeof DagPauseReason.Type;

export const Dag = Schema.Struct({
  dagId: DagId,
  title: TrimmedNonEmptyString,
  description: TrimmedString,
  // Nodes without their own projectId execute here. Nullable so a DAG can be
  // drafted before a project is chosen (or span projects entirely by nodes).
  primaryProjectId: Schema.NullOr(ProjectId),
  status: DagStatus,
  // Default model for node execution; nodes may override.
  defaultModelSelection: Schema.NullOr(ModelSelection),
  // Set when the engine pauses itself; cleared whenever the plan runs again.
  // Optional so pre-pause-reason payloads decode.
  pauseReason: Schema.optional(Schema.NullOr(DagPauseReason)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Dag = typeof Dag.Type;

/** Full graph as the read model / snapshot carries it. */
export const DagGraph = Schema.Struct({
  dag: Dag,
  nodes: Schema.Array(DagNode),
  edges: Schema.Array(DagEdge),
  questions: Schema.Array(DagQuestion),
});
export type DagGraph = typeof DagGraph.Type;

/** Lightweight row for DAG lists. */
export const DagShell = Schema.Struct({
  dagId: DagId,
  title: TrimmedNonEmptyString,
  primaryProjectId: Schema.NullOr(ProjectId),
  status: DagStatus,
  nodeCount: NonNegativeInt,
  doneCount: NonNegativeInt,
  openQuestionCount: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type DagShell = typeof DagShell.Type;

// ---------------------------------------------------------------------------
// Commands (client-dispatchable unless noted)
// ---------------------------------------------------------------------------

export const DagCreateCommand = Schema.Struct({
  type: Schema.Literal("dag.create"),
  commandId: CommandId,
  dagId: DagId,
  title: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedString),
  primaryProjectId: Schema.optional(Schema.NullOr(ProjectId)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  createdAt: IsoDateTime,
});
export type DagCreateCommand = typeof DagCreateCommand.Type;

export const DagMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("dag.meta.update"),
  commandId: CommandId,
  dagId: DagId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(TrimmedString),
  // Absent = unchanged; null = clear.
  primaryProjectId: Schema.optional(Schema.NullOr(ProjectId)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
});
export type DagMetaUpdateCommand = typeof DagMetaUpdateCommand.Type;

export const DagStatusSetCommand = Schema.Struct({
  type: Schema.Literal("dag.status.set"),
  commandId: CommandId,
  dagId: DagId,
  status: DagStatus,
  // Engine-supplied when it pauses itself. Any transition to a non-paused
  // status clears the stored reason.
  reason: Schema.optional(Schema.NullOr(DagPauseReason)),
});
export type DagStatusSetCommand = typeof DagStatusSetCommand.Type;

export const DagDeleteCommand = Schema.Struct({
  type: Schema.Literal("dag.delete"),
  commandId: CommandId,
  dagId: DagId,
});
export type DagDeleteCommand = typeof DagDeleteCommand.Type;

/**
 * Create-or-update. Absent fields keep their current value on update and take
 * defaults on create (`status: pending`, `parallelSafe: false`,
 * `executionMode: auto`). Structural fields only — status changes go through
 * `dag.node.status.set` so execution history stays legible in the event log.
 */
export const DagNodeUpsertCommand = Schema.Struct({
  type: Schema.Literal("dag.node.upsert"),
  commandId: CommandId,
  dagId: DagId,
  nodeId: DagNodeId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(TrimmedString),
  acceptance: Schema.optional(Schema.NullOr(TrimmedString)),
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  parallelSafe: Schema.optional(Schema.Boolean),
  executionMode: Schema.optional(DagNodeExecutionMode),
  modelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  // Convenience for planners: dependencies to add atomically with the node.
  // Each must already exist in the DAG. Existing edges are unaffected.
  dependsOn: Schema.optional(Schema.Array(DagNodeId)),
});
export type DagNodeUpsertCommand = typeof DagNodeUpsertCommand.Type;

export const DagNodeDeleteCommand = Schema.Struct({
  type: Schema.Literal("dag.node.delete"),
  commandId: CommandId,
  dagId: DagId,
  nodeId: DagNodeId,
});
export type DagNodeDeleteCommand = typeof DagNodeDeleteCommand.Type;

export const DagEdgeAddCommand = Schema.Struct({
  type: Schema.Literal("dag.edge.add"),
  commandId: CommandId,
  dagId: DagId,
  fromNodeId: DagNodeId,
  toNodeId: DagNodeId,
});
export type DagEdgeAddCommand = typeof DagEdgeAddCommand.Type;

export const DagEdgeRemoveCommand = Schema.Struct({
  type: Schema.Literal("dag.edge.remove"),
  commandId: CommandId,
  dagId: DagId,
  fromNodeId: DagNodeId,
  toNodeId: DagNodeId,
});
export type DagEdgeRemoveCommand = typeof DagEdgeRemoveCommand.Type;

/**
 * Execution-side status transition. Dispatched by the engine as it schedules,
 * by MCP tools when an agent reports completion, or by the user (skip/retry).
 * `threadId` binds/rebinds the executing thread; `summary` is recorded into
 * the node outcome on terminal statuses.
 */
export const DagNodeStatusSetCommand = Schema.Struct({
  type: Schema.Literal("dag.node.status.set"),
  commandId: CommandId,
  dagId: DagId,
  nodeId: DagNodeId,
  status: DagNodeStatus,
  threadId: Schema.optional(Schema.NullOr(ThreadId)),
  summary: Schema.optional(Schema.NullOr(TrimmedString)),
});
export type DagNodeStatusSetCommand = typeof DagNodeStatusSetCommand.Type;

export const DagQuestionAskCommand = Schema.Struct({
  type: Schema.Literal("dag.question.ask"),
  commandId: CommandId,
  dagId: DagId,
  nodeId: DagNodeId,
  questionId: DagQuestionId,
  threadId: Schema.optional(Schema.NullOr(ThreadId)),
  prompt: TrimmedNonEmptyString,
  options: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type DagQuestionAskCommand = typeof DagQuestionAskCommand.Type;

export const DagQuestionAnswerCommand = Schema.Struct({
  type: Schema.Literal("dag.question.answer"),
  commandId: CommandId,
  dagId: DagId,
  questionId: DagQuestionId,
  // Null answer = dismissed without an answer.
  answer: Schema.NullOr(TrimmedString),
});
export type DagQuestionAnswerCommand = typeof DagQuestionAnswerCommand.Type;

export const DagCommand = Schema.Union([
  DagCreateCommand,
  DagMetaUpdateCommand,
  DagStatusSetCommand,
  DagDeleteCommand,
  DagNodeUpsertCommand,
  DagNodeDeleteCommand,
  DagEdgeAddCommand,
  DagEdgeRemoveCommand,
  DagNodeStatusSetCommand,
  DagQuestionAskCommand,
  DagQuestionAnswerCommand,
]);
export type DagCommand = typeof DagCommand.Type;

export const DAG_COMMAND_TYPES = [
  "dag.create",
  "dag.meta.update",
  "dag.status.set",
  "dag.delete",
  "dag.node.upsert",
  "dag.node.delete",
  "dag.edge.add",
  "dag.edge.remove",
  "dag.node.status.set",
  "dag.question.ask",
  "dag.question.answer",
] as const satisfies ReadonlyArray<DagCommand["type"]>;

export const isDagCommandType = (type: string): type is DagCommand["type"] =>
  (DAG_COMMAND_TYPES as ReadonlyArray<string>).includes(type);

export const isDagCommand = (command: { readonly type: string }): command is DagCommand =>
  isDagCommandType(command.type);

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

export const DAG_EVENT_TYPES = [
  "dag.created",
  "dag.meta-updated",
  "dag.status-set",
  "dag.deleted",
  "dag.node-upserted",
  "dag.node-deleted",
  "dag.edge-added",
  "dag.edge-removed",
  "dag.node-status-set",
  "dag.question-asked",
  "dag.question-answered",
] as const;
export type DagEventType = (typeof DAG_EVENT_TYPES)[number];

export const isDagEventType = (type: string): type is DagEventType =>
  (DAG_EVENT_TYPES as ReadonlyArray<string>).includes(type);

export const DagCreatedPayload = Schema.Struct({
  dagId: DagId,
  title: TrimmedNonEmptyString,
  description: TrimmedString,
  primaryProjectId: Schema.NullOr(ProjectId),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  createdAt: IsoDateTime,
});
export type DagCreatedPayload = typeof DagCreatedPayload.Type;

export const DagMetaUpdatedPayload = Schema.Struct({
  dagId: DagId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(TrimmedString),
  primaryProjectId: Schema.optional(Schema.NullOr(ProjectId)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  updatedAt: IsoDateTime,
});
export type DagMetaUpdatedPayload = typeof DagMetaUpdatedPayload.Type;

export const DagStatusSetPayload = Schema.Struct({
  dagId: DagId,
  status: DagStatus,
  reason: Schema.optional(Schema.NullOr(DagPauseReason)),
  updatedAt: IsoDateTime,
});
export type DagStatusSetPayload = typeof DagStatusSetPayload.Type;

export const DagDeletedPayload = Schema.Struct({
  dagId: DagId,
  deletedAt: IsoDateTime,
});
export type DagDeletedPayload = typeof DagDeletedPayload.Type;

/** Carries the full post-upsert node so projectors never need to merge. */
export const DagNodeUpsertedPayload = Schema.Struct({
  dagId: DagId,
  node: DagNode,
  // Edges created atomically with the node via `dependsOn`.
  addedEdges: Schema.Array(DagEdge),
  updatedAt: IsoDateTime,
});
export type DagNodeUpsertedPayload = typeof DagNodeUpsertedPayload.Type;

export const DagNodeDeletedPayload = Schema.Struct({
  dagId: DagId,
  nodeId: DagNodeId,
  updatedAt: IsoDateTime,
});
export type DagNodeDeletedPayload = typeof DagNodeDeletedPayload.Type;

export const DagEdgeAddedPayload = Schema.Struct({
  dagId: DagId,
  fromNodeId: DagNodeId,
  toNodeId: DagNodeId,
  updatedAt: IsoDateTime,
});
export type DagEdgeAddedPayload = typeof DagEdgeAddedPayload.Type;

export const DagEdgeRemovedPayload = Schema.Struct({
  dagId: DagId,
  fromNodeId: DagNodeId,
  toNodeId: DagNodeId,
  updatedAt: IsoDateTime,
});
export type DagEdgeRemovedPayload = typeof DagEdgeRemovedPayload.Type;

export const DagNodeStatusSetPayload = Schema.Struct({
  dagId: DagId,
  nodeId: DagNodeId,
  status: DagNodeStatus,
  // Absent = leave the current binding.
  threadId: Schema.optional(Schema.NullOr(ThreadId)),
  // Present when the transition is terminal.
  outcome: Schema.optional(Schema.NullOr(DagNodeOutcome)),
  updatedAt: IsoDateTime,
});
export type DagNodeStatusSetPayload = typeof DagNodeStatusSetPayload.Type;

export const DagQuestionAskedPayload = Schema.Struct({
  dagId: DagId,
  question: DagQuestion,
  updatedAt: IsoDateTime,
});
export type DagQuestionAskedPayload = typeof DagQuestionAskedPayload.Type;

export const DagQuestionAnsweredPayload = Schema.Struct({
  dagId: DagId,
  questionId: DagQuestionId,
  nodeId: DagNodeId,
  status: DagQuestionStatus,
  answer: Schema.NullOr(TrimmedString),
  answeredAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type DagQuestionAnsweredPayload = typeof DagQuestionAnsweredPayload.Type;

// ---------------------------------------------------------------------------
// Derived helpers (pure, shared by server engine, MCP tools, and clients)
// ---------------------------------------------------------------------------

/**
 * Nodes that may start now: `pending` with every upstream node satisfied.
 * Nodes with no incoming edges are ready immediately.
 */
export function readyDagNodes(graph: {
  readonly nodes: ReadonlyArray<DagNode>;
  readonly edges: ReadonlyArray<DagEdge>;
}): ReadonlyArray<DagNode> {
  const statusById = new Map(graph.nodes.map((node) => [node.nodeId, node.status] as const));
  const upstream = new Map<DagNodeId, Array<DagNodeId>>();
  for (const edge of graph.edges) {
    const list = upstream.get(edge.toNodeId) ?? [];
    list.push(edge.fromNodeId);
    upstream.set(edge.toNodeId, list);
  }
  return graph.nodes.filter((node) => {
    if (node.status !== "pending") return false;
    const deps = upstream.get(node.nodeId) ?? [];
    return deps.every((dep) => {
      const status = statusById.get(dep);
      return status !== undefined && DAG_NODE_SATISFIED_STATUSES.has(status);
    });
  });
}

/**
 * True when adding `from -> to` would create a cycle, i.e. `from` is already
 * reachable from `to`. Self-edges are cycles.
 */
export function dagEdgeWouldCreateCycle(
  edges: ReadonlyArray<Pick<DagEdge, "fromNodeId" | "toNodeId">>,
  from: DagNodeId,
  to: DagNodeId,
): boolean {
  if (from === to) return true;
  const adjacency = new Map<DagNodeId, Array<DagNodeId>>();
  for (const edge of edges) {
    const list = adjacency.get(edge.fromNodeId) ?? [];
    list.push(edge.toNodeId);
    adjacency.set(edge.fromNodeId, list);
  }
  const seen = new Set<DagNodeId>();
  const stack: Array<DagNodeId> = [to];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === from) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) stack.push(next);
  }
  return false;
}

/**
 * Kahn's algorithm. Returns node ids in dependency order, or null if the graph
 * has a cycle (should be unreachable when edges pass `dagEdgeWouldCreateCycle`).
 */
export function topologicalDagOrder(graph: {
  readonly nodes: ReadonlyArray<Pick<DagNode, "nodeId">>;
  readonly edges: ReadonlyArray<Pick<DagEdge, "fromNodeId" | "toNodeId">>;
}): ReadonlyArray<DagNodeId> | null {
  const indegree = new Map<DagNodeId, number>();
  const adjacency = new Map<DagNodeId, Array<DagNodeId>>();
  for (const node of graph.nodes) indegree.set(node.nodeId, 0);
  for (const edge of graph.edges) {
    if (!indegree.has(edge.fromNodeId) || !indegree.has(edge.toNodeId)) continue;
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1);
    const list = adjacency.get(edge.fromNodeId) ?? [];
    list.push(edge.toNodeId);
    adjacency.set(edge.fromNodeId, list);
  }
  const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const order: Array<DagNodeId> = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return order.length === graph.nodes.length ? order : null;
}

export function dagShellFromGraph(graph: DagGraph): DagShell {
  return {
    dagId: graph.dag.dagId,
    title: graph.dag.title,
    primaryProjectId: graph.dag.primaryProjectId,
    status: graph.dag.status,
    nodeCount: graph.nodes.length,
    doneCount: graph.nodes.filter((node) => DAG_NODE_SATISFIED_STATUSES.has(node.status)).length,
    openQuestionCount: graph.questions.filter((question) => question.status === "open").length,
    createdAt: graph.dag.createdAt,
    updatedAt: graph.dag.updatedAt,
  };
}

/**
 * How a thread relates to a DAG. Executors are bound to a node; planner and
 * companion threads belong to the DAG as a whole. Carried on the thread shell
 * so every client surface (sidebar, header, side panel) can see it without a
 * reverse lookup.
 */
export const ThreadDagRole = Schema.Literals(["executor", "planner", "companion"]);
export type ThreadDagRole = typeof ThreadDagRole.Type;

export const ThreadDagLink = Schema.Struct({
  dagId: DagId,
  nodeId: Schema.NullOr(DagNodeId),
  role: ThreadDagRole,
});
export type ThreadDagLink = typeof ThreadDagLink.Type;

/** Prefix of a planner thread's title. Exported so clients can parse it back. */
export const DAG_PLANNER_TITLE_PREFIX = "Planning — ";
/** Prefix of a companion thread's title. */
export const DAG_COMPANION_TITLE_PREFIX = "Companion — ";

/**
 * The title a plan gives one of its threads, and the single source of truth
 * for it: the engine names the executor threads it launches, the client names
 * the planner and companion threads it starts, and the engine re-normalizes
 * both at startup. Executors are named after their node alone — the sidebar's
 * plan group header and the `Plan ▸` chip already say which plan this is, and
 * repeating the plan title truncates every executor row to the same string.
 * Returns null when the intended title is unknowable (an executor whose node
 * is gone), which callers read as "leave this title alone".
 */
export function dagThreadTitle(input: {
  readonly dagTitle: string;
  readonly role: ThreadDagRole;
  readonly nodeTitle?: string | null | undefined;
}): string | null {
  switch (input.role) {
    case "planner":
      return `${DAG_PLANNER_TITLE_PREFIX}${input.dagTitle}`;
    case "companion":
      return `${DAG_COMPANION_TITLE_PREFIX}${input.dagTitle}`;
    case "executor":
      return input.nodeTitle ?? null;
  }
}

// ---------------------------------------------------------------------------
// RPC input/output
// ---------------------------------------------------------------------------

export const OrchestrationListDagsInput = Schema.Struct({
  // Absent = all DAGs in the environment.
  projectId: Schema.optionalKey(ProjectId),
  includeArchived: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationListDagsInput = typeof OrchestrationListDagsInput.Type;

export const OrchestrationListDagsResult = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  dags: Schema.Array(DagShell),
});
export type OrchestrationListDagsResult = typeof OrchestrationListDagsResult.Type;

export const OrchestrationSubscribeDagInput = Schema.Struct({
  dagId: DagId,
  // Same resume semantics as subscribeThread.
  afterSequence: Schema.optionalKey(NonNegativeInt),
  requestCompletionMarker: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationSubscribeDagInput = typeof OrchestrationSubscribeDagInput.Type;

export const OrchestrationDagSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  graph: DagGraph,
});
export type OrchestrationDagSnapshot = typeof OrchestrationDagSnapshot.Type;

/** Who caused a timeline entry, inferred from the command id prefix. */
export const DagTimelineActor = Schema.Literals(["user", "agent", "engine", "server"]);
export type DagTimelineActor = typeof DagTimelineActor.Type;

/**
 * One row of a DAG's run log, derived from its events. Kept flat and
 * presentational so clients render it without re-deriving from the event
 * store.
 */
export const DagTimelineEntry = Schema.Struct({
  sequence: NonNegativeInt,
  occurredAt: IsoDateTime,
  kind: Schema.Literals([
    "dag-created",
    "dag-status",
    "node-status",
    "node-upserted",
    "node-deleted",
    "edge-added",
    "edge-removed",
    "question-asked",
    "question-answered",
  ]),
  actor: DagTimelineActor,
  nodeId: Schema.NullOr(DagNodeId),
  // Node or DAG status for status entries; question status for answers.
  status: Schema.NullOr(TrimmedNonEmptyString),
  threadId: Schema.NullOr(ThreadId),
  questionId: Schema.NullOr(DagQuestionId),
  // Short free text: outcome summary, question prompt/answer, node title.
  detail: Schema.NullOr(TrimmedString),
});
export type DagTimelineEntry = typeof DagTimelineEntry.Type;

export const OrchestrationGetDagTimelineInput = Schema.Struct({
  dagId: DagId,
  // Absent = everything.
  afterSequence: Schema.optionalKey(NonNegativeInt),
  limit: Schema.optionalKey(NonNegativeInt),
});
export type OrchestrationGetDagTimelineInput = typeof OrchestrationGetDagTimelineInput.Type;

export const OrchestrationGetDagTimelineResult = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  entries: Schema.Array(DagTimelineEntry),
});
export type OrchestrationGetDagTimelineResult = typeof OrchestrationGetDagTimelineResult.Type;

export class OrchestrationGetDagError extends Schema.TaggedErrorClass<OrchestrationGetDagError>()(
  "OrchestrationGetDagError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

// ---------------------------------------------------------------------------
// Event fold (shared by server projectors and client reducers)
// ---------------------------------------------------------------------------

/**
 * Structural view of a DAG event: only `type` and `payload` matter to the fold,
 * so this stays free of the full `OrchestrationEvent` union (which lives in
 * orchestration.ts and imports this file).
 */
export type DagEvent =
  | { readonly type: "dag.created"; readonly payload: DagCreatedPayload }
  | { readonly type: "dag.meta-updated"; readonly payload: DagMetaUpdatedPayload }
  | { readonly type: "dag.status-set"; readonly payload: DagStatusSetPayload }
  | { readonly type: "dag.deleted"; readonly payload: DagDeletedPayload }
  | { readonly type: "dag.node-upserted"; readonly payload: DagNodeUpsertedPayload }
  | { readonly type: "dag.node-deleted"; readonly payload: DagNodeDeletedPayload }
  | { readonly type: "dag.edge-added"; readonly payload: DagEdgeAddedPayload }
  | { readonly type: "dag.edge-removed"; readonly payload: DagEdgeRemovedPayload }
  | { readonly type: "dag.node-status-set"; readonly payload: DagNodeStatusSetPayload }
  | { readonly type: "dag.question-asked"; readonly payload: DagQuestionAskedPayload }
  | { readonly type: "dag.question-answered"; readonly payload: DagQuestionAnsweredPayload };

const replaceGraph = (
  dags: ReadonlyArray<DagGraph>,
  dagId: DagGraph["dag"]["dagId"],
  update: (graph: DagGraph) => DagGraph,
): ReadonlyArray<DagGraph> => {
  const index = dags.findIndex((graph) => graph.dag.dagId === dagId);
  if (index === -1) return dags;
  const next = dags.slice();
  next[index] = update(dags[index]!);
  return next;
};

/**
 * Fold one orchestration event into a list of DAG graphs. Returns the next
 * list, or `undefined` when the event is not a DAG event (callers leave their
 * state untouched). Pure and total; shared by the server's in-memory
 * projector, the persisted `projection_dags` projector, and client reducers,
 * so the three can never disagree.
 */
export function foldDagEvent(
  dags: ReadonlyArray<DagGraph>,
  candidate: { readonly type: string; readonly payload: unknown },
): ReadonlyArray<DagGraph> | undefined {
  if (!isDagEventType(candidate.type)) return undefined;
  const event = candidate as DagEvent;
  switch (event.type) {
    case "dag.created": {
      const { payload } = event;
      if (dags.some((graph) => graph.dag.dagId === payload.dagId)) return dags;
      return [
        ...dags,
        {
          dag: {
            dagId: payload.dagId,
            title: payload.title,
            description: payload.description,
            primaryProjectId: payload.primaryProjectId,
            status: "draft",
            defaultModelSelection: payload.defaultModelSelection,
            pauseReason: null,
            createdAt: payload.createdAt,
            updatedAt: payload.createdAt,
          },
          nodes: [],
          edges: [],
          questions: [],
        },
      ];
    }
    case "dag.meta-updated": {
      const { payload } = event;
      return replaceGraph(dags, payload.dagId, (graph) => ({
        ...graph,
        dag: {
          ...graph.dag,
          ...(payload.title !== undefined ? { title: payload.title } : {}),
          ...(payload.description !== undefined ? { description: payload.description } : {}),
          ...(payload.primaryProjectId !== undefined
            ? { primaryProjectId: payload.primaryProjectId }
            : {}),
          ...(payload.defaultModelSelection !== undefined
            ? { defaultModelSelection: payload.defaultModelSelection }
            : {}),
          updatedAt: payload.updatedAt,
        },
      }));
    }
    case "dag.status-set": {
      const { payload } = event;
      return replaceGraph(dags, payload.dagId, (graph) => ({
        ...graph,
        dag: {
          ...graph.dag,
          status: payload.status,
          // The decider only carries a reason onto a pause; every other
          // transition clears it, so a resumed plan never shows a stale one.
          pauseReason: payload.status === "paused" ? (payload.reason ?? null) : null,
          updatedAt: payload.updatedAt,
        },
      }));
    }
    case "dag.deleted":
      return dags.filter((graph) => graph.dag.dagId !== event.payload.dagId);
    case "dag.node-upserted": {
      const { payload } = event;
      return replaceGraph(dags, payload.dagId, (graph) => {
        const nodeIndex = graph.nodes.findIndex((node) => node.nodeId === payload.node.nodeId);
        const nodes =
          nodeIndex === -1
            ? [...graph.nodes, payload.node]
            : graph.nodes.map((node, index) => (index === nodeIndex ? payload.node : node));
        const edges = [
          ...graph.edges,
          ...payload.addedEdges.filter(
            (added) =>
              !graph.edges.some(
                (edge) => edge.fromNodeId === added.fromNodeId && edge.toNodeId === added.toNodeId,
              ),
          ),
        ];
        return { ...graph, nodes, edges, dag: { ...graph.dag, updatedAt: payload.updatedAt } };
      });
    }
    case "dag.node-deleted": {
      const { payload } = event;
      return replaceGraph(dags, payload.dagId, (graph) => ({
        ...graph,
        nodes: graph.nodes.filter((node) => node.nodeId !== payload.nodeId),
        edges: graph.edges.filter(
          (edge) => edge.fromNodeId !== payload.nodeId && edge.toNodeId !== payload.nodeId,
        ),
        questions: graph.questions.filter((question) => question.nodeId !== payload.nodeId),
        dag: { ...graph.dag, updatedAt: payload.updatedAt },
      }));
    }
    case "dag.edge-added": {
      const { payload } = event;
      return replaceGraph(dags, payload.dagId, (graph) => {
        if (
          graph.edges.some(
            (edge) => edge.fromNodeId === payload.fromNodeId && edge.toNodeId === payload.toNodeId,
          )
        ) {
          return graph;
        }
        return {
          ...graph,
          edges: [
            ...graph.edges,
            { dagId: payload.dagId, fromNodeId: payload.fromNodeId, toNodeId: payload.toNodeId },
          ],
          dag: { ...graph.dag, updatedAt: payload.updatedAt },
        };
      });
    }
    case "dag.edge-removed": {
      const { payload } = event;
      return replaceGraph(dags, payload.dagId, (graph) => ({
        ...graph,
        edges: graph.edges.filter(
          (edge) => !(edge.fromNodeId === payload.fromNodeId && edge.toNodeId === payload.toNodeId),
        ),
        dag: { ...graph.dag, updatedAt: payload.updatedAt },
      }));
    }
    case "dag.node-status-set": {
      const { payload } = event;
      return replaceGraph(dags, payload.dagId, (graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.nodeId === payload.nodeId
            ? {
                ...node,
                status: payload.status,
                ...(payload.threadId !== undefined ? { threadId: payload.threadId } : {}),
                ...(payload.outcome !== undefined ? { outcome: payload.outcome } : {}),
                updatedAt: payload.updatedAt,
              }
            : node,
        ),
        dag: { ...graph.dag, updatedAt: payload.updatedAt },
      }));
    }
    case "dag.question-asked": {
      const { payload } = event;
      return replaceGraph(dags, payload.dagId, (graph) => ({
        ...graph,
        questions: graph.questions.some(
          (question) => question.questionId === payload.question.questionId,
        )
          ? graph.questions
          : [...graph.questions, payload.question],
        dag: { ...graph.dag, updatedAt: payload.updatedAt },
      }));
    }
    case "dag.question-answered": {
      const { payload } = event;
      return replaceGraph(dags, payload.dagId, (graph) => ({
        ...graph,
        questions: graph.questions.map((question) =>
          question.questionId === payload.questionId
            ? {
                ...question,
                status: payload.status,
                answer: payload.answer,
                answeredAt: payload.answeredAt,
              }
            : question,
        ),
        dag: { ...graph.dag, updatedAt: payload.updatedAt },
      }));
    }
    default: {
      event satisfies never;
      return undefined;
    }
  }
}
