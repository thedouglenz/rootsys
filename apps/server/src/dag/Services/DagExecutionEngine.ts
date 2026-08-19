/**
 * DagExecutionEngine - runs DAGs (rootsys).
 *
 * Reacts to `dag.*` and `thread.session-set` domain events: schedules the
 * ready frontier of every running DAG onto provider threads, delivers
 * question answers back to the asking thread, nudges executors that end a
 * turn without reporting, and settles DAG status (completed/failed) when the
 * frontier empties.
 */
import type { DagId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface DagExecutionEngineShape {
  /** Start reacting to domain events. Run inside a scope. */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  /** Resolves when the internal queue is empty and idle (tests). */
  readonly drain: Effect.Effect<void>;
  /** Re-evaluate one DAG's frontier now (idempotent). */
  readonly schedule: (dagId: DagId) => Effect.Effect<void>;
}

export class DagExecutionEngine extends Context.Service<
  DagExecutionEngine,
  DagExecutionEngineShape
>()("t3/dag/Services/DagExecutionEngine") {}
