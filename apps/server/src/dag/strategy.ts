/**
 * Execution strategies (trellis): how one DAG node's work is handed to a
 * provider thread. The engine picks the first strategy whose `matches`
 * returns true; strategies only shape the launch (prompt, interaction mode) —
 * the engine owns thread lifecycle and status bookkeeping.
 */
import type {
  DagGraph,
  DagNode,
  ProviderDriverKind,
  ProviderInteractionMode,
} from "@t3tools/contracts";
import { buildDagNodeExecutionPrompt } from "@t3tools/shared/dagPrompts";

export interface DagExecutionLaunch {
  readonly prompt: string;
  readonly interactionMode: ProviderInteractionMode;
}

export interface DagExecutionStrategyInput {
  readonly graph: DagGraph;
  readonly node: DagNode;
  readonly driverKind: ProviderDriverKind;
}

export interface DagExecutionStrategy {
  readonly id: string;
  readonly matches: (input: DagExecutionStrategyInput) => boolean;
  readonly buildLaunch: (input: DagExecutionStrategyInput) => DagExecutionLaunch;
}

/** Drivers whose harness offers a fan-out workflow tool (Claude Code's Workflow / ultracode). */
const WORKFLOW_CAPABLE_DRIVERS: ReadonlySet<string> = new Set(["claude"]);

/**
 * Claude Code nodes that are explicitly (or, under `auto`, heuristically)
 * fan-out shaped run as a Workflow inside the node's turn.
 */
export const ClaudeWorkflowStrategy: DagExecutionStrategy = {
  id: "claude-workflow",
  matches: ({ node, driverKind }) =>
    WORKFLOW_CAPABLE_DRIVERS.has(driverKind) &&
    (node.executionMode === "workflow" ||
      (node.executionMode === "auto" && looksFanOutShaped(node))),
  buildLaunch: ({ graph, node }) => ({
    prompt: buildDagNodeExecutionPrompt({ graph, node, useWorkflow: true }),
    interactionMode: "default",
  }),
};

/** Provider-agnostic fallback: one plain agent turn per node. */
export const TurnStrategy: DagExecutionStrategy = {
  id: "turn",
  matches: () => true,
  buildLaunch: ({ graph, node }) => ({
    prompt: buildDagNodeExecutionPrompt({ graph, node, useWorkflow: false }),
    interactionMode: "default",
  }),
};

export const DEFAULT_DAG_EXECUTION_STRATEGIES: ReadonlyArray<DagExecutionStrategy> = [
  ClaudeWorkflowStrategy,
  TurnStrategy,
];

export function resolveDagExecutionStrategy(
  strategies: ReadonlyArray<DagExecutionStrategy>,
  input: DagExecutionStrategyInput,
): DagExecutionStrategy {
  return strategies.find((strategy) => strategy.matches(input)) ?? TurnStrategy;
}

const FAN_OUT_HINTS =
  /\b(audit|sweep|migrate (all|every)|across (the|all) (codebase|repo|modules|packages)|every (file|module|package|component)|review (the )?(whole|entire)|parallel)\b/i;

/** Cheap heuristic for `auto`: wording that implies many independent sub-tasks. */
export function looksFanOutShaped(node: Pick<DagNode, "title" | "description">): boolean {
  return FAN_OUT_HINTS.test(`${node.title}\n${node.description}`);
}
