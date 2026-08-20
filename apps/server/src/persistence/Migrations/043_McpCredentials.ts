import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Issued MCP bearer credentials.
 *
 * The registry keeps these in memory for the hot path, but a provider CLI
 * bakes the credential it was handed into its own per-session config. When the
 * server restarts, a resumed session still presents that old bearer token, so
 * the credential has to outlive the process that minted it — otherwise every
 * `dag_*`/`preview_*` call from the resumed agent is rejected.
 *
 * Only the SHA-256 hash of the token is stored, so a copy of this table cannot
 * be replayed as a credential.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS mcp_credentials (
      token_hash TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      provider_session_id TEXT NOT NULL,
      provider_instance_id TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      last_alive_at INTEGER NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_mcp_credentials_thread_id
    ON mcp_credentials(thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_mcp_credentials_last_alive_at
    ON mcp_credentials(last_alive_at)
  `;
});
