/**
 * DAG projector (rootsys): folds `dag.*` events into the in-memory read
 * model's `dags` slice using the shared contracts fold.
 */
import {
  type DagGraph,
  foldDagEvent,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";

/** @deprecated use `foldDagEvent` from contracts; kept for local call sites. */
export const projectDagEvent = (
  dags: ReadonlyArray<DagGraph>,
  event: OrchestrationEvent,
): ReadonlyArray<DagGraph> | undefined => foldDagEvent(dags, event);

export function projectDagEventIntoReadModel(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
): OrchestrationReadModel | undefined {
  const nextDags = foldDagEvent(model.dags ?? [], event);
  if (nextDags === undefined) return undefined;
  return { ...model, dags: nextDags };
}
