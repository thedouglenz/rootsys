import { DagId, DagNodeId, type DagGraph, type DagNode } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  describeDagCompletionCounts,
  formatDagDurationLabel,
  summarizeDagCompletion,
} from "./dagCompletion";

const dagId = DagId.make("dag-1");
const CREATED_AT = "2026-01-01T00:00:00.000Z";

function node(
  id: string,
  status: DagNode["status"],
  finishedAt: string | null,
  updatedAt: string = CREATED_AT,
): DagNode {
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
    outcome:
      finishedAt === null ? null : { summary: null, threadId: null, completedAt: finishedAt },
    createdAt: CREATED_AT,
    updatedAt,
  };
}

function graph(nodes: ReadonlyArray<DagNode>): Pick<DagGraph, "nodes"> {
  return { nodes };
}

describe("summarizeDagCompletion", () => {
  it("counts terminal statuses and spans the first finish to the last", () => {
    const summary = summarizeDagCompletion(
      graph([
        node("a", "done", "2026-01-01T01:00:00.000Z"),
        node("b", "skipped", "2026-01-01T02:05:00.000Z"),
        node("c", "failed", "2026-01-01T03:05:00.000Z"),
        node("d", "pending", null),
      ]),
    );
    expect(summary).toEqual({
      total: 4,
      done: 1,
      skipped: 1,
      failed: 1,
      finishedAt: "2026-01-01T03:05:00.000Z",
      nodeSpanMs: 2 * 60 * 60 * 1000 + 5 * 60 * 1000,
    });
  });

  it("falls back to updatedAt when a finished node recorded no outcome", () => {
    const summary = summarizeDagCompletion(
      graph([
        node("a", "done", null, "2026-01-01T01:00:00.000Z"),
        node("b", "done", null, "2026-01-01T01:30:00.000Z"),
      ]),
    );
    expect(summary.finishedAt).toBe("2026-01-01T01:30:00.000Z");
    expect(summary.nodeSpanMs).toBe(30 * 60 * 1000);
  });

  it("omits the span when it cannot be derived from two finishes", () => {
    expect(summarizeDagCompletion(graph([node("a", "done", CREATED_AT)])).nodeSpanMs).toBeNull();
    const unfinished = summarizeDagCompletion(graph([node("a", "pending", null)]));
    expect(unfinished.finishedAt).toBeNull();
    expect(unfinished.nodeSpanMs).toBeNull();
  });
});

describe("describeDagCompletionCounts", () => {
  it("leaves zero counts out", () => {
    expect(
      describeDagCompletionCounts({
        total: 21,
        done: 21,
        skipped: 0,
        failed: 0,
        finishedAt: null,
        nodeSpanMs: null,
      }),
    ).toBe("21 of 21 nodes done");
    expect(
      describeDagCompletionCounts({
        total: 21,
        done: 18,
        skipped: 2,
        failed: 1,
        finishedAt: null,
        nodeSpanMs: null,
      }),
    ).toBe("18 of 21 nodes done · 2 skipped · 1 failed");
  });
});

describe("formatDagDurationLabel", () => {
  it("scales from seconds to days", () => {
    expect(formatDagDurationLabel(4_000)).toBe("4s");
    expect(formatDagDurationLabel(12 * 60_000 + 30_000)).toBe("12m");
    expect(formatDagDurationLabel(2 * 3_600_000 + 5 * 60_000)).toBe("2h 5m");
    expect(formatDagDurationLabel(3 * 3_600_000)).toBe("3h");
    expect(formatDagDurationLabel(27 * 3_600_000)).toBe("1d 3h");
  });
});
