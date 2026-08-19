import { DagId, DagNodeId, type DagGraph, type DagNode } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { dagStructureKey, mintDagNodeId } from "./dagModel";

const dagId = DagId.make("dag-1");
const NOW = "2026-01-01T00:00:00.000Z";

function node(id: string, status: DagNode["status"] = "pending"): DagNode {
  return {
    nodeId: DagNodeId.make(id),
    dagId,
    projectId: null,
    title: id,
    description: "",
    acceptance: null,
    parallelSafe: false,
    executionMode: "auto",
    modelSelection: null,
    status,
    threadId: null,
    outcome: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function graph(partial: Partial<DagGraph> = {}): DagGraph {
  return {
    dag: {
      dagId,
      title: "Plan",
      description: "",
      primaryProjectId: null,
      status: "draft",
      defaultModelSelection: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    nodes: [],
    edges: [],
    questions: [],
    ...partial,
  };
}

describe("dagStructureKey", () => {
  it("ignores ordering and non-structural fields", () => {
    const a = graph({
      nodes: [node("a"), node("b")],
      edges: [{ dagId, fromNodeId: DagNodeId.make("a"), toNodeId: DagNodeId.make("b") }],
    });
    const b = graph({
      nodes: [node("b", "done"), { ...node("a"), title: "renamed" }],
      edges: [{ dagId, fromNodeId: DagNodeId.make("a"), toNodeId: DagNodeId.make("b") }],
    });
    expect(dagStructureKey(a)).toBe(dagStructureKey(b));
    expect(dagStructureKey(a)).not.toBe(dagStructureKey(graph({ nodes: [node("a")] })));
  });
});

describe("mintDagNodeId", () => {
  it("slugs the title and appends a deterministic suffix for a fixed random source", () => {
    expect(mintDagNodeId("Add login page!", () => 0)).toBe("add-login-page-aaaaaa");
    expect(mintDagNodeId("   ", () => 0.5)).toBe("node-ssssss");
  });
});
