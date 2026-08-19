import {
  DagId,
  DagNodeId,
  ProviderDriverKind,
  type DagGraph,
  type DagNode,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  ClaudeWorkflowStrategy,
  DEFAULT_DAG_EXECUTION_STRATEGIES,
  looksFanOutShaped,
  resolveDagExecutionStrategy,
  TurnStrategy,
} from "./strategy.ts";

const dagId = DagId.make("dag-1");
const node = (overrides: Partial<DagNode>): DagNode => ({
  nodeId: DagNodeId.make("n"),
  dagId,
  projectId: null,
  title: "Add login",
  description: "Build the form",
  acceptance: "tests pass",
  parallelSafe: false,
  executionMode: "auto",
  modelSelection: null,
  status: "pending",
  threadId: null,
  outcome: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});
const graph = (n: DagNode): DagGraph => ({
  dag: {
    dagId,
    title: "Plan",
    description: "",
    primaryProjectId: null,
    status: "running",
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  nodes: [n],
  edges: [],
  questions: [],
});
const claude = ProviderDriverKind.make("claude");
const codex = ProviderDriverKind.make("codex");

describe("dag execution strategies", () => {
  it("detects fan-out wording", () => {
    expect(
      looksFanOutShaped({ title: "Audit every module for unused exports", description: "" }),
    ).toBe(true);
    expect(looksFanOutShaped({ title: "Add login", description: "one form" })).toBe(false);
  });

  it("picks the Claude workflow strategy only for Claude and fan-out/workflow nodes", () => {
    const plain = node({});
    const explicit = node({ executionMode: "workflow" });
    const fanOut = node({ title: "Sweep across the codebase for TODOs" });
    const pick = (n: DagNode, driverKind: ProviderDriverKind) =>
      resolveDagExecutionStrategy(DEFAULT_DAG_EXECUTION_STRATEGIES, {
        graph: graph(n),
        node: n,
        driverKind,
      }).id;
    expect(pick(plain, claude)).toBe(TurnStrategy.id);
    expect(pick(explicit, claude)).toBe(ClaudeWorkflowStrategy.id);
    expect(pick(fanOut, claude)).toBe(ClaudeWorkflowStrategy.id);
    expect(pick(explicit, codex)).toBe(TurnStrategy.id);
    expect(pick(node({ executionMode: "turn", title: "Audit every module" }), claude)).toBe(
      TurnStrategy.id,
    );
  });

  it("workflow launches mention workflows; turn launches do not", () => {
    const n = node({ executionMode: "workflow" });
    const input = { graph: graph(n), node: n, driverKind: claude };
    expect(ClaudeWorkflowStrategy.buildLaunch(input).prompt).toMatch(/multi-agent workflows/);
    expect(TurnStrategy.buildLaunch(input).prompt).not.toMatch(/multi-agent workflows/);
    expect(TurnStrategy.buildLaunch(input).prompt).toContain("dag_set_node_status");
  });
});
