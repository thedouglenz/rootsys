import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { DagId, DagNodeId, type DagGraph, type ThreadDagLink } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { linkedPlanThreads, threadPlanChipLabel } from "./threadPlanLink";

const dagId = DagId.make("dag-1");
const otherDagId = DagId.make("dag-2");
const nodeA = DagNodeId.make("node-a");

const graph = {
  nodes: [{ nodeId: nodeA, title: "Write migration" }],
} as unknown as DagGraph;

function shell(
  id: string,
  dagLink: ThreadDagLink | null,
  extra: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell {
  return {
    id,
    title: id,
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    dagLink,
    ...extra,
  } as unknown as EnvironmentThreadShell;
}

describe("threadPlanChipLabel", () => {
  it("names the executor node when the graph has it", () => {
    expect(threadPlanChipLabel({ dagId, nodeId: nodeA, role: "executor" }, graph)).toBe(
      "Plan · Write migration",
    );
  });

  it("falls back to 'node' while the graph is missing or the node is gone", () => {
    expect(threadPlanChipLabel({ dagId, nodeId: nodeA, role: "executor" }, null)).toBe(
      "Plan · node",
    );
    expect(
      threadPlanChipLabel({ dagId, nodeId: DagNodeId.make("gone"), role: "executor" }, graph),
    ).toBe("Plan · node");
  });

  it("labels planner and companion threads by role", () => {
    expect(threadPlanChipLabel({ dagId, nodeId: null, role: "planner" }, graph)).toBe(
      "Plan · planner",
    );
    expect(threadPlanChipLabel({ dagId, nodeId: null, role: "companion" }, null)).toBe(
      "Plan · companion",
    );
  });
});

describe("linkedPlanThreads", () => {
  it("keeps only live threads linked to the plan, planners first, newest first", () => {
    const shells = [
      shell("exec-old", { dagId, nodeId: nodeA, role: "executor" }),
      shell("other", { dagId: otherDagId, nodeId: null, role: "planner" }),
      shell("unlinked", null),
      shell("archived", { dagId, nodeId: null, role: "planner" }, { archivedAt: "2026-01-02" }),
      shell("companion", { dagId, nodeId: null, role: "companion" }),
      shell("exec-new", { dagId, nodeId: nodeA, role: "executor" }, { updatedAt: "2026-02-01" }),
      shell("planner", { dagId, nodeId: null, role: "planner" }),
    ];
    const result = linkedPlanThreads(shells, dagId, graph);
    expect(result.map((entry) => entry.thread.id)).toEqual([
      "planner",
      "companion",
      "exec-new",
      "exec-old",
    ]);
    expect(result[2]?.nodeTitle).toBe("Write migration");
    expect(result[0]?.nodeTitle).toBeNull();
  });
});
