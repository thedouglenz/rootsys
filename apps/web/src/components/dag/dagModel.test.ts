import {
  DagId,
  DagNodeId,
  type DagGraph,
  type DagNode,
  type ModelSelection,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  dagBulkModelTargets,
  dagStructureKey,
  describeDagNodeModelSource,
  isSameModelSelection,
  mintDagNodeId,
  resolveDagNodeModel,
} from "./dagModel";

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

function selection(instanceId: string, model: string): ModelSelection {
  return { instanceId: ProviderInstanceId.make(instanceId), model };
}

const nodeModel = selection("claude", "opus");
const planModel = selection("claude", "sonnet");
const projectModel = selection("codex", "gpt");

describe("resolveDagNodeModel", () => {
  it("prefers the node, then the plan, then the project", () => {
    expect(
      resolveDagNodeModel({
        nodeModelSelection: nodeModel,
        dagDefaultModelSelection: planModel,
        projectDefaultModelSelection: projectModel,
      }),
    ).toEqual({ source: "node", selection: nodeModel, inherited: planModel });
    expect(
      resolveDagNodeModel({
        nodeModelSelection: null,
        dagDefaultModelSelection: planModel,
        projectDefaultModelSelection: projectModel,
      }),
    ).toEqual({ source: "plan", selection: planModel, inherited: planModel });
    expect(
      resolveDagNodeModel({
        nodeModelSelection: null,
        dagDefaultModelSelection: null,
        projectDefaultModelSelection: projectModel,
      }),
    ).toEqual({ source: "project", selection: projectModel, inherited: projectModel });
  });

  it("reports nothing to run with when no level sets a model", () => {
    const resolved = resolveDagNodeModel({
      nodeModelSelection: null,
      dagDefaultModelSelection: null,
      projectDefaultModelSelection: null,
    });
    expect(resolved).toEqual({ source: "none", selection: null, inherited: null });
    expect(describeDagNodeModelSource(resolved.source)).toContain("No model");
  });
});

describe("isSameModelSelection", () => {
  it("compares instance, model, and options", () => {
    expect(isSameModelSelection(nodeModel, selection("claude", "opus"))).toBe(true);
    expect(isSameModelSelection(nodeModel, planModel)).toBe(false);
    expect(isSameModelSelection(null, null)).toBe(true);
    expect(isSameModelSelection(null, nodeModel)).toBe(false);
    expect(
      isSameModelSelection(nodeModel, {
        ...nodeModel,
        options: [{ id: "effort", value: "high" }],
      }),
    ).toBe(false);
  });
});

describe("dagBulkModelTargets", () => {
  it("takes pending nodes that would actually change", () => {
    const targets = dagBulkModelTargets(
      {
        nodes: [
          node("a"),
          { ...node("b"), modelSelection: nodeModel },
          { ...node("c"), modelSelection: planModel },
          node("d", "running"),
          node("e", "done"),
        ],
      },
      nodeModel,
    );
    expect(targets).toEqual([DagNodeId.make("a"), DagNodeId.make("c")]);
  });
});
