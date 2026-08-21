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
- **pause reason** — why the _engine_ paused a plan (`Dag.pauseReason`). A
  user-initiated pause has none.

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
| RPC (`orchestration.listDags`, `subscribeDag`, `getDagTimeline`)      | `apps/server/src/ws.ts`; timeline mapping in `apps/server/src/dag/timeline.ts`                                                                             |
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

## Finished nodes are frozen

A node whose status is `done` or `skipped` has locked content. Its description
is the brief its executor worked from and its outcome summary is the record of
what happened, so `dag.node.upsert` and `dag.node.delete` against it are
rejected with an `OrchestrationCommandInvariantError` naming the node and the
unlock path. `failed` is deliberately not frozen: fixing a brief and retrying
is exactly what you want there. The frozen set is
`DAG_NODE_SATISFIED_STATUSES`, wrapped as `isDagNodeContentFrozen` in the DAG
decider.

Content-frozen, lifecycle-open. `dag.node.status.set` is unrestricted in every
direction — it is the unlock path (reopen to `pending`), the way to mark a node
`skipped`, and the way to re-report a summary on an already-`done` node. An
upsert that carries no content field at all (none of `title`, `description`,
`acceptance`, `projectId`, `parallelSafe`, `executionMode`, `dependsOn`,
`modelSelection`) is a no-op and stays legal rather than erroring.

Edges are deliberately excluded. `dag.edge.add` and `dag.edge.remove` remain
allowed even when an endpoint is finished, because topology is plan-level: the
user restructuring the remainder of a plan should not be blocked by which nodes
happen to have completed already. Only the finished node's own content is
history.

## Thread ↔ DAG link

Every thread shell and detail carries an optional `dagLink`
(`{ dagId, nodeId, role }`, `packages/contracts/src/dag.ts#ThreadDagLink`) so
clients can show "this thread belongs to DAG X" without a reverse lookup.
It is set one of two ways:

- **At creation** — `thread.create` accepts `dagLink`; the decider copies it
  into `thread.created`. Planner (`role: "planner"`, `nodeId: null`) and
  companion (`role: "companion"`) threads are tagged this way by the client's
  bootstrap, and the execution engine tags the threads it creates with
  `role: "executor"` and the node id.
- **Derived for executors** — a `dag.node-status-set` event that names a
  `threadId` is a node binding; both projectors (in-memory
  `orchestration/dag/projector.ts`, persisted `projection_threads.dag_link_json`
  in `ProjectionPipeline.ts`) set that thread's `dagLink` to
  `{ dagId, nodeId, role: "executor" }` when the thread exists. This covers a
  chat thread whose agent bound itself to a node with `dag_set_node_status`.

### How DAG threads are titled

`dagThreadTitle` (`packages/contracts/src/dag.ts`) is the one place the format
lives, and everything below reads it:

| role      | title                |
| --------- | -------------------- |
| executor  | the node's `title`   |
| planner   | `Planning — <plan>`  |
| companion | `Companion — <plan>` |

Executors are named after their node **alone**. Prefixing the plan title was
accurate and useless: the sidebar's plan group header and the chat header's
`Plan ▸` chip already say which plan this is, so a shared prefix only ate the
sidebar's width and truncated every executor row to the same string.

Auto-titling is suppressed for any thread carrying a `dagLink`. Both paths in
`orchestration/Layers/ProviderCommandReactor.ts` check it:

- the first-turn path — the client used to send a `titleSeed` equal to the
  title it had just chosen, and `canReplaceThreadTitle` reads
  `currentTitle === titleSeed` as "nobody named this", so the generator
  renamed planners and companions into near-duplicates of the plan
  (`"Senior KPI MCP Coverage"`, `"Expand Senior KPI MCP Coverage"`, …);
- `regenerateThreadTitle`, behind the sidebar's explicit **Regenerate title**.
  It returns a completion with no title rather than returning early, so the
  pending `titleRegeneration` state clears instead of spinning forever.

The client also stopped sending `titleSeed` for these threads
(`apps/web/src/components/dag/useDagThreadKickoff.ts`), but the server check is
the durable one: no client can talk a DAG thread out of its name.

