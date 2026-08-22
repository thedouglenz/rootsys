/**
 * Prompt builders for the three DAG agent roles (trellis). Shared so the
 * server (executor turns) and clients (planner / companion kick-off) produce
 * one consistent vocabulary for the `dag_*` MCP tools.
 *
 * These are plain strings sent as the first user message of a thread; no
 * provider adapter changes are needed, which keeps every provider supported.
 */
import type { DagGraph, DagNode } from "@t3tools/contracts";

const TOOL_PRIMER = `You have MCP tools named dag_* (dag_get, dag_create, dag_update, dag_upsert_node, dag_delete_node, dag_add_edge, dag_remove_edge, dag_validate, dag_set_node_status, dag_ask_user, dag_answer_question, dag_list). They operate on the project DAG: a plan made of nodes (title, description, acceptance criteria, dependencies) that will be executed node by node by coding agents, mostly without a human watching.`;

export interface PlannerBriefInput {
  readonly dagId: string;
  readonly goal: string;
  readonly projectTitle?: string | undefined;
  /** True when the provider supports a fan-out workflow tool (Claude Code's Workflow / ultracode). */
  readonly supportsWorkflows?: boolean | undefined;
}

/** First message for a planner thread: build a thorough DAG for `goal`. */
export function buildDagPlannerBrief(input: PlannerBriefInput): string {
  const workflowHint = input.supportsWorkflows
    ? `\nThis provider supports multi-agent workflows. Use them for the exploration phase: fan out parallel read-only explorers over distinct areas of the codebase (architecture, tests, build/CI, the areas the goal touches), then synthesize. Use a critic pass to attack your draft plan for missing steps, wrong ordering, and untestable acceptance criteria before finalizing.`
    : `\nExplore the codebase thoroughly before drafting: architecture, tests, build/CI, and every area the goal touches.`;
  return `You are the PLANNER for a long-running project in ${input.projectTitle ? `the project "${input.projectTitle}"` : "this repository"}.

GOAL
${input.goal}

${TOOL_PRIMER}

The DAG you are filling in has id ${input.dagId} (already created, currently empty and in draft status). Build it with dag_upsert_node / dag_add_edge, always passing dagId=${input.dagId}.
${workflowHint}

PLANNING RULES
- Plan up front and in depth; execution should rarely need to ask a human. Resolve questions now by reading code, or by asking the user in this conversation before you finalize.
- Each node is one coherent unit of work that a single coding agent can finish in one focused session (roughly 20 minutes to a few hours), leaving the repo in a working state. Split anything bigger.
- Every node needs: a crisp title; a description that says what to change and where (files, modules, commands), including decisions already made so the executor does not re-decide; and concrete acceptance criteria the executor can verify itself (tests to run, commands that must pass, behavior to demonstrate).
- Dependencies must be real ordering constraints, not preferences. Mark a node parallelSafe=true only if it touches files no other simultaneously-runnable node touches.
- Put verification/integration nodes where they belong (e.g. "run full test suite and fix regressions" after a cluster).
- Include a final node that reviews the whole result against the goal.
- Aim for completeness over brevity: typically 6–30 nodes depending on scope.

FINISH
1. Run dag_validate and fix every error and warning.
2. Summarize the plan to the user in a short readable list (node titles in execution order) and ask if they want changes.
3. Only when the user agrees (or if they asked you not to wait), call dag_update with status="ready". Do not start executing nodes yourself.`;
}

export interface CompanionBriefInput {
  readonly dagId: string;
  readonly dagTitle: string;
}

/** First message for a lightweight companion/editor thread bound to one DAG. */
export function buildDagCompanionBrief(input: CompanionBriefInput): string {
  return `You are the COMPANION EDITOR for the project DAG "${input.dagTitle}" (dagId=${input.dagId}).

${TOOL_PRIMER}

Your job: help the user inspect and edit this DAG quickly. Always start by calling dag_get with dagId=${input.dagId} so you see the current graph. Apply the user's edits with dag_upsert_node / dag_delete_node / dag_add_edge / dag_remove_edge / dag_update (always pass dagId=${input.dagId}), keep node descriptions and acceptance criteria concrete, never create cycles, and run dag_validate after structural changes. If the user answers an open question for a node, record it with dag_answer_question. Do not execute node work yourself and do not modify files in the repository. Reply tersely: what you changed, in one or two lines.`;
}

