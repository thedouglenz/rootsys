import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { HttpServer } from "effect/unstable/http";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import type { McpCredentialRepositoryError } from "../persistence/Errors.ts";
import {
  type McpCredential,
  McpCredentialRepository,
} from "../persistence/Services/McpCredentials.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpProviderSession from "./McpProviderSession.ts";

export interface McpCredentialRequest {
  readonly threadId: ThreadId;
  readonly providerInstanceId: ProviderInstanceId;
  /**
   * Optional toolkits beyond the always-on `dag` capability. Defaults to
   * `["preview"]` for callers that predate capability negotiation.
   */
  readonly capabilities?: ReadonlyArray<McpInvocationContext.McpCapability>;
}

export interface McpIssuedCredential {
  readonly config: McpProviderSession.McpProviderSessionConfig;
}

export interface McpSessionRegistryShape {
  /**
   * Mints the credential a starting provider session will be handed.
   *
   * Credentials the same thread already holds are kept when they grant exactly
   * the same capabilities: a resumed CLI presents the token baked into its own
   * session config, not the one we just minted, so revoking here is what used
   * to strip the whole `t3-code` toolkit from a resumed agent. A changed
   * capability set still revokes, so a thread that loses `preview` cannot keep
   * a preview-capable token.
   */
  readonly issue: (request: McpCredentialRequest) => Effect.Effect<McpIssuedCredential>;
  readonly resolve: (
    rawToken: string,
  ) => Effect.Effect<McpInvocationContext.McpInvocationScope | undefined>;
  /**
   * Records a sign of life for every credential bound to `threadId`. Provider
   * turns call this so that a session which is plainly alive keeps its
   * credential even when it goes a long time without touching an MCP tool.
   */
  readonly touch: (threadId: ThreadId) => Effect.Effect<void>;
  readonly revokeProviderSession: (providerSessionId: string) => Effect.Effect<void>;
  readonly revokeThread: (threadId: ThreadId) => Effect.Effect<void>;
  /**
   * Drops the in-memory map without revoking anything.
   *
   * Shutdown runs through here (`ProviderService.stopAll` is a layer
   * finalizer). Deleting the persisted rows there would undo the whole point
   * of persisting them, because the sessions being stopped are exactly the
   * ones that will be resumed with their old token after the restart.
   */
  readonly forgetAll: Effect.Effect<void>;
}

export class McpSessionRegistry extends Context.Service<
  McpSessionRegistry,
  McpSessionRegistryShape
>()("t3/mcp/McpSessionRegistry") {}

interface CredentialRecord {
  readonly tokenHash: string;
  readonly scope: McpInvocationContext.McpInvocationScope;
  readonly lastAliveAt: number;
  /** Last `lastAliveAt` written to SQLite; throttles liveness writes. */
  readonly persistedAliveAt: number;
}

interface RegistryState {
  readonly records: ReadonlyMap<string, CredentialRecord>;
}

export interface McpSessionRegistryOptions {
  readonly livenessWindowMs?: number;
  readonly now?: () => number;
}

/**
 * How long a credential outlives the last sign of life from its provider
 * session.
 *
 * Liveness is refreshed both by MCP traffic and by `touch` on every provider
 * turn, so a session that is still doing work never expires no matter how long
 * it goes between browser tool calls. This window therefore only bounds
 * credentials whose session died without a clean stop — `stopSession` revokes
 * eagerly and does not wait for it. Since credentials now survive a restart,
 * this window is also what bounds rows left behind by sessions that never come
 * back.
 *
 * The bound matters because `/mcp` is mounted outside the environment auth
 * stack and is reachable on whatever host the server binds to, so this token is
 * the only thing guarding the preview toolkit on a remote-reachable server.
 */
const DEFAULT_LIVENESS_WINDOW_MS = 24 * 60 * 60 * 1_000;

/**
 * Liveness is refreshed on every MCP call and every provider turn; writing
 * that through each time would mean a SQLite write per turn for a value only
 * read after a restart. Coalescing to a minute keeps restart recovery accurate
 * to well within the liveness window.
 */
const LIVENESS_WRITE_INTERVAL_MS = 60_000;

/**
 * Each session start adds a token the thread's older sessions may still be
 * using. Bounded so a thread resumed all day cannot grow an unbounded set of
 * live credentials.
 */
const MAX_CREDENTIALS_PER_THREAD = 4;

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const tokenFromBytes = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

