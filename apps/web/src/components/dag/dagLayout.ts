/**
 * Auto-layout for the plan canvas: dagre, top to bottom. Pure so it can be
 * unit-tested and so the canvas only re-runs it when the graph structure
 * changes.
 */
import dagre from "@dagrejs/dagre";

export interface DagLayoutNode {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

export interface DagLayoutEdge {
  readonly from: string;
  readonly to: string;
}

export interface DagLayoutPosition {
  readonly x: number;
  readonly y: number;
}

export const DAG_NODE_WIDTH = 240;
export const DAG_NODE_HEIGHT = 88;

/** Top-left positions per node id (React Flow's node origin), laid out top to bottom. */
export function layoutDag(
  nodes: ReadonlyArray<DagLayoutNode>,
  edges: ReadonlyArray<DagLayoutEdge>,
): ReadonlyMap<string, DagLayoutPosition> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 64, marginx: 16, marginy: 16 });
  graph.setDefaultEdgeLabel(() => ({}));
  const known = new Set<string>();
  for (const node of nodes) {
    known.add(node.id);
    graph.setNode(node.id, { width: node.width, height: node.height });
  }
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    graph.setEdge(edge.from, edge.to);
  }
  dagre.layout(graph);
  const positions = new Map<string, DagLayoutPosition>();
  for (const node of nodes) {
    const placed = graph.node(node.id);
    positions.set(node.id, {
      x: placed.x - node.width / 2,
      y: placed.y - node.height / 2,
    });
  }
  return positions;
}
