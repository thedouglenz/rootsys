import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const decodeUnknownJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("042_ProjectionThreadsDagLink", (it) => {
  it.effect("adds dag_link_json to projection_threads and is idempotent", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 41 });
      const before = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(!before.some((column) => column.name === "dag_link_json"));

      yield* runMigrations({ toMigrationInclusive: 42 });
      const after = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(after.some((column) => column.name === "dag_link_json"));
    }),
  );
});

// Separate layer: the migration must run AFTER the fixture rows exist, and
// the block above has already applied 042 on its shared in-memory database.
it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))("042 backfill", (it) => {
  it.effect("backfills executor links from stored DAG graphs", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 41 });
      const now = "2026-01-01T00:00:00.000Z";
      const threadRow = (threadId: string) => sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
          branch, worktree_path, created_at, updated_at, deleted_at, archived_at
        ) VALUES (
          ${threadId}, 'project-1', 'Thread', '{"instanceId":"codex","model":"m"}', 'full-access',
          'default', NULL, NULL, ${now}, ${now}, NULL, NULL
        )
      `;
      yield* threadRow("thread-bound");
      yield* threadRow("thread-free");
      const graph = encodeUnknownJson({
        dag: {
          dagId: "dag-1",
          title: "Plan",
          description: "",
          primaryProjectId: "project-1",
          status: "running",
          defaultModelSelection: null,
          createdAt: now,
          updatedAt: now,
        },
        nodes: [
          { nodeId: "node-a", threadId: "thread-bound", status: "done", updatedAt: now },
          { nodeId: "node-b", threadId: null, status: "pending", updatedAt: now },
        ],
        edges: [],
        questions: [],
      });
      yield* sql`
        INSERT INTO projection_dags (dag_id, title, status, primary_project_id, graph_json, created_at, updated_at)
        VALUES ('dag-1', 'Plan', 'running', 'project-1', ${graph}, ${now}, ${now})
      `;

      yield* runMigrations({ toMigrationInclusive: 42 });

      const rows = yield* sql<{
        readonly thread_id: string;
        readonly dag_link_json: string | null;
      }>`
        SELECT thread_id, dag_link_json FROM projection_threads ORDER BY thread_id
      `;
      const byId = new Map(rows.map((row) => [row.thread_id, row.dag_link_json]));
      assert.deepEqual(decodeUnknownJson(byId.get("thread-bound")!), {
        dagId: "dag-1",
        nodeId: "node-a",
        role: "executor",
      });
      assert.equal(byId.get("thread-free"), null);
    }),
  );
});