export interface ExecutorPromptInput {
  readonly graph: DagGraph;
  readonly node: DagNode;
  /** True when the provider supports a fan-out workflow tool and the node is fan-out shaped. */
  readonly useWorkflow?: boolean | undefined;
}

const upstreamOf = (graph: DagGraph, nodeId: DagNode["nodeId"]) =>
  graph.edges
    .filter((edge) => edge.toNodeId === nodeId)
    .map((edge) => graph.nodes.find((node) => node.nodeId === edge.fromNodeId))
    .filter((node): node is DagNode => node !== undefined);

/** First message for an executor thread assigned to one node. */
export function buildDagNodeExecutionPrompt(input: ExecutorPromptInput): string {
  const { graph, node } = input;
  const upstream = upstreamOf(graph, node.nodeId);
  const upstreamSection =
    upstream.length === 0
      ? "This node has no upstream dependencies."
      : upstream
          .map(
            (dep) =>
              `- ${dep.title} [${dep.status}]${dep.outcome?.summary ? `: ${dep.outcome.summary}` : ""}`,
          )
          .join("\n");
  const siblings = graph.nodes
    .filter((candidate) => candidate.nodeId !== node.nodeId)
    .map((candidate) => `- ${candidate.title} [${candidate.status}]`)
    .join("\n");
  const workflowHint = input.useWorkflow
    ? `\nThis node is fan-out shaped and this provider supports multi-agent workflows: use them (parallel sub-agents, then verify) rather than doing everything serially.`
    : "";
  return `You are executing ONE node of the project DAG "${graph.dag.title}" (dagId=${graph.dag.dagId}).
${graph.dag.description ? `\nPROJECT CONTEXT\n${graph.dag.description}\n` : ""}
YOUR NODE — ${node.title} (nodeId=${node.nodeId})
${node.description || "(no description)"}

ACCEPTANCE CRITERIA
${node.acceptance ?? "(none given — use your judgement and state what you verified)"}

UPSTREAM RESULTS (already done; build on them, do not redo them)
${upstreamSection}

OTHER NODES IN THIS PLAN (for orientation only — do NOT do their work)
${siblings || "(none)"}

${TOOL_PRIMER}
${workflowHint}

PROTOCOL
1. First call dag_set_node_status with status="running" (dagId=${graph.dag.dagId}, nodeId=${node.nodeId}). This binds this thread to the node; afterwards you may omit the ids.
2. Do the work in the repository. Verify the acceptance criteria yourself (run the tests/commands).
3. If you hit a decision only the human can make, call dag_ask_user with a precise question (and options when discrete), then END YOUR TURN. The answer will arrive as your next message; continue from there.
4. When the acceptance criteria are met, call dag_set_node_status with status="done" and a concise summary (2–6 lines: what changed, where, anything the next nodes must know). If you cannot finish, call it with status="failed" and explain why.
Keep the repository in a working state when you finish. Do not start other nodes.`;
}

/** Follow-up message delivered to an executor thread when its question is answered. */
export function buildDagQuestionAnswerMessage(input: {
  readonly prompt: string;
  readonly answer: string | null;
}): string {
  return input.answer === null
    ? `Your question was dismissed without an answer: "${input.prompt}". Use your best judgement, state the assumption you made, and continue the node.`
    : `Answer to your question "${input.prompt}":\n\n${input.answer}\n\nContinue the node. Remember to call dag_set_node_status when you finish.`;
}

/** Continuation message for a still-running node when a paused DAG resumes. */
export function buildDagResumeMessage(): string {
  return `Execution has resumed. Continue this node from where you left off — re-read your earlier progress above if needed, verify the acceptance criteria, and report with dag_set_node_status when finished (or dag_ask_user if blocked).`;
}

/** Follow-up nudge when an executor turn settled without a status report. */
export function buildDagNudgeMessage(): string {
  return `Your previous turn ended without reporting the node's status. If the work is complete and verified, call dag_set_node_status with status="done" and a summary now. If you are blocked on the human, call dag_ask_user. Otherwise continue the work and report when finished.`;
}