const getHttpMcpEndpointHost = (hostname: string): string => {
  const normalized = hostname.toLowerCase();
  const endpointHostname =
    normalized === "0.0.0.0" || normalized === "::" || normalized === "[::]"
      ? "127.0.0.1"
      : hostname;
  return endpointHostname.includes(":") && !endpointHostname.startsWith("[")
    ? `[${endpointHostname}]`
    : endpointHostname;
};

const sameCapabilities = (
  left: ReadonlySet<McpInvocationContext.McpCapability>,
  right: ReadonlySet<McpInvocationContext.McpCapability>,
): boolean => left.size === right.size && Array.from(left).every((entry) => right.has(entry));

const toRecord = (row: McpCredential): CredentialRecord => ({
  tokenHash: row.tokenHash,
  scope: {
    environmentId: row.environmentId,
    threadId: row.threadId,
    providerSessionId: row.providerSessionId,
    providerInstanceId: row.providerInstanceId,
    capabilities: new Set(row.capabilities),
    issuedAt: row.issuedAt,
  },
  lastAliveAt: row.lastAliveAt,
  persistedAliveAt: row.lastAliveAt,
});

const toRow = (record: CredentialRecord): McpCredential => ({
  tokenHash: record.tokenHash,
  environmentId: record.scope.environmentId,
  threadId: record.scope.threadId,
  providerSessionId: record.scope.providerSessionId,
  providerInstanceId: record.scope.providerInstanceId,
  capabilities: Array.from(record.scope.capabilities),
  issuedAt: record.scope.issuedAt,
  lastAliveAt: record.lastAliveAt,
});

