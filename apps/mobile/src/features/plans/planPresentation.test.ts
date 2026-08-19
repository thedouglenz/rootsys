import { DagId, DagNodeId, type DagGraph, type DagNode } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { dagNodeSummaryLine, orderedDagNodeViews } from "./planPresentation";

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

describe("orderedDagNodeViews", () => {
  it("lists upstream nodes before downstream ones and derives ready", () => {
    const views = orderedDagNodeViews(
      graph({
        nodes: [node("c"), node("b"), node("a", "done")],
        edges: [
          { dagId, fromNodeId: DagNodeId.make("a"), toNodeId: DagNodeId.make("b") },
          { dagId, fromNodeId: DagNodeId.make("b"), toNodeId: DagNodeId.make("c") },
        ],
      }),
    );
    expect(views.map((view) => view.node.nodeId)).toEqual(["a", "b", "c"]);
    expect(views.map((view) => view.displayStatus)).toEqual(["done", "ready", "pending"]);
  });

  it("falls back to stored order when the graph has a cycle", () => {
    const views = orderedDagNodeViews(
      graph({
        nodes: [node("b"), node("a")],
        edges: [
          { dagId, fromNodeId: DagNodeId.make("a"), toNodeId: DagNodeId.make("b") },
          { dagId, fromNodeId: DagNodeId.make("b"), toNodeId: DagNodeId.make("a") },
        ],
      }),
    );
    expect(views.map((view) => view.node.nodeId)).toEqual(["b", "a"]);
  });
});

describe("dagNodeSummaryLine", () => {
  it("prefers the outcome summary over the description", () => {
    const base = { displayStatus: "done" as const, openQuestionCount: 0 };
    expect(
      dagNodeSummaryLine({
        ...base,
        node: {
          ...node("a", "done"),
          description: "desc",
          outcome: { summary: "did it", threadId: null, completedAt: NOW },
        },
      }),
    ).toBe("did it");
    expect(dagNodeSummaryLine({ ...base, node: { ...node("a"), description: "desc" } })).toBe(
      "desc",
    );
    expect(dagNodeSummaryLine({ ...base, node: node("a") })).toBeNull();
  });
});
