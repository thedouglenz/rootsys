/**
 * DAG projector (trellis): folds `dag.*` events into the in-memory read
 * model's `dags` slice using the shared contracts fold, and mirrors executor
 * bindings onto the thread (`OrchestrationThread.dagLink`).
 */
import {
  type DagGraph,
  foldDagEvent,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";

/** @deprecated use `foldDagEvent` from contracts; kept for local call sites. */
export const projectDagEvent = (
  dags: ReadonlyArray<DagGraph>,
  event: OrchestrationEvent,
): ReadonlyArray<DagGraph> | undefined => foldDagEvent(dags, event);

/**
 * A `dag.node-status-set` that names a thread binds that thread to the node
 * as its executor. Returns the updated threads list, or the input when the
 * event carries no binding or the thread is unknown to the read model.
 */
function bindExecutorThread(
  threads: ReadonlyArray<OrchestrationThread>,
  event: OrchestrationEvent,
): ReadonlyArray<OrchestrationThread> {
  if (event.type !== "dag.node-status-set") return threads;
  const { dagId, nodeId, threadId } = event.payload;
  if (!threadId) return threads;
  const index = threads.findIndex((thread) => thread.id === threadId);
  if (index === -1) return threads;
  const existing = threads[index]!;
  const dagLink = { dagId, nodeId, role: "executor" as const };
  if (
    existing.dagLink?.dagId === dagLink.dagId &&
    existing.dagLink.nodeId === dagLink.nodeId &&
    existing.dagLink.role === dagLink.role
  ) {
    return threads;
  }
  const next = threads.slice();
  next[index] = { ...existing, dagLink };
  return next;
}

export function projectDagEventIntoReadModel(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
): OrchestrationReadModel | undefined {
  const nextDags = foldDagEvent(model.dags ?? [], event);
  if (nextDags === undefined) return undefined;
  return { ...model, dags: nextDags, threads: bindExecutorThread(model.threads, event) };
}
