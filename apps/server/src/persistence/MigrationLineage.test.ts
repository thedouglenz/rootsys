import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ForeignMigrationLineageError } from "./Errors.ts";
import { runMigrations } from "./Migrations.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

// Each case needs a database of its own: the ledger is the thing under test, so a
// layer shared across cases would carry one case's migrations into the next.
const onFreshDatabase = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.provide(effect, NodeSqliteClient.layerMemory());

it.effect("migrates a database that has never been migrated", () =>
  onFreshDatabase(
    Effect.gen(function* () {
      const executed = yield* runMigrations({ toMigrationInclusive: 41 });

      assert.deepStrictEqual(executed.at(-1)?.[0], 41);
    }),
  ),
);

it.effect("resumes a database this build migrated earlier", () =>
  onFreshDatabase(
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 40 });
      const executed = yield* runMigrations({ toMigrationInclusive: 41 });

      assert.deepStrictEqual(
        executed.map(([id]) => id),
        [41],
      );
    }),
  ),
);

// A state.sqlite from upstream T3 Code reaches the same ids by a different route.
// Booting on it would skip migrations this build still needs, so it must fail.
it.effect("refuses a database whose ledger came from another lineage", () =>
  onFreshDatabase(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* sql`
        UPDATE effect_sql_migrations SET name = 'SomeUpstreamMigration' WHERE migration_id = 40
      `.withoutTransform;

      const error = yield* Effect.flip(runMigrations({ toMigrationInclusive: 41 }));

      assert.instanceOf(error, ForeignMigrationLineageError);
      assert.strictEqual(error.migrationId, 40);
      assert.strictEqual(error.recordedName, "SomeUpstreamMigration");
      assert.include(error.message, "own migration lineage");
    }),
  ),
);
