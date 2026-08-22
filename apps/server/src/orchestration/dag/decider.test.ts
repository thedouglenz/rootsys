import {
  CommandId,
  DagId,
  DagNodeId,
  DagQuestionId,
  ProjectId,
  type DagGraph,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "../decider.ts";
import { createEmptyReadModel, projectEvent } from "../projector.ts";
import { OrchestrationCommandInvariantError } from "../Errors.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const dagId = DagId.make("dag-1");
const projectId = ProjectId.make("project-1");
const node = (id: string) => DagNodeId.make(id);
let commandCounter = 0;
const cmd = () => CommandId.make(`cmd-${++commandCounter}`);

/** Decide + project in one step so tests read like a script. */
const apply = (readModel: OrchestrationReadModel, command: OrchestrationCommand) =>
  Effect.gen(function* () {
    const decided = yield* decideOrchestrationCommand({ command, readModel });
    const events = (Array.isArray(decided) ? decided : [decided]) as ReadonlyArray<
      Omit<OrchestrationEvent, "sequence">
    >;
    let next = readModel;
    let sequence = readModel.snapshotSequence;
    for (const event of events) {
      sequence += 1;
      next = yield* projectEvent(next, { ...event, sequence } as OrchestrationEvent);
    }
    return { readModel: next, events };
  });

const graphOf = (readModel: OrchestrationReadModel): DagGraph => {
  const graph = readModel.dags?.find((candidate) => candidate.dag.dagId === dagId);
  if (!graph) throw new Error("dag missing");
  return graph;
};

const withProject = (readModel: OrchestrationReadModel) =>
  apply(readModel, {
    type: "project.create",
    commandId: cmd(),
    projectId,
    title: "Project",
    workspaceRoot: "/tmp/rootsys-dag-test",
    createdAt: NOW,
  }).pipe(Effect.map((r) => r.readModel));

const seedDag = Effect.gen(function* () {
  let model = yield* withProject(createEmptyReadModel(NOW));
  model = (yield* apply(model, {
    type: "dag.create",
    commandId: cmd(),
    dagId,
    title: "Plan",
    primaryProjectId: projectId,
    createdAt: NOW,
  })).readModel;
  for (const id of ["a", "b", "c"]) {
    model = (yield* apply(model, {
      type: "dag.node.upsert",
      commandId: cmd(),
      dagId,
      nodeId: node(id),
      title: `Node ${id}`,
      ...(id === "b" ? { dependsOn: [node("a")] } : {}),
      ...(id === "c" ? { dependsOn: [node("b")] } : {}),
    })).readModel;
  }
  return model;
});

const expectInvariant = <A, E, R>(effect: Effect.Effect<A, E, R>, detail?: string) =>
  Effect.gen(function* () {
    const result = yield* Effect.flip(effect);
    expect(result).toBeInstanceOf(OrchestrationCommandInvariantError);
    if (detail !== undefined) {
      expect((result as OrchestrationCommandInvariantError).detail).toBe(detail);
    }
  });

const nodeOf = (readModel: OrchestrationReadModel, id: string) =>
  graphOf(readModel).nodes.find((candidate) => candidate.nodeId === node(id))!;

/** Seed a->b->c and drive node `a` into a terminal status. */
const seedWithFinishedA = (status: "done" | "failed" | "skipped", summary?: string) =>
  Effect.gen(function* () {
    const seeded = yield* seedDag;
    return (yield* apply(seeded, {
      type: "dag.node.status.set",
      commandId: cmd(),
      dagId,
      nodeId: node("a"),
      status,
      ...(summary !== undefined ? { summary } : {}),
    })).readModel;
  });

it.layer(NodeServices.layer)("dag decider", (it) => {
  it.effect("creates a dag and nodes with dependsOn edges", () =>
    Effect.gen(function* () {
      const graph = graphOf(yield* seedDag);
      expect(graph.dag.status).toBe("draft");
      expect(graph.dag.primaryProjectId).toBe(projectId);
      expect(graph.nodes.map((n) => n.nodeId)).toEqual([node("a"), node("b"), node("c")]);
      expect(graph.edges.map((e) => `${e.fromNodeId}->${e.toNodeId}`)).toEqual(["a->b", "b->c"]);
      expect(graph.nodes.every((n) => n.status === "pending")).toBe(true);
    }),
  );

  it.effect("rejects dag.create for a missing project or duplicate dag", () =>
    Effect.gen(function* () {
      const empty = createEmptyReadModel(NOW);
      yield* expectInvariant(
        apply(empty, {
          type: "dag.create",
          commandId: cmd(),
          dagId,
          title: "Plan",
          primaryProjectId: ProjectId.make("nope"),
          createdAt: NOW,
        }),
      );
      const seeded = yield* seedDag;
      yield* expectInvariant(
        apply(seeded, {
          type: "dag.create",
          commandId: cmd(),
          dagId,
          title: "Dup",
          createdAt: NOW,
        }),
      );
    }),
  );

  it.effect("rejects edges that would create a cycle, including via dependsOn", () =>
    Effect.gen(function* () {
      const seeded = yield* seedDag;
      yield* expectInvariant(
        apply(seeded, {
          type: "dag.edge.add",
          commandId: cmd(),
          dagId,
          fromNodeId: node("c"),
          toNodeId: node("a"),
        }),
      );
      yield* expectInvariant(
        apply(seeded, {
          type: "dag.node.upsert",
          commandId: cmd(),
          dagId,
          nodeId: node("a"),
          dependsOn: [node("c")],
        }),
      );
      // A new node depending on itself is rejected too.
      yield* expectInvariant(
        apply(seeded, {
          type: "dag.node.upsert",
          commandId: cmd(),
          dagId,
          nodeId: node("d"),
          title: "d",
          dependsOn: [node("d")],
        }),
      );
    }),
  );

  it.effect("node upsert updates structural fields only and keeps status", () =>
    Effect.gen(function* () {
      let model = yield* seedDag;
      model = (yield* apply(model, {
        type: "dag.node.status.set",
        commandId: cmd(),
        dagId,
        nodeId: node("a"),
        status: "running",
      })).readModel;
      model = (yield* apply(model, {
        type: "dag.node.upsert",
        commandId: cmd(),
        dagId,
        nodeId: node("a"),
        description: "updated",
        parallelSafe: true,
      })).readModel;
      const a = graphOf(model).nodes.find((n) => n.nodeId === node("a"))!;
      expect(a.status).toBe("running");
      expect(a.description).toBe("updated");
      expect(a.parallelSafe).toBe(true);
      expect(a.title).toBe("Node a");
    }),
  );

  it.effect("terminal status records an outcome; deleting a node drops its edges", () =>
    Effect.gen(function* () {
      let model = yield* seedDag;
      model = (yield* apply(model, {
        type: "dag.node.status.set",
        commandId: cmd(),
        dagId,
        nodeId: node("a"),
        status: "done",
        summary: "shipped",
      })).readModel;
      const a = graphOf(model).nodes.find((n) => n.nodeId === node("a"))!;
      expect(a.outcome?.summary).toBe("shipped");
      model = (yield* apply(model, {
        type: "dag.node.delete",
        commandId: cmd(),
        dagId,
        nodeId: node("b"),
      })).readModel;
      const graph = graphOf(model);
      expect(graph.nodes.map((n) => n.nodeId)).toEqual([node("a"), node("c")]);
      expect(graph.edges).toEqual([]);
    }),
  );

  it.effect("asking a question blocks the node; answering the last open one resumes it", () =>
    Effect.gen(function* () {
      let model = yield* seedDag;
      model = (yield* apply(model, {
        type: "dag.node.status.set",
        commandId: cmd(),
        dagId,
        nodeId: node("a"),
        status: "running",
      })).readModel;
      const q1 = DagQuestionId.make("q1");
      const q2 = DagQuestionId.make("q2");
      const asked = yield* apply(model, {
        type: "dag.question.ask",
        commandId: cmd(),
        dagId,
        nodeId: node("a"),
        questionId: q1,
        prompt: "Which auth provider?",
        options: ["clerk", "auth0"],
      });
      expect(asked.events.map((e) => e.type)).toEqual([
        "dag.question-asked",
        "dag.node-status-set",
      ]);
      model = asked.readModel;
      expect(graphOf(model).nodes[0]!.status).toBe("blocked");
      // Second question on an already-blocked node emits no extra status event.
      const askedAgain = yield* apply(model, {
        type: "dag.question.ask",
        commandId: cmd(),
        dagId,
        nodeId: node("a"),
        questionId: q2,
        prompt: "Second?",
      });
      expect(askedAgain.events.map((e) => e.type)).toEqual(["dag.question-asked"]);
      model = askedAgain.readModel;
      const first = yield* apply(model, {
        type: "dag.question.answer",
        commandId: cmd(),
        dagId,
        questionId: q1,
        answer: "clerk",
      });
      expect(first.events.map((e) => e.type)).toEqual(["dag.question-answered"]);
      model = first.readModel;
      expect(graphOf(model).nodes[0]!.status).toBe("blocked");
      const second = yield* apply(model, {
        type: "dag.question.answer",
        commandId: cmd(),
        dagId,
        questionId: q2,
        answer: null,
      });
      expect(second.events.map((e) => e.type)).toEqual([
        "dag.question-answered",
        "dag.node-status-set",
      ]);
      model = second.readModel;
      const graph = graphOf(model);
      expect(graph.nodes[0]!.status).toBe("running");
      expect(graph.questions.map((q) => q.status)).toEqual(["answered", "dismissed"]);
      // Answering again is rejected.
      yield* expectInvariant(
        apply(model, {
          type: "dag.question.answer",
          commandId: cmd(),
          dagId,
          questionId: q1,
          answer: "x",
        }),
      );
    }),
  );

  it.effect("a done or skipped node rejects content edits and deletion", () =>
    Effect.gen(function* () {
      for (const status of ["done", "skipped"] as const) {
        const model = yield* seedWithFinishedA(status, "shipped");
        yield* expectInvariant(
          apply(model, {
            type: "dag.node.upsert",
            commandId: cmd(),
            dagId,
            nodeId: node("a"),
            description: "rewritten brief",
          }),
          `Node a is ${status} and its content is locked. Reopen it (set status pending) before editing.`,
        );
        // Any content-bearing field trips it, even an empty dependsOn that
        // would otherwise pass every other check.
        yield* expectInvariant(
          apply(model, {
            type: "dag.node.upsert",
            commandId: cmd(),
            dagId,
            nodeId: node("a"),
            dependsOn: [],
          }),
          `Node a is ${status} and its content is locked. Reopen it (set status pending) before editing.`,
        );
        yield* expectInvariant(
          apply(model, { type: "dag.node.delete", commandId: cmd(), dagId, nodeId: node("a") }),
          `Node a is ${status} and its content is locked. Reopen it (set status pending) before deleting.`,
        );
        // The record survived both attempts intact.
        expect(nodeOf(model, "a").description).toBe("");
        expect(nodeOf(model, "a").outcome?.summary).toBe("shipped");
      }
    }),
  );

  it.effect("reopening a done node to pending unlocks the same edit", () =>
    Effect.gen(function* () {
      let model = yield* seedWithFinishedA("done", "shipped");
      model = (yield* apply(model, {
        type: "dag.node.status.set",
        commandId: cmd(),
        dagId,
        nodeId: node("a"),
        status: "pending",
      })).readModel;
      model = (yield* apply(model, {
        type: "dag.node.upsert",
        commandId: cmd(),
        dagId,
        nodeId: node("a"),
        description: "rewritten brief",
        title: "Node a, take two",
      })).readModel;
      expect(nodeOf(model, "a").description).toBe("rewritten brief");
      expect(nodeOf(model, "a").title).toBe("Node a, take two");
      expect(nodeOf(model, "a").status).toBe("pending");
    }),
  );

  it.effect("a content-free upsert on a done node is a harmless no-op", () =>
    Effect.gen(function* () {
      const model = yield* seedWithFinishedA("done", "shipped");
      const before = nodeOf(model, "a");
      const result = yield* apply(model, {
        type: "dag.node.upsert",
        commandId: cmd(),
        dagId,
        nodeId: node("a"),
      });
      const after = nodeOf(result.readModel, "a");
      expect(after.title).toBe(before.title);
      expect(after.description).toBe(before.description);
      expect(after.acceptance).toBe(before.acceptance);
      expect(after.status).toBe("done");
      expect(after.outcome).toEqual(before.outcome);
      expect(graphOf(result.readModel).edges).toEqual(graphOf(model).edges);
    }),
  );

  it.effect("a failed node stays editable and deletable", () =>
    Effect.gen(function* () {
      let model = yield* seedWithFinishedA("failed", "blew up");
      model = (yield* apply(model, {
        type: "dag.node.upsert",
        commandId: cmd(),
        dagId,
        nodeId: node("a"),
        description: "clarified brief",
      })).readModel;
      expect(nodeOf(model, "a").description).toBe("clarified brief");
      expect(nodeOf(model, "a").status).toBe("failed");
      model = (yield* apply(model, {
        type: "dag.node.delete",
        commandId: cmd(),
        dagId,
        nodeId: node("a"),
      })).readModel;
      expect(graphOf(model).nodes.map((n) => n.nodeId)).toEqual([node("b"), node("c")]);
    }),
  );

  it.effect("status.set stays open in every direction on a done node", () =>
    Effect.gen(function* () {
      let model = yield* seedWithFinishedA("done", "first pass");
      // done -> done with a corrected summary.
      model = (yield* apply(model, {
        type: "dag.node.status.set",
        commandId: cmd(),
        dagId,
        nodeId: node("a"),
        status: "done",
        summary: "second pass",
      })).readModel;
      expect(nodeOf(model, "a").outcome?.summary).toBe("second pass");
      for (const status of [
        "pending",
        "running",
        "blocked",
        "failed",
        "skipped",
        "done",
      ] as const) {
        model = (yield* apply(model, {
          type: "dag.node.status.set",
          commandId: cmd(),
          dagId,
          nodeId: node("a"),
          status,
        })).readModel;
        expect(nodeOf(model, "a").status).toBe(status);
      }
    }),
  );

  it.effect("explicit edge commands still work with a finished endpoint", () =>
    Effect.gen(function* () {
      let model = yield* seedWithFinishedA("done", "shipped");
      model = (yield* apply(model, {
        type: "dag.edge.add",
        commandId: cmd(),
        dagId,
        fromNodeId: node("a"),
        toNodeId: node("c"),
      })).readModel;
      expect(graphOf(model).edges.map((e) => `${e.fromNodeId}->${e.toNodeId}`)).toEqual([
        "a->b",
        "b->c",
        "a->c",
      ]);
      model = (yield* apply(model, {
        type: "dag.edge.remove",
        commandId: cmd(),
        dagId,
        fromNodeId: node("a"),
        toNodeId: node("b"),
      })).readModel;
      expect(graphOf(model).edges.map((e) => `${e.fromNodeId}->${e.toNodeId}`)).toEqual([
        "b->c",
        "a->c",
      ]);
    }),
  );

  it.effect("dag.delete removes the graph; commands against it then fail", () =>
    Effect.gen(function* () {
      let model = yield* seedDag;
      model = (yield* apply(model, { type: "dag.delete", commandId: cmd(), dagId })).readModel;
      expect(model.dags ?? []).toEqual([]);
      yield* expectInvariant(
        apply(model, { type: "dag.status.set", commandId: cmd(), dagId, status: "ready" }),
      );
    }),
  );
});

it.layer(NodeServices.layer)("dag node upsert no-op", (it) => {
  it.effect("a content-free upsert leaves the node's timestamp untouched", () =>
    Effect.gen(function* () {
      let model = yield* seedDag;
      const before = graphOf(model).nodes.find((n) => n.nodeId === node("a"))!;
      model = (yield* apply(model, {
        type: "dag.node.upsert",
        commandId: cmd(),
        dagId,
        nodeId: node("a"),
      })).readModel;
      const after = graphOf(model).nodes.find((n) => n.nodeId === node("a"))!;
      expect(after.updatedAt).toBe(before.updatedAt);
      expect(after.title).toBe(before.title);
    }),
  );
});
