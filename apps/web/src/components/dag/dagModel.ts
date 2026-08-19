/**
 * Pure view helpers for the Plans surface. Everything here derives from a
 * `DagGraph` and carries no React Flow or React dependency, so the canvas,
 * panel, and list can share one notion of "ready", open-question counts,
 * and node ids.
 */
import type { DagGraph } from "@t3tools/contracts";
import { DagNodeId } from "@t3tools/contracts";

export {
  buildDagNodeViews,
  DAG_RUN_BLOCKER_HINTS,
  type DagNodeDisplayStatus,
  type DagNodeView,
  type DagRunAction,
  type DagRunBlocker,
  resolveDagRunAction,
  resolveDagRunBlocker,
} from "@t3tools/client-runtime/state/dags";

/**
 * Structure-only fingerprint: node ids and edges. Used to decide when the
 * auto-layout must run again; status/title edits do not move nodes.
 */
export function dagStructureKey(graph: Pick<DagGraph, "nodes" | "edges">): string {
  const nodeIds = graph.nodes.map((node) => node.nodeId).sort();
  const edges = graph.edges.map((edge) => `${edge.fromNodeId}>${edge.toNodeId}`).sort();
  return `${nodeIds.join(",")}|${edges.join(",")}`;
}

const NODE_ID_RANDOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

/**
 * Mint a node id from its title: a readable slug plus a short random suffix so
 * two nodes with the same title never collide. `random` is injectable for tests.
 */
export function mintDagNodeId(title: string, random: () => number = Math.random): DagNodeId {
  const slug = slugify(title) || "node";
  let suffix = "";
  for (let index = 0; index < 6; index += 1) {
    suffix += NODE_ID_RANDOM_ALPHABET[Math.floor(random() * NODE_ID_RANDOM_ALPHABET.length)];
  }
  return DagNodeId.make(`${slug}-${suffix}`);
}

export function upstreamNodeIds(
  graph: Pick<DagGraph, "edges">,
  nodeId: DagNodeId,
): ReadonlyArray<DagNodeId> {
  return graph.edges.filter((edge) => edge.toNodeId === nodeId).map((edge) => edge.fromNodeId);
}