const makeWithOptions = Effect.fn("McpSessionRegistry.make")(function* (
  options: McpSessionRegistryOptions = {},
) {
  const crypto = yield* Crypto.Crypto;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const environmentId = yield* environment.getEnvironmentId;
  const httpServer = yield* HttpServer.HttpServer;
  const credentials = yield* McpCredentialRepository;
  const currentTimeMillis = options.now ? Effect.sync(options.now) : Clock.currentTimeMillis;
  const livenessWindowMs = options.livenessWindowMs ?? DEFAULT_LIVENESS_WINDOW_MS;
  const endpoint =
    httpServer.address._tag === "TcpAddress"
      ? `http://${getHttpMcpEndpointHost(httpServer.address.hostname)}:${httpServer.address.port}/mcp`
      : "http://127.0.0.1/mcp";
  // Every agent's tool access depends on this URL being right, and a wrong one
  // fails silently: the CLI simply lists no t3-code tools. Log it once.
  yield* Effect.logInfo("mcp credential endpoint resolved", {
    endpoint,
    addressKind: httpServer.address._tag,
  });

  /**
   * A credential store that cannot be written is a degraded restart story, not
   * a reason to fail an MCP call or a session start, so every write is
   * best-effort and the in-memory map stays authoritative for this process.
   */
  const persist = (
    operation: string,
    effect: Effect.Effect<void, McpCredentialRepositoryError>,
  ): Effect.Effect<void> =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to persist MCP credential state", { operation, cause }),
      ),
    );

  const hashToken = (token: string) =>
    crypto
      .digest("SHA-256", new TextEncoder().encode(token))
      .pipe(Effect.map(bytesToHex), Effect.orDie);

  const pruneDead = (records: ReadonlyMap<string, CredentialRecord>, timestamp: number) => {
    const next = new Map(
      Array.from(records).filter(
        ([, record]) => timestamp - record.lastAliveAt <= livenessWindowMs,
      ),
    );
    return next.size === records.size ? records : next;
  };

  // Rehydrate before serving anything: a provider CLI resumed after a restart
  // presents the token it was handed by the previous process.
  const startedAt = yield* currentTimeMillis;
  const stored = yield* credentials
    .listAll()
    .pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to load persisted MCP credentials", { cause }).pipe(
          Effect.as<ReadonlyArray<McpCredential>>([]),
        ),
      ),
    );
  const liveRows = stored.filter((row) => startedAt - row.lastAliveAt <= livenessWindowMs);
  if (liveRows.length !== stored.length) {
    yield* persist(
      "load.prune",
      credentials.pruneOlderThan({ cutoff: startedAt - livenessWindowMs }),
    );
  }
  if (liveRows.length > 0) {
    yield* Effect.logDebug("restored persisted MCP credentials", { count: liveRows.length });
  }
  const state = yield* SynchronizedRef.make<RegistryState>({
    records: new Map(liveRows.map((row) => [row.tokenHash, toRecord(row)] as const)),
  });

  const issue: McpSessionRegistryShape["issue"] = Effect.fn("McpSessionRegistry.issue")(
    function* (request) {
      const issuedAt = yield* currentTimeMillis;
      const providerSessionId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
      const rawToken = yield* crypto.randomBytes(32).pipe(Effect.map(tokenFromBytes), Effect.orDie);
      const tokenHash = yield* hashToken(rawToken);
      const scope: McpInvocationContext.McpInvocationScope = {
        environmentId,
        threadId: ThreadId.make(request.threadId),
        providerSessionId,
        providerInstanceId: ProviderInstanceId.make(request.providerInstanceId),
        // rootsys: DAG tools are always available; preview is opt-in via
        // the caller (server setting `enableAgentBrowserAccess`).
        capabilities: new Set<McpInvocationContext.McpCapability>([
          "dag",
          ...(request.capabilities ?? ["preview"]),
        ]),
        issuedAt,
      };
      const record: CredentialRecord = {
        tokenHash,
        scope,
        lastAliveAt: issuedAt,
        persistedAliveAt: issuedAt,
      };
      const revoked = yield* SynchronizedRef.modify(state, ({ records }) => {
        const current = pruneDead(records, issuedAt);
        const next = new Map<string, CredentialRecord>();
        const sameThread: Array<CredentialRecord> = [];
        const dropped: Array<string> = [];
        for (const [hash, existing] of current) {
          if (existing.scope.threadId !== scope.threadId) {
            next.set(hash, existing);
          } else if (sameCapabilities(existing.scope.capabilities, scope.capabilities)) {
            sameThread.push(existing);
          } else {
            dropped.push(hash);
          }
        }
        sameThread.sort((left, right) => right.lastAliveAt - left.lastAliveAt);
        for (const [index, existing] of sameThread.entries()) {
          if (index < MAX_CREDENTIALS_PER_THREAD - 1) {
            next.set(existing.tokenHash, existing);
          } else {
            dropped.push(existing.tokenHash);
          }
        }
        next.set(tokenHash, record);
        return [dropped, { records: next }] as const;
      });
      yield* persist("issue", credentials.upsert(toRow(record)));
      yield* Effect.forEach(revoked, (hash) =>
        persist("issue.revoke", credentials.deleteByTokenHash({ tokenHash: hash })),
      );
      return {
        config: {
          environmentId,
          threadId: scope.threadId,
          providerSessionId,
          providerInstanceId: scope.providerInstanceId,
          endpoint,
          authorizationHeader: `Bearer ${rawToken}`,
        },
      };
    },
  );

  const resolve: McpSessionRegistryShape["resolve"] = Effect.fn("McpSessionRegistry.resolve")(
    function* (rawToken) {
      if (rawToken.length === 0) return undefined;
      const tokenHash = yield* hashToken(rawToken);
      const timestamp = yield* currentTimeMillis;
      const hit = yield* SynchronizedRef.modify(state, ({ records }) => {
        const current = pruneDead(records, timestamp);
        const record = current.get(tokenHash);
        if (!record) return [undefined, { records: current }] as const;
        const writeThrough = timestamp - record.persistedAliveAt >= LIVENESS_WRITE_INTERVAL_MS;
        const next = new Map(current);
        next.set(tokenHash, {
          ...record,
          lastAliveAt: timestamp,
          persistedAliveAt: writeThrough ? timestamp : record.persistedAliveAt,
        });
        return [{ scope: record.scope, writeThrough }, { records: next }] as const;
      });
      if (hit) {
        if (hit.writeThrough) {
          yield* persist("resolve.touch", credentials.touch({ tokenHash, lastAliveAt: timestamp }));
        }
        return hit.scope;
      }

      // Cold path: a credential this process never issued. Normally covered by
      // the startup rehydrate, so this only catches rows another writer added.
      const row = yield* credentials
        .getByTokenHash({ tokenHash })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to read persisted MCP credential", { cause }).pipe(
              Effect.as(Option.none<McpCredential>()),
            ),
          ),
        );
      if (Option.isNone(row)) return undefined;
      if (timestamp - row.value.lastAliveAt > livenessWindowMs) {
        yield* persist("resolve.expired", credentials.deleteByTokenHash({ tokenHash }));
        return undefined;
      }
      const restored: CredentialRecord = {
        ...toRecord(row.value),
        lastAliveAt: timestamp,
        persistedAliveAt: timestamp,
      };
      yield* SynchronizedRef.update(state, ({ records }) => {
        const next = new Map(pruneDead(records, timestamp));
        next.set(tokenHash, restored);
        return { records: next };
      });
      yield* persist("resolve.warm", credentials.touch({ tokenHash, lastAliveAt: timestamp }));
      return restored.scope;
    },
  );

  const touch: McpSessionRegistryShape["touch"] = Effect.fn("McpSessionRegistry.touch")(
    function* (threadId) {
      const timestamp = yield* currentTimeMillis;
      const writeThrough = yield* SynchronizedRef.modify(state, ({ records }) => {
        const current = pruneDead(records, timestamp);
        const next = new Map(current);
        const hashes: Array<string> = [];
        for (const [tokenHash, record] of current) {
          if (record.scope.threadId !== threadId) continue;
          const shouldWrite = timestamp - record.persistedAliveAt >= LIVENESS_WRITE_INTERVAL_MS;
          if (shouldWrite) hashes.push(tokenHash);
          next.set(tokenHash, {
            ...record,
            lastAliveAt: timestamp,
            persistedAliveAt: shouldWrite ? timestamp : record.persistedAliveAt,
          });
        }
        return [hashes, { records: next }] as const;
      });
      yield* Effect.forEach(writeThrough, (tokenHash) =>
        persist("touch", credentials.touch({ tokenHash, lastAliveAt: timestamp })),
      );
    },
  );

  const forgetWhere = (predicate: (record: CredentialRecord) => boolean) =>
    SynchronizedRef.modify(state, ({ records }) => {
      const next = new Map<string, CredentialRecord>();
      const removed: Array<string> = [];
      for (const [tokenHash, record] of records) {
        if (predicate(record)) removed.push(tokenHash);
        else next.set(tokenHash, record);
      }
      return [removed, { records: next }] as const;
    });

  return McpSessionRegistry.of({
    issue,
    resolve,
    touch,
    revokeProviderSession: Effect.fn("McpSessionRegistry.revokeProviderSession")(
      function* (providerSessionId) {
        const removed = yield* forgetWhere(
          (record) => record.scope.providerSessionId === providerSessionId,
        );
        yield* Effect.forEach(removed, (tokenHash) =>
          persist("revokeProviderSession", credentials.deleteByTokenHash({ tokenHash })),
        );
      },
    ),
    revokeThread: Effect.fn("McpSessionRegistry.revokeThread")(function* (threadId) {
      yield* forgetWhere((record) => record.scope.threadId === threadId);
      yield* persist("revokeThread", credentials.deleteByThreadId({ threadId }));
    }),
    forgetAll: SynchronizedRef.set(state, { records: new Map() }),
  });
});

