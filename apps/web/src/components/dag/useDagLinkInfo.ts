import { useAtomValue } from "@effect/atom-react";
import {
  buildDagNodeViews,
  EMPTY_ENVIRONMENT_DAG_STATE,
  type EnvironmentDagState,
} from "@t3tools/client-runtime/state/dags";
import type { DagGraph, DagNode, EnvironmentId, ThreadDagLink } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { environmentDags } from "../../state/dags";
import type { DagNodeDisplayStatus } from "./dagModel";

const NO_DAG_ATOM = Atom.make<EnvironmentDagState>(EMPTY_ENVIRONMENT_DAG_STATE).pipe(
  Atom.withLabel("web:dag-link:none"),
);

export interface DagLinkInfo {
  readonly graph: DagGraph | null;
  readonly dagTitle: string | null;
  /** The executor's node; null for planner/companion or while the graph loads. */
  readonly node: DagNode | null;
  readonly nodeTitle: string | null;
  /** Display status of the executor's node; null when there is no node. */
  readonly nodeStatus: DagNodeDisplayStatus | null;
}

const EMPTY_INFO: DagLinkInfo = {
  graph: null,
  dagTitle: null,
  node: null,
  nodeTitle: null,
  nodeStatus: null,
};

/**
 * Resolve what a thread's `dagLink` points at from the live DAG subscription.
 * Threads of one DAG share the subscription, so a sidebar full of executor
 * rows costs one stream per plan, not per row.
 */
export function useDagLinkInfo(
  environmentId: EnvironmentId,
  link: ThreadDagLink | null | undefined,
): DagLinkInfo {
  const state = useAtomValue(
    link ? environmentDags.graphAtom({ environmentId, dagId: link.dagId }) : NO_DAG_ATOM,
  );
  const graph = state.graph;
  const nodeId = link?.nodeId ?? null;
  return useMemo(() => {
    if (!link || graph === null) return EMPTY_INFO;
    const view =
      nodeId === null
        ? null
        : (buildDagNodeViews(graph).find((entry) => entry.node.nodeId === nodeId) ?? null);
    return {
      graph,
      dagTitle: graph.dag.title,
      node: view?.node ?? null,
      nodeTitle: view?.node.title ?? null,
      nodeStatus: view?.displayStatus ?? null,
    };
  }, [graph, link, nodeId]);
}
