/**
 * McpCredentialRepository - Issued MCP bearer credentials.
 *
 * One row per issued credential, keyed by the SHA-256 hash of the bearer token
 * (the raw token is never stored). `McpSessionRegistry` owns this table and
 * treats it as the durable mirror of its in-memory map, so a provider CLI that
 * is resumed after a server restart can keep using the token it baked into its
 * own session config.
 */
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { McpCapability } from "../../mcp/McpInvocationContext.ts";
import type { McpCredentialRepositoryError } from "../Errors.ts";

export const McpCredential = Schema.Struct({
  tokenHash: Schema.String,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  providerSessionId: Schema.String,
  providerInstanceId: ProviderInstanceId,
  capabilities: Schema.Array(McpCapability),
  /** Epoch millis, matching the registry's clock. */
  issuedAt: Schema.Number,
  lastAliveAt: Schema.Number,
});
export type McpCredential = typeof McpCredential.Type;

export const GetMcpCredentialInput = Schema.Struct({
  tokenHash: Schema.String,
});
export type GetMcpCredentialInput = typeof GetMcpCredentialInput.Type;

export const TouchMcpCredentialInput = Schema.Struct({
  tokenHash: Schema.String,
  lastAliveAt: Schema.Number,
});
export type TouchMcpCredentialInput = typeof TouchMcpCredentialInput.Type;

export const DeleteMcpCredentialsByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteMcpCredentialsByThreadInput = typeof DeleteMcpCredentialsByThreadInput.Type;

export const DeleteMcpCredentialInput = Schema.Struct({
  tokenHash: Schema.String,
});
export type DeleteMcpCredentialInput = typeof DeleteMcpCredentialInput.Type;

export const PruneMcpCredentialsInput = Schema.Struct({
  /** Rows whose `lastAliveAt` is strictly older than this are deleted. */
  cutoff: Schema.Number,
});
export type PruneMcpCredentialsInput = typeof PruneMcpCredentialsInput.Type;

export interface McpCredentialRepositoryShape {
  readonly upsert: (row: McpCredential) => Effect.Effect<void, McpCredentialRepositoryError>;
  readonly getByTokenHash: (
    input: GetMcpCredentialInput,
  ) => Effect.Effect<Option.Option<McpCredential>, McpCredentialRepositoryError>;
  readonly listAll: () => Effect.Effect<ReadonlyArray<McpCredential>, McpCredentialRepositoryError>;
  readonly touch: (
    input: TouchMcpCredentialInput,
  ) => Effect.Effect<void, McpCredentialRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteMcpCredentialsByThreadInput,
  ) => Effect.Effect<void, McpCredentialRepositoryError>;
  readonly deleteByTokenHash: (
    input: DeleteMcpCredentialInput,
  ) => Effect.Effect<void, McpCredentialRepositoryError>;
  readonly deleteAll: () => Effect.Effect<void, McpCredentialRepositoryError>;
  readonly pruneOlderThan: (
    input: PruneMcpCredentialsInput,
  ) => Effect.Effect<void, McpCredentialRepositoryError>;
}

export class McpCredentialRepository extends Context.Service<
  McpCredentialRepository,
  McpCredentialRepositoryShape
>()("t3/persistence/Services/McpCredentials/McpCredentialRepository") {}
