import { DagId, DagNodeId, EnvironmentId, type ThreadDagLink } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  dagMemberDisplayTitle,
  fallbackDagTitle,
  groupSidebarThreadsByDag,
} from "./dagThreadGrouping";

const env = EnvironmentId.make("env-1");
const dagA = DagId.make("dag-a");
const dagB = DagId.make("dag-b");

const executor = (dagId: DagId, nodeId: string): ThreadDagLink => ({
  dagId,
  nodeId: DagNodeId.make(nodeId),
  role: "executor",
});

const thread = (title: string, dagLink: ThreadDagLink | null = null) => ({
  environmentId: env,
  title,
  dagLink,
});

describe("groupSidebarThreadsByDag", () => {
  it("folds threads of one plan into a group at the first member's position", () => {
    const t1 = thread("Ship: build", executor(dagA, "build"));
    const t2 = thread("plain one");
    const t3 = thread("Ship: test", executor(dagA, "test"));
    const t4 = thread("plain two");
    const items = groupSidebarThreadsByDag([t1, t2, t3, t4]);
    expect(items.map((item) => item.kind)).toEqual(["plan-group", "thread", "thread"]);
    const group = items[0];
    if (group?.kind !== "plan-group") throw new Error("expected a group");
    expect(group.key).toBe(`${env}:${dagA}`);
    expect(group.threads).toEqual([t1, t3]);
    expect(items[1]).toEqual({ kind: "thread", thread: t2 });
  });

  it("leaves a lone linked thread as a plain row", () => {
    const t1 = thread("Plan: Ship", { dagId: dagA, nodeId: null, role: "planner" });
    const t2 = thread("Other: x", executor(dagB, "x"));
    const t3 = thread("Other: y", executor(dagB, "y"));
    const items = groupSidebarThreadsByDag([t1, t2, t3]);
    expect(items[0]).toEqual({ kind: "thread", thread: t1 });
    expect(items[1]?.kind).toBe("plan-group");
    expect(items).toHaveLength(2);
  });

  it("returns plain rows untouched when nothing is linked", () => {
    const t1 = thread("a");
    const t2 = thread("b");
    expect(groupSidebarThreadsByDag([t1, t2])).toEqual([
      { kind: "thread", thread: t1 },
      { kind: "thread", thread: t2 },
    ]);
  });
});

describe("fallbackDagTitle", () => {
  it("strips the planner/companion prefix", () => {
    expect(
      fallbackDagTitle([
        thread("Planning — Ship it", { dagId: dagA, nodeId: null, role: "planner" }),
        thread("build", executor(dagA, "build")),
      ]),
    ).toBe("Ship it");
    expect(
      fallbackDagTitle([
        thread("Companion — Ship it", { dagId: dagA, nodeId: null, role: "companion" }),
      ]),
    ).toBe("Ship it");
  });
  it("still reads the titles older servers produced", () => {
    expect(
      fallbackDagTitle([thread("Plan: Ship it", { dagId: dagA, nodeId: null, role: "planner" })]),
    ).toBe("Ship it");
  });
  it("returns null when only executors are present, since they no longer name the plan", () => {
    expect(
      fallbackDagTitle([
        thread("build", executor(dagA, "build")),
        thread("run: the tests", executor(dagA, "test")),
      ]),
    ).toBeNull();
    expect(fallbackDagTitle([thread("untitled")])).toBeNull();
  });
});

describe("dagMemberDisplayTitle", () => {
  const planner = { dagId: dagA, nodeId: null, role: "planner" } as const;
  const companion = { dagId: dagA, nodeId: null, role: "companion" } as const;

  it("drops the plan title the group header already shows", () => {
    expect(dagMemberDisplayTitle(thread("Companion — Ship it", companion))).toBe("Companion");
    expect(dagMemberDisplayTitle(thread("Planning — Ship it", planner))).toBe("Planning");
  });

  it("reads the legacy titles older servers produced", () => {
    expect(dagMemberDisplayTitle(thread("Companion: Ship it", companion))).toBe("Companion");
    expect(dagMemberDisplayTitle(thread("Plan: Ship it", planner))).toBe("Planning");
  });

  it("leaves executors alone, since they are already node-titled", () => {
    expect(dagMemberDisplayTitle(thread("Run the tests", executor(dagA, "test")))).toBe(
      "Run the tests",
    );
    expect(dagMemberDisplayTitle(thread("Companion — Ship it", executor(dagA, "x")))).toBe(
      "Companion — Ship it",
    );
  });

  it("keeps a title that merely starts like the prefix", () => {
    expect(dagMemberDisplayTitle(thread("Companionship audit", companion))).toBe(
      "Companionship audit",
    );
    expect(dagMemberDisplayTitle(thread("Planning the rollout", planner))).toBe(
      "Planning the rollout",
    );
    // Prefix with nothing after it is not a plan-scoped title either.
    expect(dagMemberDisplayTitle(thread("Companion — ", companion))).toBe("Companion — ");
  });

  it("keeps a renamed thread's own name", () => {
    expect(dagMemberDisplayTitle(thread("Why does auth 500?", companion))).toBe(
      "Why does auth 500?",
    );
  });

  it("leaves unlinked threads alone", () => {
    expect(dagMemberDisplayTitle(thread("Companion — Ship it"))).toBe("Companion — Ship it");
  });
});
