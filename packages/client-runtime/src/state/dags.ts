/**
 * DAG state (rootsys): per-DAG live graph via `orchestration.subscribeDag`
 * (snapshot + raw `dag.*` events folded with the shared contracts fold), a
 * list query, and command atoms. Shared by web and mobile.
 */
import {
  type DagCommand,
  type DagGraph,
  type DagId,
  type DagNode,
  type DagNodeId,
  type DagNodeStatus,
  type DagStatus,
  type EnvironmentId,
  foldDagEvent,
  ORCHESTRATION_WS_METHODS,
  type OrchestrationDagStreamItem,
  readyDagNodes,
} from "@t3tools/contracts";
import type * as Crypto from "effect/Crypto";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { type DagCommandInput, dispatchDagCommand } from "../operations/dagCommands.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export type EnvironmentDagStatus = "loading" | "live" | "deleted";

export interface EnvironmentDagState {
  readonly graph: DagGraph | null;
  readonly status: EnvironmentDagStatus;
  readonly snapshotSequence: number;
}

export const EMPTY_ENVIRONMENT_DAG_STATE: EnvironmentDagState = {
  graph: null,
  status: "loading",
  snapshotSequence: 0,
};

/** Fold one stream item into the DAG state. Exported for tests. */
export function applyDagStreamItem(
  state: EnvironmentDagState,
  item: OrchestrationDagStreamItem,
): EnvironmentDagState {
  switch (item.kind) {
    case "synchronized":
      return state.status === "loading" ? { ...state, status: "live" } : state;
    case "snapshot":
      return {
        graph: item.snapshot.graph,
        status: "live",
        snapshotSequence: item.snapshot.snapshotSequence,
      };
    case "event": {
      const { event } = item;
      if (event.sequence <= state.snapshotSequence) return state;
      if (event.type === "dag.deleted") {
        return { graph: null, status: "deleted", snapshotSequence: event.sequence };
      }
      const next = foldDagEvent(state.graph === null ? [] : [state.graph], event);
      if (next === undefined) return { ...state, snapshotSequence: event.sequence };
      return {
        graph: next[0] ?? null,
        status: state.status === "loading" ? "live" : state.status,
        snapshotSequence: event.sequence,
      };
    }
  }
}

const DAG_KEY_SEPARATOR = "\u001f";

export function createEnvironmentDagAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
) {
  const stateFamily = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:dag:state",
    tag: ORCHESTRATION_WS_METHODS.subscribeDag,
    idleTtlMs: 60_000,
    transform: (stream) =>
      stream.pipe(Stream.scan(EMPTY_ENVIRONMENT_DAG_STATE, applyDagStreamItem)),
  });
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:dag:list",
    tag: ORCHESTRATION_WS_METHODS.listDags,
    staleTimeMs: 5_000,
    idleTtlMs: 60_000,
  });
  const timeline = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:dag:timeline",
    tag: ORCHESTRATION_WS_METHODS.getDagTimeline,
    staleTimeMs: 5_000,
    idleTtlMs: 60_000,
  });
  const graphFamily = Atom.family((key: string) => {
    const [environmentId, dagId] = key.split(DAG_KEY_SEPARATOR) as [EnvironmentId, DagId];
    return Atom.make((get): EnvironmentDagState => {
      const result = get(stateFamily({ environmentId, input: { dagId } }));
      return Option.getOrElse(AsyncResult.value(result), () => EMPTY_ENVIRONMENT_DAG_STATE);
    }).pipe(Atom.setIdleTTL(60_000), Atom.withLabel(`environment-data:dag:graph:${key}`));
  });
  return {
    /** Raw AsyncResult stream state (errors visible). */
    stateAtom: stateFamily,
    /** Convenience: latest folded state, or the empty state while loading. */
    graphAtom: (target: { readonly environmentId: EnvironmentId; readonly dagId: DagId }) =>
      graphFamily(`${target.environmentId}${DAG_KEY_SEPARATOR}${target.dagId}`),
    listAtom: list,
    /** Run log (`orchestration.getDagTimeline`); re-query by changing the input key. */
    timelineAtom: timeline,
  };
}

/**
 * Discriminated DAG command payload for the command atom: the wire command
 * minus the envelope (`commandId`/`createdAt`), keyed by `type` so call sites
 * get per-command field checking.
 */
