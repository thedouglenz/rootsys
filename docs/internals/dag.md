# Project DAGs (rootsys)

rootsys extends T3 Code with a **project DAG**: a long-lived plan for a
multi-turn (often multi-day) piece of work, rendered as a graph the user can
see and edit, built up-front by a multi-agent planner, and executed mostly
uninterrupted by an engine that hands nodes to provider threads.

This document is the architecture reference. User-facing behavior lives in
`docs/user/`.

## Vocabulary

- **DAG** — one plan. An `environment`-scoped aggregate (`aggregateKind: "dag"`),
  deliberately _not_ owned by a project so its nodes can span repos.
  `Dag.primaryProjectId` is where nodes run unless a node names its own
  `projectId`.
- **node** — one unit of work: `title`, `description`, `acceptance` (how the
  executor proves it is done), `parallelSafe`, `executionMode`, plus execution
  linkage: `status`, `threadId` (the T3 thread executing it), `outcome`.
- **edge** — `fromNodeId` must be satisfied before `toNodeId` may start.
- **ready** — derived, never stored: `pending` with every upstream node
  `done`/`skipped`. See `readyDagNodes` in `packages/contracts/src/dag.ts`.
- **question** — a human-blocking prompt raised mid-execution
  (`dag_ask_user`). It moves its node to `blocked`; other frontier nodes keep
  running; answering the last open question on a node returns it to `running`.
- **strategy** — how a node's work is dispatched to a provider (plain turn,
  or a Claude Code Workflow when the node is fan-out shaped).

Node status is one of `pending | running | blocked | done | failed | skipped`.
DAG status is `draft | ready | running | paused | completed | failed | archived`.

## Where code lives

| Concern                                                               | Path                                                                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts (entities, commands, event payloads, RPC I/O, pure helpers) | `packages/contracts/src/dag.ts`                                                                                                                            |
| Command/event unions, aggregate kind, `OrchestrationReadModel.dags`   | `packages/contracts/src/orchestration.ts`                                                                                                                  |
| Decider (commands → events, invariants incl. acyclicity)              | `apps/server/src/orchestration/dag/decider.ts`                                                                                                             |
| In-memory projector (`dags` slice)                                    | `apps/server/src/orchestration/dag/projector.ts`                                                                                                           |
| Persisted projection (`projection_dags`, whole-graph JSON per DAG)    | `apps/server/src/persistence/{Services,Layers}/ProjectionDags.ts`, `Migrations/041_ProjectionDags.ts`, `projection.dags` in `Layers/ProjectionPipeline.ts` |
| Reads (`getDagGraph`, `listDagShells`, `findDagNodeByThreadId`)       | `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`                                                                                          |
| RPC (`orchestration.listDags`, `orchestration.subscribeDag`)          | `apps/server/src/ws.ts`                                                                                                                                    |
| Agent tool surface (`dag_*` MCP toolkit)                              | `apps/server/src/mcp/toolkits/dag/`                                                                                                                        |
| Web canvas + companion editor                                         | `apps/web/src/components/dag/` (slice 4)                                                                                                                   |
| Execution engine + strategies                                         | `apps/server/src/dag/` (slice 5)                                                                                                                           |

Everything is additive to upstream T3 Code and confined to those paths (plus a
handful of union/registration touch points) so the fork can rebase.

## Event flow

DAG commands (`dag.create`, `dag.node.upsert`, `dag.edge.add`,
`dag.node.status.set`, `dag.question.ask`, …) go through the ordinary
`orchestration.dispatchCommand` path: `OrchestrationEngine` → `decideDagCommand`
→ `dag.*` events appended to `orchestration_events` → `projectDagEvent` for the
in-memory model and the same fold for `projection_dags`. Because the persisted
projection is one JSON graph per DAG produced by the same pure fold, it cannot
drift from the in-memory model.

Clients subscribe with `orchestration.subscribeDag` (snapshot, optional
catch-up by sequence, then raw `dag.*` events), mirroring `subscribeThread`.

## Agent tool surface

Every provider session gets the `t3-code` MCP server with the `dag`
capability (browser `preview` tools stay behind the user's
`enableAgentBrowserAccess` setting). Tools: `dag_list`, `dag_get`,
`dag_create`, `dag_update`, `dag_upsert_node`, `dag_delete_node`,
`dag_add_edge`, `dag_remove_edge`, `dag_validate`, `dag_set_node_status`,
`dag_ask_user`, `dag_answer_question`.

A thread bound to a node (`DagNode.threadId`) may omit `dagId`/`nodeId`; the
handlers resolve them via `findDagNodeByThreadId`. Planner and companion
threads receive the `dagId` in their instructions.

`dag_ask_user` is non-blocking: it records the question, blocks the node, and
returns. The answer is delivered later as a follow-up turn on the asking
thread by the execution engine. This keeps the flow provider-agnostic and
survives MCP tool timeouts.

## Execution model

Engine: `apps/server/src/dag/Layers/DagExecutionEngine.ts` (service tag in
`Services/DagExecutionEngine.ts`), started with the other reactors from
`OrchestrationReactor`. Strategies: `apps/server/src/dag/strategy.ts`. Prompts
for all three agent roles: `packages/shared/src/dagPrompts.ts`.

- The project DAG is _not_ compiled into a single provider workflow. One node
  ⇒ one thread (created by the engine in the node's project, title
  `"<dag>: <node>"`, first turn = `buildDagNodeExecutionPrompt`). The engine
  reacts to `dag.status-set`, `dag.node-status-set`, `dag.question-answered`
  and `thread.session-set` and re-evaluates the frontier of the affected DAG.
- **v1 is strictly serial**: nothing launches while any node is `running` or
  `blocked`. `parallelSafe` is recorded and shown but not yet exploited;
  parallel execution in worktrees lands once the thread bootstrap program in
  `ws.ts` (create thread + prepare worktree + setup script) is extracted into a
  service the engine can call.
- Model resolution: `node.modelSelection ?? dag.defaultModelSelection ??
project.defaultModelSelection`. If none resolves (or the provider instance is
  missing), the engine pauses the DAG and logs why.
- Strategies shape the launch prompt only. `ClaudeWorkflowStrategy` applies
  to Claude instances when `executionMode === "workflow"` or (`auto` and the
  node reads as fan-out shaped) and tells the agent to use Workflow/ultracode
  inside the node; `TurnStrategy` is the fallback for every provider.
- Completion: the executor reports via `dag_set_node_status done` with a
  summary (fed into downstream prompts). If the thread's session settles
  (`idle/ready/interrupted/stopped`, after having been seen `running`) while the
  node is still `running`, the engine sends one nudge turn; a second silent
  settle marks the node `failed`. A session `error` fails the node at once.
- Questions: `dag_ask_user` blocks the node (decider). On
  `dag.question-answered` the decider unblocks the node when no other question
  on it is open, and the engine sends the answer as a new turn on the asking
  thread (`buildDagQuestionAnswerMessage`).
- DAG settlement: frontier empty and every node done/skipped → `completed`;
  any failed → `failed`; otherwise `paused` with a warning. Retrying = set the
  node back to `pending` (clearing its thread) and the DAG to `running`.
- Planner and companion threads are ordinary threads whose first user message
  is `buildDagPlannerBrief` / `buildDagCompanionBrief`, started by the client
  with the normal `thread.turn.start` + `bootstrap.createThread`; no adapter
  or server changes are involved.
