import { DagId, DagNodeId, ProjectId, type DagGraph } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionDagRepositoryLive } from "./ProjectionDags.ts";
import { ProjectionDagRepository } from "../Services/ProjectionDags.ts";

const layer = it.layer(
  ProjectionDagRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const NOW = "2026-03-24T00:00:00.000Z";
const dagId = DagId.make("dag-1");
const projectId = ProjectId.make("project-1");

const graph: DagGraph = {
  dag: {
    dagId,
    title: "Plan",
    description: "",
    primaryProjectId: projectId,
    status: "draft",
    defaultModelSelection: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  nodes: [
    {
      nodeId: DagNodeId.make("node-a"),
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
  ],
  edges: [],
  questions: [],
};

const rowFor = (input: DagGraph) => ({
  dagId: input.dag.dagId,
  title: input.dag.title,
  status: input.dag.status,
  primaryProjectId: input.dag.primaryProjectId,
  graph: input,
  createdAt: input.dag.createdAt,
  updatedAt: input.dag.updatedAt,
});

layer("ProjectionDagRepository", (it) => {
  it.effect("round-trips the graph JSON and upserts by dagId", () =>
    Effect.gen(function* () {
      const dags = yield* ProjectionDagRepository;

      yield* dags.upsert(rowFor(graph));
      const stored = yield* dags.getById({ dagId });
      assert.deepStrictEqual(stored, Option.some(rowFor(graph)));

      const updated: DagGraph = {
        ...graph,
        dag: { ...graph.dag, title: "Renamed", status: "ready", primaryProjectId: null },
      };
      yield* dags.upsert(rowFor(updated));
      const all = yield* dags.listAll();
      assert.deepStrictEqual(all, [rowFor(updated)]);

      yield* dags.deleteById({ dagId });
      assert.deepStrictEqual(yield* dags.getById({ dagId }), Option.none());
      assert.deepStrictEqual(yield* dags.listAll(), []);
    }),
  );
});
