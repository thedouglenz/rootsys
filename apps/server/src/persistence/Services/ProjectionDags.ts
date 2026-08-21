/**
 * ProjectionDagRepository - Persisted DAG projection rows.
 *
 * One row per DAG carrying the whole `DagGraph` as JSON alongside the
 * denormalized columns used for listing/filtering.
 */
import {
  DagGraph,
  DagId,
  DagStatus,
  IsoDateTime,
  ProjectId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionDag = Schema.Struct({
  dagId: DagId,
  title: TrimmedNonEmptyString,
  status: DagStatus,
  primaryProjectId: Schema.NullOr(ProjectId),
  graph: DagGraph,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionDag = typeof ProjectionDag.Type;

export const GetProjectionDagInput = Schema.Struct({
  dagId: DagId,
});
export type GetProjectionDagInput = typeof GetProjectionDagInput.Type;

export const DeleteProjectionDagInput = Schema.Struct({
  dagId: DagId,
});
export type DeleteProjectionDagInput = typeof DeleteProjectionDagInput.Type;

export interface ProjectionDagRepositoryShape {
  readonly upsert: (row: ProjectionDag) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionDagInput,
  ) => Effect.Effect<Option.Option<ProjectionDag>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<ReadonlyArray<ProjectionDag>, ProjectionRepositoryError>;
  readonly deleteById: (
    input: DeleteProjectionDagInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionDagRepository extends Context.Service<
  ProjectionDagRepository,
  ProjectionDagRepositoryShape
>()("rootsys/persistence/Services/ProjectionDags/ProjectionDagRepository") {}
