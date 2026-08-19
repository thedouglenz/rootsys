import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Persisted DAG projection. DAGs are small, so each row carries the whole
 * graph as JSON (folded by the same pure `projectDagEvent` the in-memory read
 * model uses) plus a few denormalized columns for listing/filtering.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_dags (
      dag_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      primary_project_id TEXT,
      graph_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_dags_primary_project_id
    ON projection_dags(primary_project_id)
  `;
});
