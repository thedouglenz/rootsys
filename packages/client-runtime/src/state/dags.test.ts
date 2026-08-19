import {
  CommandId,
  DagId,
  DagNodeId,
  type DagGraph,
  type DagNode,
  EventId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyDagStreamItem,
  buildDagNodeViews,
  EMPTY_ENVIRONMENT_DAG_STATE,
  resolveDagRunAction,
  resolveDagRunBlocker,
} from "./dags.ts";

const dagId = DagId.make("dag-1");
const NOW = "2026-01-01T00:00:00.000Z";
const graph: DagGraph = {
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
};
const base = {
  eventId: EventId.make("e"),
  aggregateKind: "dag" as const,
  aggregateId: dagId,
  occurredAt: NOW,
  commandId: CommandId.make("c"),
  causationEventId: null,
  correlationId: null,
  metadata: {},
};

describe("applyDagStreamItem", () => {
  it("applies snapshot, folds events after the snapshot sequence, and handles deletion", () => {
    let state = applyDagStreamItem(EMPTY_ENVIRONMENT_DAG_STATE, {
      kind: "snapshot",
      snapshot: { snapshotSequence: 5, graph },
    });
    expect(state.status).toBe("live");
    // Stale event (<= snapshot sequence) is ignored.
    state = applyDagStreamItem(state, {
      kind: "event",
      event: {
        ...base,
        sequence: 5,
        type: "dag.status-set",
        payload: { dagId, status: "ready", updatedAt: NOW },
      },
    });
    expect(state.graph?.dag.status).toBe("draft");
    state = applyDagStreamItem(state, {
      kind: "event",
      event: {
        ...base,
        sequence: 6,
        type: "dag.node-upserted",
        payload: {
          dagId,
          node: {
            nodeId: DagNodeId.make("a"),
            dagId,
            projectId: null,
            title: "A",
            description: "",
            acceptance: null,
            parallelSafe: false,
            executionMode: "auto",
            modelSelection: null,
            status: "pending",
            threadId: null,
            outcome: null,
            createdAt: NOW,
            updatedAt: NOW,
          },
          addedEdges: [],
          updatedAt: NOW,
        },
      },
    });
    expect(state.graph?.nodes.map((n) => n.nodeId)).toEqual(["a"]);
    expect(state.snapshotSequence).toBe(6);
    state = applyDagStreamItem(state, {
      kind: "event",
      event: { ...base, sequence: 7, type: "dag.deleted", payload: { dagId, deletedAt: NOW } },
    });
    expect(state).toEqual({ graph: null, status: "deleted", snapshotSequence: 7 });
  });

  it("synchronized marks a loading state live", () => {
    expect(applyDagStreamItem(EMPTY_ENVIRONMENT_DAG_STATE, { kind: "synchronized" }).status).toBe(
      "live",
    );
  });
});

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

function withGraph(partial: Partial<DagGraph>): DagGraph {
  return { ...graph, ...partial };
}

describe("buildDagNodeViews", () => {
  it("marks pending nodes with satisfied upstream as ready and counts open questions", () => {
    const views = buildDagNodeViews(
      withGraph({
        nodes: [node("a", "done"), node("b"), node("c")],
        edges: [
          { dagId, fromNodeId: DagNodeId.make("a"), toNodeId: DagNodeId.make("b") },
          { dagId, fromNodeId: DagNodeId.make("b"), toNodeId: DagNodeId.make("c") },
        ],
        questions: [
          {
            questionId: "q1" as never,
            dagId,
            nodeId: DagNodeId.make("c"),
            threadId: null,
            prompt: "?",
            options: [],
            status: "open",
            answer: null,
            createdAt: NOW,
            answeredAt: null,
          },
        ],
      }),
    );
    expect(views.map((view) => view.displayStatus)).toEqual(["done", "ready", "pending"]);
    expect(views[2]?.openQuestionCount).toBe(1);
  });
});

describe("resolveDagRunBlocker", () => {
  it("reports missing nodes, project, and model in that order", () => {
    expect(resolveDagRunBlocker({ graph, projectDefaultModelSelection: null })).toBe("no-nodes");
    expect(
      resolveDagRunBlocker({
        graph: withGraph({ nodes: [node("a")] }),
        projectDefaultModelSelection: null,
      }),
    ).toBe("no-project");
    const projectGraph: DagGraph = {
      ...withGraph({ nodes: [node("a")] }),
      dag: { ...graph.dag, primaryProjectId: "p1" as never },
    };
    expect(resolveDagRunBlocker({ graph: projectGraph, projectDefaultModelSelection: null })).toBe(
      "no-model",
    );
    expect(
      resolveDagRunBlocker({
        graph: projectGraph,
        projectDefaultModelSelection: { instanceId: "codex" as never, model: "m" },
      }),
    ).toBeNull();
  });
});

describe("resolveDagRunAction", () => {
  it("maps statuses to the primary action", () => {
    expect(resolveDagRunAction("draft")).toBe("run");
    expect(resolveDagRunAction("running")).toBe("pause");
    expect(resolveDagRunAction("paused")).toBe("resume");
    expect(resolveDagRunAction("archived")).toBeNull();
  });
});
