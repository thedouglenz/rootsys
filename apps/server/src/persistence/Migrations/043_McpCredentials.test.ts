import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("043_McpCredentials", (it) => {
  it.effect("creates mcp_credentials with its lookup indexes", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 42 });
      const before = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mcp_credentials'
      `;
      assert.deepEqual(before, []);

      yield* runMigrations({ toMigrationInclusive: 43 });
      const columns = yield* sql<{ readonly name: string; readonly type: string }>`
        PRAGMA table_info(mcp_credentials)
      `;
      assert.deepEqual(
        columns.map((column) => [column.name, column.type]),
        [
          ["token_hash", "TEXT"],
          ["environment_id", "TEXT"],
          ["thread_id", "TEXT"],
          ["provider_session_id", "TEXT"],
          ["provider_instance_id", "TEXT"],
          ["capabilities_json", "TEXT"],
          ["issued_at", "INTEGER"],
          ["last_alive_at", "INTEGER"],
        ],
      );

      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND tbl_name = 'mcp_credentials'
        ORDER BY name
      `;
      const indexNames = new Set(indexes.map((index) => index.name));
      assert.ok(indexNames.has("idx_mcp_credentials_thread_id"));
      assert.ok(indexNames.has("idx_mcp_credentials_last_alive_at"));

      // Idempotent: re-running the loader through 43 is a no-op.
      const rerun = yield* runMigrations({ toMigrationInclusive: 43 });
      assert.deepEqual(rerun, []);
    }),
  );
});
