import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { McpCapability } from "../../mcp/McpInvocationContext.ts";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteMcpCredentialInput,
  DeleteMcpCredentialsByThreadInput,
  GetMcpCredentialInput,
  McpCredential,
  McpCredentialRepository,
  type McpCredentialRepositoryShape,
  PruneMcpCredentialsInput,
  TouchMcpCredentialInput,
} from "../Services/McpCredentials.ts";

const McpCredentialDbRow = McpCredential.mapFields(
  Struct.assign({
    capabilities: Schema.fromJsonString(Schema.Array(McpCapability)),
  }),
);

const selectColumns = `
  token_hash AS "tokenHash",
  environment_id AS "environmentId",
  thread_id AS "threadId",
  provider_session_id AS "providerSessionId",
  provider_instance_id AS "providerInstanceId",
  capabilities_json AS "capabilities",
  issued_at AS "issuedAt",
  last_alive_at AS "lastAliveAt"
`;

const makeMcpCredentialRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertMcpCredentialRow = SqlSchema.void({
    Request: McpCredential,
    execute: (row) => sql`
      INSERT INTO mcp_credentials (
        token_hash,
        environment_id,
        thread_id,
        provider_session_id,
        provider_instance_id,
        capabilities_json,
        issued_at,
        last_alive_at
      )
      VALUES (
        ${row.tokenHash},
        ${row.environmentId},
        ${row.threadId},
        ${row.providerSessionId},
        ${row.providerInstanceId},
        ${JSON.stringify(row.capabilities)},
        ${row.issuedAt},
        ${row.lastAliveAt}
      )
      ON CONFLICT (token_hash)
      DO UPDATE SET
        environment_id = excluded.environment_id,
        thread_id = excluded.thread_id,
        provider_session_id = excluded.provider_session_id,
        provider_instance_id = excluded.provider_instance_id,
        capabilities_json = excluded.capabilities_json,
        issued_at = excluded.issued_at,
        last_alive_at = excluded.last_alive_at
    `,
  });

  const getMcpCredentialRow = SqlSchema.findOneOption({
    Request: GetMcpCredentialInput,
    Result: McpCredentialDbRow,
    execute: ({ tokenHash }) => sql`
      SELECT ${sql.literal(selectColumns)}
      FROM mcp_credentials
      WHERE token_hash = ${tokenHash}
    `,
  });

  const listMcpCredentialRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: McpCredentialDbRow,
    execute: () => sql`
      SELECT ${sql.literal(selectColumns)}
      FROM mcp_credentials
      ORDER BY issued_at ASC, token_hash ASC
    `,
  });

  const touchMcpCredentialRow = SqlSchema.void({
    Request: TouchMcpCredentialInput,
    execute: ({ lastAliveAt, tokenHash }) => sql`
      UPDATE mcp_credentials
      SET last_alive_at = ${lastAliveAt}
      WHERE token_hash = ${tokenHash}
    `,
  });

  const deleteMcpCredentialRowsByThread = SqlSchema.void({
    Request: DeleteMcpCredentialsByThreadInput,
    execute: ({ threadId }) => sql`
      DELETE FROM mcp_credentials
      WHERE thread_id = ${threadId}
    `,
  });

  const deleteMcpCredentialRow = SqlSchema.void({
    Request: DeleteMcpCredentialInput,
    execute: ({ tokenHash }) => sql`
      DELETE FROM mcp_credentials
      WHERE token_hash = ${tokenHash}
    `,
  });

  const deleteAllMcpCredentialRows = SqlSchema.void({
    Request: Schema.Void,
    execute: () => sql`DELETE FROM mcp_credentials`,
  });

  const pruneMcpCredentialRows = SqlSchema.void({
    Request: PruneMcpCredentialsInput,
    execute: ({ cutoff }) => sql`
      DELETE FROM mcp_credentials
      WHERE last_alive_at < ${cutoff}
    `,
  });

  const upsert: McpCredentialRepositoryShape["upsert"] = (row) =>
    upsertMcpCredentialRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("McpCredentialRepository.upsert:query")),
    );

  const getByTokenHash: McpCredentialRepositoryShape["getByTokenHash"] = (input) =>
    getMcpCredentialRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("McpCredentialRepository.getByTokenHash:query")),
    );

  const listAll: McpCredentialRepositoryShape["listAll"] = () =>
    listMcpCredentialRows(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("McpCredentialRepository.listAll:query")),
    );

  const touch: McpCredentialRepositoryShape["touch"] = (input) =>
    touchMcpCredentialRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("McpCredentialRepository.touch:query")),
    );

  const deleteByThreadId: McpCredentialRepositoryShape["deleteByThreadId"] = (input) =>
    deleteMcpCredentialRowsByThread(input).pipe(
      Effect.mapError(toPersistenceSqlError("McpCredentialRepository.deleteByThreadId:query")),
    );

  const deleteByTokenHash: McpCredentialRepositoryShape["deleteByTokenHash"] = (input) =>
    deleteMcpCredentialRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("McpCredentialRepository.deleteByTokenHash:query")),
    );

  const deleteAll: McpCredentialRepositoryShape["deleteAll"] = () =>
    deleteAllMcpCredentialRows(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("McpCredentialRepository.deleteAll:query")),
    );

  const pruneOlderThan: McpCredentialRepositoryShape["pruneOlderThan"] = (input) =>
    pruneMcpCredentialRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("McpCredentialRepository.pruneOlderThan:query")),
    );

  return {
    upsert,
    getByTokenHash,
    listAll,
    touch,
    deleteByThreadId,
    deleteByTokenHash,
    deleteAll,
    pruneOlderThan,
  } satisfies McpCredentialRepositoryShape;
});

export const McpCredentialRepositoryLive = Layer.effect(
  McpCredentialRepository,
  makeMcpCredentialRepository,
);
