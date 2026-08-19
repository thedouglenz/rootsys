import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "dag_link_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN dag_link_json TEXT
    `;
  }

  // Backfill executor links for threads bound before this column existed.
  // Projectors only apply new events, so DAGs already running (or finished)
  // would otherwise leave their executor threads unlinked. The bound thread
  // is recorded on each node in the DAG's stored graph.
  yield* sql`
    UPDATE projection_threads
    SET dag_link_json = (
      SELECT json_object(
        'dagId', d.dag_id,
        'nodeId', json_extract(n.value, '$.nodeId'),
        'role', 'executor'
      )
      FROM projection_dags d, json_each(d.graph_json, '$.nodes') n
      WHERE json_extract(n.value, '$.threadId') = projection_threads.thread_id
      ORDER BY json_extract(n.value, '$.updatedAt') DESC
      LIMIT 1
    )
    WHERE dag_link_json IS NULL
      AND EXISTS (
        SELECT 1
        FROM projection_dags d2, json_each(d2.graph_json, '$.nodes') n2
        WHERE json_extract(n2.value, '$.threadId') = projection_threads.thread_id
      )
  `;
});
