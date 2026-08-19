import { describe, expect, it } from "vite-plus/test";

import { DagId, DagNodeId } from "./baseSchemas.ts";
import {
  dagEdgeWouldCreateCycle,
  readyDagNodes,
  topologicalDagOrder,
  type DagEdge,
  type DagNode,
} from "./dag.ts";

const dagId = DagId.make("dag-1");
const id = (n: string) => DagNodeId.make(n);

function node(nodeId: string, status: DagNode["status"] = "pending"): DagNode {
  return {
    nodeId: id(nodeId),
    dagId,
    projectId: null,
    title: nodeId,
    description: "",
    acceptance: null,
    parallelSafe: false,
    executionMode: "auto",
    modelSelection: null,
    status,
    threadId: null,
    outcome: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
const edge = (from: string, to: string): DagEdge => ({
  dagId,
  fromNodeId: id(from),
  toNodeId: id(to),
});

describe("dag helpers", () => {
  it("readyDagNodes returns roots and nodes whose deps are satisfied", () => {
    const nodes = [node("a", "done"), node("b"), node("c"), node("d", "skipped"), node("e")];
    const edges = [edge("a", "b"), edge("b", "c"), edge("d", "e")];
    expect(readyDagNodes({ nodes, edges }).map((n) => n.nodeId)).toEqual([id("b"), id("e")]);
  });

  it("readyDagNodes excludes non-pending nodes even when deps are satisfied", () => {
    const nodes = [node("a", "done"), node("b", "running"), node("c", "blocked")];
    expect(readyDagNodes({ nodes, edges: [edge("a", "b"), edge("a", "c")] })).toEqual([]);
  });

  it("dagEdgeWouldCreateCycle detects self, direct and transitive cycles", () => {
    const edges = [edge("a", "b"), edge("b", "c")];
    expect(dagEdgeWouldCreateCycle(edges, id("a"), id("a"))).toBe(true);
    expect(dagEdgeWouldCreateCycle(edges, id("b"), id("a"))).toBe(true);
    expect(dagEdgeWouldCreateCycle(edges, id("c"), id("a"))).toBe(true);
    expect(dagEdgeWouldCreateCycle(edges, id("a"), id("c"))).toBe(false);
    expect(dagEdgeWouldCreateCycle(edges, id("c"), id("d"))).toBe(false);
  });

  it("topologicalDagOrder respects dependencies and reports cycles", () => {
    const nodes = [node("c"), node("a"), node("b")];
    const order = topologicalDagOrder({ nodes, edges: [edge("a", "b"), edge("b", "c")] });
    expect(order).toEqual([id("a"), id("b"), id("c")]);
    expect(topologicalDagOrder({ nodes, edges: [edge("a", "b"), edge("b", "a")] })).toBeNull();
  });
});
