import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_ProjectionDags", (it) => {
  it.effect("creates the projection_dags table and primary project index", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* runMigrations({ toMigrationInclusive: 41 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projection_dags'
      `;
      assert.strictEqual(tables.length, 1);

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_dags)
      `;
      assert.deepStrictEqual(
        columns.map((column) => column.name),
        [
          "dag_id",
          "title",
          "status",
          "primary_project_id",
          "graph_json",
          "created_at",
          "updated_at",
        ],
      );

      const indexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_dags)
      `;
      assert.ok(indexes.some((index) => index.name === "idx_projection_dags_primary_project_id"));
    }),
  );
});
