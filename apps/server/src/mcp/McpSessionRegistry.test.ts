import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpServer } from "effect/unstable/http";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { McpCredentialRepositoryLive } from "../persistence/Layers/McpCredentials.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { McpCredentialRepository } from "../persistence/Services/McpCredentials.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";

const environmentId = EnvironmentId.make("environment-1");
const makeFakeHttpServer = (hostname: string, port = 43123) =>
  HttpServer.HttpServer.of({
    address: { _tag: "TcpAddress", hostname, port },
    serve: (() => Effect.void) as HttpServer.HttpServer["Service"]["serve"],
  });
const fakeHttpServer = makeFakeHttpServer("127.0.0.1");
const fakeEnvironment = ServerEnvironment.ServerEnvironment.of({
  getEnvironmentId: Effect.succeed(environmentId),
  getDescriptor: Effect.die("unused"),
});

/**
 * One in-memory database per test. Building two registries inside the same
 * `withPersistence` block reuses that database, which is how a server restart
 * is simulated.
 */
const withPersistence = <A, E>(effect: Effect.Effect<A, E, McpCredentialRepository>) =>
  effect.pipe(
    Effect.provide(McpCredentialRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory))),
  );

const makeRegistry = (now: () => number, httpServer = fakeHttpServer) =>
  McpSessionRegistry.__testing
    .make({
      now,
      livenessWindowMs: 100,
    })
    .pipe(
      Effect.provideService(HttpServer.HttpServer, httpServer),
      Effect.provideService(ServerEnvironment.ServerEnvironment, fakeEnvironment),
      Effect.provide(NodeServices.layer),
    );

const bearer = (issued: McpSessionRegistry.McpIssuedCredential) =>
  issued.config.authorizationHeader.replace(/^Bearer\s+/, "");

