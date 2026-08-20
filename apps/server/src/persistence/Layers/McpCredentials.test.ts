import { assert, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { McpCredentialRepositoryLive } from "./McpCredentials.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { McpCredential, McpCredentialRepository } from "../Services/McpCredentials.ts";

const layer = it.layer(
  McpCredentialRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const environmentId = EnvironmentId.make("environment-1");

const credential = (overrides: Partial<McpCredential> = {}): McpCredential => ({
  tokenHash: "hash-a",
  environmentId,
  threadId: ThreadId.make("thread-1"),
  providerSessionId: "session-1",
  providerInstanceId: ProviderInstanceId.make("claude"),
  capabilities: ["dag"],
  issuedAt: 1_000,
  lastAliveAt: 1_000,
  ...overrides,
});

layer("McpCredentialRepository", (it) => {
  it.effect("round-trips a credential and upserts by token hash", () =>
    Effect.gen(function* () {
      const credentials = yield* McpCredentialRepository;
      const row = credential({ capabilities: ["dag", "preview"] });

      yield* credentials.upsert(row);
      assert.deepStrictEqual(
        yield* credentials.getByTokenHash({ tokenHash: row.tokenHash }),
        Option.some(row),
      );

      const downgraded = { ...row, capabilities: ["dag"] as const, lastAliveAt: 2_000 };
      yield* credentials.upsert(downgraded);
      assert.deepStrictEqual(yield* credentials.listAll(), [downgraded]);

      yield* credentials.deleteByTokenHash({ tokenHash: row.tokenHash });
      assert.deepStrictEqual(yield* credentials.listAll(), []);
    }),
  );

  it.effect("touches, deletes by thread, prunes by cutoff, and clears", () =>
    Effect.gen(function* () {
      const credentials = yield* McpCredentialRepository;
      const threadA = ThreadId.make("thread-a");
      const threadB = ThreadId.make("thread-b");

      yield* credentials.upsert(credential({ tokenHash: "hash-a", threadId: threadA }));
      yield* credentials.upsert(credential({ tokenHash: "hash-b", threadId: threadB }));

      yield* credentials.touch({ tokenHash: "hash-a", lastAliveAt: 9_000 });
      const touched = yield* credentials.getByTokenHash({ tokenHash: "hash-a" });
      assert.deepStrictEqual(
        Option.map(touched, (row) => row.lastAliveAt),
        Option.some(9_000),
      );

      yield* credentials.deleteByThreadId({ threadId: threadB });
      assert.deepStrictEqual(
        (yield* credentials.listAll()).map((row) => row.tokenHash),
        ["hash-a"],
      );

      yield* credentials.upsert(
        credential({ tokenHash: "hash-c", threadId: threadB, lastAliveAt: 500 }),
      );
      yield* credentials.pruneOlderThan({ cutoff: 1_000 });
      assert.deepStrictEqual(
        (yield* credentials.listAll()).map((row) => row.tokenHash),
        ["hash-a"],
      );

      yield* credentials.deleteAll();
      assert.deepStrictEqual(yield* credentials.listAll(), []);
    }),
  );
});
