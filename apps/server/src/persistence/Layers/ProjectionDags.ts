import { DagGraph } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionDagInput,
  GetProjectionDagInput,
  ProjectionDag,
  ProjectionDagRepository,
  type ProjectionDagRepositoryShape,
} from "../Services/ProjectionDags.ts";

const ProjectionDagDbRow = ProjectionDag.mapFields(
  Struct.assign({
    graph: Schema.fromJsonString(DagGraph),
  }),
);

const makeProjectionDagRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionDagRow = SqlSchema.void({
    Request: ProjectionDag,
    execute: (row) => sql`
      INSERT INTO projection_dags (
        dag_id,
        title,
        status,
        primary_project_id,
        graph_json,
        created_at,
        updated_at
      )
      VALUES (
        ${row.dagId},
        ${row.title},
        ${row.status},
        ${row.primaryProjectId},
        ${JSON.stringify(row.graph)},
        ${row.createdAt},
        ${row.updatedAt}
      )
      ON CONFLICT (dag_id)
      DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        primary_project_id = excluded.primary_project_id,
        graph_json = excluded.graph_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
  });

  const getProjectionDagRow = SqlSchema.findOneOption({
    Request: GetProjectionDagInput,
    Result: ProjectionDagDbRow,
    execute: ({ dagId }) => sql`
      SELECT
        dag_id AS "dagId",
        title,
        status,
        primary_project_id AS "primaryProjectId",
        graph_json AS "graph",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_dags
      WHERE dag_id = ${dagId}
    `,
  });

  const listProjectionDagRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionDagDbRow,
    execute: () => sql`
      SELECT
        dag_id AS "dagId",
        title,
        status,
        primary_project_id AS "primaryProjectId",
        graph_json AS "graph",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_dags
      ORDER BY created_at ASC, dag_id ASC
    `,
  });

  const deleteProjectionDagRow = SqlSchema.void({
    Request: DeleteProjectionDagInput,
    execute: ({ dagId }) => sql`
      DELETE FROM projection_dags
      WHERE dag_id = ${dagId}
    `,
  });

  const upsert: ProjectionDagRepositoryShape["upsert"] = (row) =>
    upsertProjectionDagRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionDagRepository.upsert:query")),
    );

  const getById: ProjectionDagRepositoryShape["getById"] = (input) =>
    getProjectionDagRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionDagRepository.getById:query")),
    );

  const listAll: ProjectionDagRepositoryShape["listAll"] = () =>
    listProjectionDagRows(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionDagRepository.listAll:query")),
    );

  const deleteById: ProjectionDagRepositoryShape["deleteById"] = (input) =>
    deleteProjectionDagRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionDagRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listAll,
    deleteById,
  } satisfies ProjectionDagRepositoryShape;
});

export const ProjectionDagRepositoryLive = Layer.effect(
  ProjectionDagRepository,
  makeProjectionDagRepository,
);
