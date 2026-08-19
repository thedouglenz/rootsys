import { DagId, DagNodeId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { dagLinkChipLabel, dagProgress, topologicalDagNodes } from "./dagThreadLink";

const dagId = DagId.make("dag-1");

function node(id: string, status: "pending" | "done" | "skipped" = "pending") {
  return {
    nodeId: DagNodeId.make(id),
    dagId,
    projectId: null,
    title: id,
    description: "",
    acceptance: null,
    parallelSafe: false,
    executionMode: "auto" as const,
    modelSelection: null,
    status,
    threadId: null,
    outcome: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const edge = (from: string, to: string) => ({
  dagId,
  fromNodeId: DagNodeId.make(from),
  toNodeId: DagNodeId.make(to),
});

describe("topologicalDagNodes", () => {
  it("orders dependencies before dependents and keeps graph order for ties", () => {
    const ordered = topologicalDagNodes({
      nodes: [node("c"), node("a"), node("b"), node("d")],
      edges: [edge("a", "c"), edge("b", "c"), edge("c", "d")],
    });
    expect(ordered.map((entry) => entry.nodeId)).toEqual(["a", "b", "c", "d"]);
  });

  it("appends cycle members instead of dropping them", () => {
    const ordered = topologicalDagNodes({
      nodes: [node("x"), node("y"), node("z")],
      edges: [edge("x", "y"), edge("y", "x")],
    });
    expect(ordered.map((entry) => entry.nodeId)).toEqual(["z", "x", "y"]);
  });

  it("ignores edges that reference unknown nodes", () => {
    const ordered = topologicalDagNodes({
      nodes: [node("a")],
      edges: [edge("ghost", "a")],
    });
    expect(ordered.map((entry) => entry.nodeId)).toEqual(["a"]);
  });
});

describe("dagLinkChipLabel", () => {
  it("names the role or the node", () => {
    expect(dagLinkChipLabel({ dagId, nodeId: null, role: "planner" }, null)).toBe("Plan ▸ planner");
    expect(dagLinkChipLabel({ dagId, nodeId: null, role: "companion" }, null)).toBe(
      "Plan ▸ companion",
    );
    const executor = { dagId, nodeId: DagNodeId.make("n"), role: "executor" as const };
    expect(dagLinkChipLabel(executor, null)).toBe("Plan ▸ node");
    expect(dagLinkChipLabel(executor, "Write tests")).toBe("Plan ▸ Write tests");
  });
});

describe("dagProgress", () => {
  it("counts done and skipped nodes against the total", () => {
    expect(dagProgress({ nodes: [node("a", "done"), node("b", "skipped"), node("c")] })).toEqual({
      done: 2,
      total: 3,
    });
  });
});