it.effect("stores only a token hash, resolves the bearer token, and revokes by thread", () =>
  withPersistence(
    Effect.gen(function* () {
      let timestamp = 1_000;
      const registry = yield* makeRegistry(() => timestamp);
      const credentials = yield* McpCredentialRepository;
      const threadId = ThreadId.make("thread-1");
      const issued = yield* registry.issue({
        threadId,
        providerInstanceId: ProviderInstanceId.make("codex"),
      });
      expect(issued.config.endpoint).toBe("http://127.0.0.1:43123/mcp");
      const token = bearer(issued);
      expect(token.length).toBeGreaterThan(20);

      const stored = yield* credentials.listAll();
      expect(stored).toHaveLength(1);
      expect(stored[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored[0]!.tokenHash).not.toBe(token);

      const resolved = yield* registry.resolve(token);
      expect(resolved?.threadId).toBe(threadId);

      yield* registry.revokeThread(threadId);
      expect(yield* registry.resolve(token)).toBeUndefined();
      expect(yield* credentials.listAll()).toEqual([]);

      timestamp += 2_000;
    }),
  ),
);

it.effect("builds MCP endpoints from the bound server host", () =>
  withPersistence(
    Effect.gen(function* () {
      const cases = [
        ["100.64.0.40", "http://100.64.0.40:43123/mcp"],
        ["0.0.0.0", "http://127.0.0.1:43123/mcp"],
        ["localhost", "http://localhost:43123/mcp"],
        ["127.0.0.1", "http://127.0.0.1:43123/mcp"],
      ] as const;

      for (const [hostname, expectedEndpoint] of cases) {
        const registry = yield* makeRegistry(() => 1_000, makeFakeHttpServer(hostname));
        const issued = yield* registry.issue({
          threadId: ThreadId.make(`thread-${hostname}`),
          providerInstanceId: ProviderInstanceId.make("codex"),
        });
        expect(issued.config.endpoint).toBe(expectedEndpoint);
      }
    }),
  ),
);

it.effect("expires credentials once their session stops showing signs of life", () =>
  withPersistence(
    Effect.gen(function* () {
      let timestamp = 1_000;
      const registry = yield* makeRegistry(() => timestamp);
      const issued = yield* registry.issue({
        threadId: ThreadId.make("thread-2"),
        providerInstanceId: ProviderInstanceId.make("claude"),
      });
      const token = bearer(issued);
      timestamp += 101;
      expect(yield* registry.resolve(token)).toBeUndefined();
    }),
  ),
);

it.effect("keeps a credential alive across turns that never touch an MCP tool", () =>
  withPersistence(
    Effect.gen(function* () {
      let timestamp = 1_000;
      const registry = yield* makeRegistry(() => timestamp);
      const threadId = ThreadId.make("thread-3");
      const issued = yield* registry.issue({
        threadId,
        providerInstanceId: ProviderInstanceId.make("claude"),
      });
      const token = bearer(issued);

      // Well past the liveness window in total, but each turn reports in before
      // it lapses — this is the long-session case that used to lose the toolkit.
      for (let turn = 0; turn < 10; turn += 1) {
        timestamp += 99;
        yield* registry.touch(threadId);
      }

      expect((yield* registry.resolve(token))?.threadId).toBe(threadId);
    }),
  ),
);

it.effect("does not keep credentials of other threads alive", () =>
  withPersistence(
    Effect.gen(function* () {
      let timestamp = 1_000;
      const registry = yield* makeRegistry(() => timestamp);
      const issued = yield* registry.issue({
        threadId: ThreadId.make("thread-4"),
        providerInstanceId: ProviderInstanceId.make("codex"),
      });
      const token = bearer(issued);

      timestamp += 99;
      yield* registry.touch(ThreadId.make("thread-unrelated"));
      timestamp += 2;

      expect(yield* registry.resolve(token)).toBeUndefined();
    }),
  ),
);

it.effect("a token issued before a restart still resolves afterwards", () =>
  withPersistence(
    Effect.gen(function* () {
      let timestamp = 1_000;
      const threadId = ThreadId.make("thread-restart");
      const before = yield* makeRegistry(() => timestamp);
      const issued = yield* before.issue({
        threadId,
        providerInstanceId: ProviderInstanceId.make("claude"),
        capabilities: ["preview"],
      });
      const token = bearer(issued);

      // Shutdown only drops the in-memory map; the rows stay.
      yield* before.forgetAll;
      expect(yield* before.resolve(token)).toBeDefined();

      timestamp += 50;
      const after = yield* makeRegistry(() => timestamp);
      const resolved = yield* after.resolve(token);
      expect(resolved?.threadId).toBe(threadId);
      expect(Array.from(resolved?.capabilities ?? [])).toEqual(["dag", "preview"]);
      expect(resolved?.providerSessionId).toBe(issued.config.providerSessionId);
    }),
  ),
);

it.effect("prunes credentials that lapsed while the server was down", () =>
  withPersistence(
    Effect.gen(function* () {
      let timestamp = 1_000;
      const before = yield* makeRegistry(() => timestamp);
      const credentials = yield* McpCredentialRepository;
      const issued = yield* before.issue({
        threadId: ThreadId.make("thread-lapsed"),
        providerInstanceId: ProviderInstanceId.make("codex"),
      });
      const token = bearer(issued);

      timestamp += 101;
      const after = yield* makeRegistry(() => timestamp);
      expect(yield* after.resolve(token)).toBeUndefined();
      expect(yield* credentials.listAll()).toEqual([]);
    }),
  ),
);

it.effect("a restarted session keeps the old token when capabilities match", () =>
  withPersistence(
    Effect.gen(function* () {
      const timestamp = 1_000;
      const registry = yield* makeRegistry(() => timestamp);
      const threadId = ThreadId.make("thread-resume");
      const first = yield* registry.issue({
        threadId,
        providerInstanceId: ProviderInstanceId.make("claude"),
        capabilities: [],
      });
      const second = yield* registry.issue({
        threadId,
        providerInstanceId: ProviderInstanceId.make("claude"),
        capabilities: [],
      });

      expect(bearer(second)).not.toBe(bearer(first));
      expect((yield* registry.resolve(bearer(first)))?.threadId).toBe(threadId);
      expect((yield* registry.resolve(bearer(second)))?.threadId).toBe(threadId);
    }),
  ),
);

it.effect("a capability change mints a new token and invalidates the old one", () =>
  withPersistence(
    Effect.gen(function* () {
      const timestamp = 1_000;
      const registry = yield* makeRegistry(() => timestamp);
      const credentials = yield* McpCredentialRepository;
      const threadId = ThreadId.make("thread-downgrade");
      const withPreview = yield* registry.issue({
        threadId,
        providerInstanceId: ProviderInstanceId.make("claude"),
        capabilities: ["preview"],
      });
      const withoutPreview = yield* registry.issue({
        threadId,
        providerInstanceId: ProviderInstanceId.make("claude"),
        capabilities: [],
      });

      expect(yield* registry.resolve(bearer(withPreview))).toBeUndefined();
      const resolved = yield* registry.resolve(bearer(withoutPreview));
      expect(Array.from(resolved?.capabilities ?? [])).toEqual(["dag"]);
      const rows = yield* credentials.listAll();
      expect(rows.map((row) => row.capabilities)).toEqual([["dag"]]);
    }),
  ),
);

it.effect("bounds how many live credentials one thread accumulates", () =>
  withPersistence(
    Effect.gen(function* () {
      let timestamp = 1_000;
      const registry = yield* makeRegistry(() => timestamp);
      const credentials = yield* McpCredentialRepository;
      const threadId = ThreadId.make("thread-many");
      const tokens: Array<string> = [];
      for (let session = 0; session < 6; session += 1) {
        timestamp += 1;
        tokens.push(
          bearer(
            yield* registry.issue({
              threadId,
              providerInstanceId: ProviderInstanceId.make("codex"),
              capabilities: [],
            }),
          ),
        );
      }

      expect(yield* credentials.listAll()).toHaveLength(4);
      expect(yield* registry.resolve(tokens[0]!)).toBeUndefined();
      expect(yield* registry.resolve(tokens[5]!)).toBeDefined();
    }),
  ),
);