Plans built by older builds are corrected in place. The engine's
`startup-reconcile` pass (`dag/Layers/DagExecutionEngine.ts`) walks every DAG,
groups the threads carrying its `dagLink` off the shell snapshot, and
dispatches `thread.meta.update { threadId, title }` for each thread whose
title is not the intended one — an ordinary command, no direct SQL.

The exemption is **user intent**. Before renaming, the engine reads that
thread's own stream (`OrchestrationEventStore.readByAggregate({ aggregateKind:
"thread", aggregateId })`) and looks for a `thread.meta-updated` carrying a
`title` whose `commandId` does not start with `server:`. Every rename the
server issues is prefixed (`server:thread-title-rename:…`,
`server:dag-thread-title-normalize:…`), so anything else came from a client —
that is the user naming their own thread, and it is left alone. A stream that
fails to read counts as renamed, so an unreadable thread never costs someone
their title. The read is skipped entirely when the title already matches, so
the common case is one shell snapshot and no per-thread work.

### When a companion turn replaces the provider session

`ensureSessionForThread` (`orchestration/Layers/ProviderCommandReactor.ts`)
reuses the thread's live provider session unless the runtime mode, cwd,
provider instance, or — for `claudeAgent` — the requested `ModelSelection`
changed. A change means a replacement session, which resumes: a fresh CLI
process, a re-handshake, and `claude.session.replacing` in the log.

That matters for the companion dock, because it creates the thread and sends
its kickoff brief in one `thread.turn.start` and the user's first message
follows seconds later. If those two turns carry different `ModelSelection`s,
the second one legitimately replaces the first session. Whoever sends the
kickoff should resolve the _same_ selection the composer will send, not the
environment default — the server has no way to tell an accidental difference
from a deliberate model switch, and must honour both identically.
`ProviderCommandReactor.test.ts` pins both directions: identical selections
reuse one session, a different model still replaces.

`orchestration.getDagTimeline` (`{ dagId, afterSequence?, limit? }`) returns
the DAG's run log: `OrchestrationEventStore.readByAggregate` reads the `dag`
stream and `dagTimelineEntriesFromEvents` flattens each event into a
`DagTimelineEntry` with an actor inferred from the command id prefix
(`mcp:` → agent, `server:dag-` → engine, other `server:`/`provider:` → server,
else user).

## Agent tool surface

Every provider session gets the `t3-code` MCP server with the `dag`
capability (browser `preview` tools stay behind the user's
`enableAgentBrowserAccess` setting). Tools: `dag_list`, `dag_get`,
`dag_create`, `dag_update`, `dag_upsert_node`, `dag_delete_node`,
`dag_add_edge`, `dag_remove_edge`, `dag_validate`, `dag_set_node_status`,
`dag_ask_user`, `dag_answer_question`, `dag_list_models`.

`dag_list_models` is read-only and takes no arguments. It flattens
`ProviderRegistry.getProviders` to
`{ instances: [{ instanceId, driverKind, displayName, models: string[] }] }`,
skipping disabled and unavailable instances since a node cannot run on one.
Its output is exactly the `instanceId`/`model` pairs `dag_upsert_node`'s
optional `modelSelection` accepts, so a planner can pin one node to a
cheaper (or bigger) model than the plan default without the user editing
anything.

A thread bound to a node (`DagNode.threadId`) may omit `dagId`/`nodeId`; the
handlers resolve them via `findDagNodeByThreadId`. Planner and companion
threads receive the `dagId` in their instructions.

`dag_ask_user` is non-blocking: it records the question, blocks the node, and
returns. The answer is delivered later as a follow-up turn on the asking
thread by the execution engine. This keeps the flow provider-agnostic and
survives MCP tool timeouts.

### One bad tool schema hides the whole toolkit

MCP requires every tool's `inputSchema` to be an object schema, and Claude Code
enforces it for the **server**, not the tool: one malformed entry and the CLI
registers `t3-code` as `connected` with an empty tool list. Nothing reports the
drop — not the CLI transcript, not our logs, not the agent, which simply
behaves as if `dag_*` never existed and (in the case that surfaced this) finishes
a node it can no longer mark done.

The trap is that `Schema.Struct({})` does not render as an empty object. Effect
emits `{"anyOf":[{"type":"object"},{"type":"array"}]}` for it, which is not a
valid `inputSchema`. A tool with no arguments must therefore **omit the
`parameters` key entirely** — that renders as
`{"type":"object","additionalProperties":false}`. `dag_list_models` shipped with
the empty struct and silently took all twenty-six `dag_*` and `preview_*` tools
down with it.

`toolkitRegistration.test.ts` now asserts every registered tool declares
`type: "object"`, which is the cheapest place to catch the next one.

### Credentials survive a restart

The bearer token that unlocks the toolkit is minted per provider session by
`apps/server/src/mcp/McpSessionRegistry.ts` and mirrored into the
`mcp_credentials` table (hash only, never the raw token), so a token that
outlives the process that issued it still resolves.

**Resumed sessions do inherit the MCP config we pass.** This was doubted enough
to be worth writing down: the Claude adapter puts the server in
`ClaudeQueryOptions.mcpServers`, the agent SDK turns that into a CLI-level
`--mcp-config <json>` argument, and `--resume` spawns a fresh CLI process that
reads it like any other. Verified against Claude Code 2.1.237 / agent SDK
0.3.170 by pointing a resumed session at an instrumented endpoint: it dialled
with the token from the _current_ start, not a stored one. So there is no need
for a `--mcp-config` file of our own, and an agent that has lost its tools after
a resume lost them somewhere else — check the tool schemas first (above), then
the endpoint, then the credential.

`--strict-mcp-config` must stay off: it would drop the user's own MCP servers.

Two rules keep the credential itself honest:

- Shutdown (`ProviderService.stopAll`, a layer finalizer) only drops the
  in-memory map. Explicit revocation — `stopSession`, or a session start whose
  capability set changed — still deletes the rows, so a thread that loses
  `preview` cannot keep a preview-capable token.
- The endpoint and token are re-read from the registry on every session start
  (`McpProviderSession.readMcpProviderSession`, logged as `claude.mcp.session`
  with the resolved endpoint), so a port or token change lands on the next
  start rather than stranding the session.

Credentials still expire after a day without a sign of life, and lapsed rows
are pruned when the registry loads.

## Execution model

Engine: `apps/server/src/dag/Layers/DagExecutionEngine.ts` (service tag in
`Services/DagExecutionEngine.ts`), started with the other reactors from
`OrchestrationReactor`. Strategies: `apps/server/src/dag/strategy.ts`. Prompts
for all three agent roles: `packages/shared/src/dagPrompts.ts`.

- The project DAG is _not_ compiled into a single provider workflow. One node
  ⇒ one thread (created by the engine in the node's project, titled after the
  node — see "How DAG threads are titled" — first turn =
  `buildDagNodeExecutionPrompt`). The engine
  reacts to `dag.status-set`, `dag.node-status-set`, `dag.question-answered`
  and `thread.session-set` and re-evaluates the frontier of the affected DAG.
- **v1 is strictly serial**: nothing launches while any node is `running` or
  `blocked`. `parallelSafe` is recorded and shown but not yet exploited;
  parallel execution in worktrees lands once the thread bootstrap program in
  `ws.ts` (create thread + prepare worktree + setup script) is extracted into a
  service the engine can call.
- Model resolution, in order: `node.modelSelection` (set by the user or by an
  agent via `dag_upsert_node`), then `dag.defaultModelSelection`, then the
  node's project's `defaultModelSelection`. If none resolves the engine pauses
  with `no-model`; if the resolved provider instance is not in the registry it
  pauses with `provider-unavailable`; if the node has neither its own
  `projectId` nor a plan `primaryProjectId` it pauses with `no-project`.
- Strategies shape the launch prompt only. `ClaudeWorkflowStrategy` applies
  to Claude instances when `executionMode === "workflow"` or (`auto` and the
  node reads as fan-out shaped) and tells the agent to use Workflow/ultracode
  inside the node; `TurnStrategy` is the fallback for every provider.
- Completion: the executor reports via `dag_set_node_status done` with a
  summary (fed into downstream prompts). If the thread's session settles
  (`idle/ready/interrupted/stopped`, after having been seen `running`) while
  the node is still `running` and the turn ran at least `RAPID_TURN_SETTLE_MS`
  (60s), the engine sends one nudge turn; a second silent settle marks the
  node `failed`. A session `error` after a full-length turn fails the node at
  once.
- Circuit breaker: a turn that settles in under `RAPID_TURN_SETTLE_MS` never
  did node work — the provider refused it (rate limit, subscription session
  cap, auth failure). Nudging would burn more quota, so the engine pauses the
  DAG (`provider-refused`) and leaves the node `running` with its thread
  bound. There is no retry/backoff machinery yet; classifying transient vs.
  persistent provider failures (and auto-resuming after a limit window) is
  future work.
- Resume: when a DAG is set back to `running`, before re-evaluating the
  frontier the engine sends a continuation turn (`buildDagResumeMessage`) on
  every still-`running` node whose bound thread has no live session. Resume
  strictly precedes `schedule`, so a parked node continues on its own thread
  instead of a fresh node launching beside it. This un-sticks circuit-breaker
  pauses, pauses that outlived a provider limit window, and plans paused by
  startup reconciliation.
- Auto-settle: once a node is `done`/`skipped` and its executor thread's
  session has settled, the engine dispatches `thread.settle` so the thread
  leaves the active list (either ordering: report-then-idle, or a late mark
  after the session already went idle).
- Startup reconciliation: `start()` queues one `startup-reconcile` pass over
  every DAG (drainable, so tests can wait on it). It does two things. First,
  the settle backstop: executor threads of already `done`/`skipped` nodes are
  settled, covering work finished while the server was down or before
  auto-settle existed. Second, dead-executor detection: a `running` node whose
  bound thread has no live session (thread gone, no session, or a settled one)
  is not executing anything, and the serial scheduler will never launch past
  it. If that plan is `running` the engine pauses it with `unresolved` and a
  message saying the executor session ended. The _node_ status is deliberately
  left alone — resuming then sends that same thread a continuation turn rather
  than restarting the work. At most one pause per plan, from the first stalled
  node.
- Questions: `dag_ask_user` blocks the node (decider). On
  `dag.question-answered` the decider unblocks the node when no other question
  on it is open, and the engine sends the answer as a new turn on the asking
  thread (`buildDagQuestionAnswerMessage`).
- DAG settlement: frontier empty and every node done/skipped → `completed`;
  any failed → `failed`; otherwise `paused` with `unresolved`. Retrying = set
  the node back to `pending` (clearing its thread) and the DAG to `running`.
- Pause reasons: every engine-initiated pause carries a `DagPauseReason`
  (`kind`, `nodeId`, `threadId`, `providerMessage`, `pausedAt`) so a client can
  say _why_ a plan stalled without anyone reading server logs. All of them go
  through the engine's `pauseDag` helper; the kinds and where they are set:

  | kind                   | set where                                                                                                                                            |
  | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `provider-refused`     | rapid-settle circuit breaker; `providerMessage` is the executor thread's last assistant message, trimmed to `PAUSE_PROVIDER_MESSAGE_MAX_CHARS` (400) |
  | `provider-unavailable` | `launchNode`, resolved `instanceId` not in the provider registry                                                                                     |
  | `no-model`             | `launchNode`, nothing resolvable from node/plan/project                                                                                              |
  | `no-project`           | `launchNode`, node has no project and the plan has no primary one                                                                                    |
  | `unresolved`           | `schedule` (nothing ready, plan not finished) and startup reconciliation (running node, dead executor)                                               |

  The reason rides `dag.status.set` → `dag.status-set` and is folded into
  `Dag.pauseReason` by `foldDagEvent`, so the in-memory model, `projection_dags`
  (whole-graph JSON) and client reducers all agree. The decider writes the
  reason only on a transition to `paused` and writes `null` on every other
  status, so a plan that runs again never shows a stale explanation. A pause
  the _user_ asked for therefore has `pauseReason: null`.

- Planner and companion threads are ordinary threads whose first user message
  is `buildDagPlannerBrief` / `buildDagCompanionBrief`, started by the client
  with the normal `thread.turn.start` + `bootstrap.createThread`; no adapter
  or server changes are involved.
- Every engine turn syncs the executor thread's own `modelSelection` to the
  model the turn runs on, so a per-node override is reflected in the thread's
  picker rather than leaving the UI contradicting what is executing.
