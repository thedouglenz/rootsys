import { DagId, DagNodeId, type DagGraph, type DagNode } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mintNodeId, validateDagGraph } from "./handlers.ts";

const dagId = DagId.make("dag-1");
const node = (id: string, overrides: Partial<DagNode> = {}): DagNode => ({
  nodeId: DagNodeId.make(id),
  dagId,
  projectId: null,
  title: id,
  description: "does a thing",
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
const graph = (nodes: DagNode[], edges: Array<[string, string]>): DagGraph => ({
  dag: {
    dagId,
    title: "t",
    description: "",
    primaryProjectId: null,
    status: "draft",
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  nodes,
  edges: edges.map(([from, to]) => ({
    dagId,
    fromNodeId: DagNodeId.make(from),
    toNodeId: DagNodeId.make(to),
  })),
  questions: [],
});

describe("dag toolkit helpers", () => {
  it("mintNodeId slugs the title and appends the suffix", () => {
    expect(mintNodeId("Add OAuth login (Clerk)!", "ab12cd")).toBe("add-oauth-login-clerk-ab12cd");
    expect(mintNodeId("!!!", "x")).toBe("node-x");
    expect(mintNodeId("a".repeat(80), "s").length).toBeLessThanOrEqual(42);
  });

  it("validateDagGraph flags empty graphs as errors", () => {
    const result = validateDagGraph(graph([], []));
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toMatch(/no nodes/);
  });

  it("validateDagGraph warns on missing description/acceptance and disconnected clusters", () => {
    const result = validateDagGraph(
      graph(
        [node("a", { description: "" }), node("b", { acceptance: null }), node("c")],
        [["a", "b"]],
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => [i.severity, i.nodeId, i.message.split(";")[0]])).toEqual([
      ["warning", "a", "Node has no description."],
      ["warning", "b", "Node has no acceptance criteria"],
      ["warning", null, "DAG has 2 disconnected clusters"],
    ]);
    expect(result.topologicalOrder).toEqual(["a", "c", "b"]);
  });

  it("validateDagGraph passes a well-formed connected graph", () => {
    const result = validateDagGraph(graph([node("a"), node("b")], [["a", "b"]]));
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