export type DagCommandDispatchInput = {
  [T in DagCommand["type"]]: { readonly type: T } & DagCommandInput<T>;
}[DagCommand["type"]];

/**
 * One command atom for every DAG command. Dispatches serially per DAG so the
 * server sees edits in the order the user made them.
 */
export function createDagCommandAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
) {
  return {
    dispatch: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:dag:dispatch",
      execute: (input: DagCommandDispatchInput) => dispatchDagCommand(input.type, input),
      scheduler: createAtomCommandScheduler(),
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) => JSON.stringify([environmentId, input.dagId]),
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Pure view helpers shared by the web and mobile Plans surfaces.
// ---------------------------------------------------------------------------

/** Stored node status plus the derived `ready` state the UI shows. */
export type DagNodeDisplayStatus = DagNodeStatus | "ready";

export interface DagNodeView {
  readonly node: DagNode;
  readonly displayStatus: DagNodeDisplayStatus;
  readonly openQuestionCount: number;
}

export function buildDagNodeViews(graph: DagGraph): ReadonlyArray<DagNodeView> {
  const ready = new Set(readyDagNodes(graph).map((node) => node.nodeId));
  const openQuestions = new Map<DagNodeId, number>();
  for (const question of graph.questions) {
    if (question.status !== "open") continue;
    openQuestions.set(question.nodeId, (openQuestions.get(question.nodeId) ?? 0) + 1);
  }
  return graph.nodes.map((node) => ({
    node,
    displayStatus: ready.has(node.nodeId) ? "ready" : node.status,
    openQuestionCount: openQuestions.get(node.nodeId) ?? 0,
  }));
}

export type DagRunBlocker = "no-nodes" | "no-model" | "no-project";

/**
 * Why the Run button is disabled, or null when the DAG can start. Mirrors
 * the engine's launch checks (project + resolvable model) so the UI never
 * offers a run the engine would immediately pause.
 */
export function resolveDagRunBlocker(input: {
  readonly graph: DagGraph;
  readonly projectDefaultModelSelection: DagGraph["dag"]["defaultModelSelection"];
}): DagRunBlocker | null {
  const { graph } = input;
  if (graph.nodes.length === 0) return "no-nodes";
  const needsPrimaryProject = graph.nodes.some((node) => node.projectId === null);
  if (needsPrimaryProject && graph.dag.primaryProjectId === null) return "no-project";
  const fallbackModel = graph.dag.defaultModelSelection ?? input.projectDefaultModelSelection;
  if (fallbackModel === null && graph.nodes.some((node) => node.modelSelection === null)) {
    return "no-model";
  }
  return null;
}

export const DAG_RUN_BLOCKER_HINTS: Record<DagRunBlocker, string> = {
  "no-nodes": "Add at least one node before running.",
  "no-model": "Pick a default model so nodes know which agent to run with.",
  "no-project": "This plan needs a project to run in.",
};

/** Which primary status action the header offers for a DAG status. */
export type DagRunAction = "run" | "pause" | "resume" | null;

export function resolveDagRunAction(status: DagStatus): DagRunAction {
  switch (status) {
    case "draft":
    case "ready":
    case "failed":
    case "completed":
      return "run";
    case "running":
      return "pause";
    case "paused":
      return "resume";
    case "archived":
      return null;
  }
}

/**
 * The primary control the plan header shows. `finished` is the status action
 * refined by what is left to do: every node is done or skipped, so Run would
 * start nothing and the header shows a label instead. Reopening a node puts
 * it back to `pending`, and the action becomes `run` again.
 */
export type DagPrimaryAction = DagRunAction | "finished";

/** True while some node could still run: anything not done or skipped. */
export function hasRunnableDagNodes(graph: Pick<DagGraph, "nodes">): boolean {
  return graph.nodes.some((node) => node.status !== "done" && node.status !== "skipped");
}

export function resolveDagPrimaryAction(graph: Pick<DagGraph, "dag" | "nodes">): DagPrimaryAction {
  const action = resolveDagRunAction(graph.dag.status);
  // An empty plan keeps Run (disabled, with the "add a node" hint) rather
  // than claiming to be finished.
  if (action !== "run" || graph.nodes.length === 0) return action;
  return hasRunnableDagNodes(graph) ? "run" : "finished";
}