let activeMcpSessionRegistry: McpSessionRegistryShape | undefined;

const make = Effect.acquireRelease(
  makeWithOptions().pipe(
    Effect.tap((registry) =>
      Effect.sync(() => {
        activeMcpSessionRegistry = registry;
      }),
    ),
  ),
  (registry) =>
    Effect.sync(() => {
      if (activeMcpSessionRegistry === registry) {
        activeMcpSessionRegistry = undefined;
      }
    }),
);

export const layer = Layer.effect(McpSessionRegistry, make);

export const issueActiveMcpCredential = (
  request: McpCredentialRequest,
): Effect.Effect<McpIssuedCredential | undefined> =>
  activeMcpSessionRegistry
    ? activeMcpSessionRegistry.issue(request)
    : Effect.sync((): McpIssuedCredential | undefined => undefined);

/**
 * Refreshes the liveness of a thread's MCP credential. Called on every provider
 * turn so an active session is never mistaken for an abandoned one.
 */
export const touchActiveMcpThread = (threadId: ThreadId): Effect.Effect<void> =>
  activeMcpSessionRegistry ? activeMcpSessionRegistry.touch(threadId) : Effect.void;

export const revokeActiveMcpThread = (threadId: ThreadId): Effect.Effect<void> =>
  activeMcpSessionRegistry ? activeMcpSessionRegistry.revokeThread(threadId) : Effect.void;

/**
 * Shutdown path. Drops the in-memory map and deliberately leaves the persisted
 * credentials alone so resumed sessions keep working after a restart.
 */
export const forgetAllActiveMcpCredentials = (): Effect.Effect<void> =>
  activeMcpSessionRegistry ? activeMcpSessionRegistry.forgetAll : Effect.void;

/** Exposed for tests. */
export const __testing = {
  make: makeWithOptions,
};
