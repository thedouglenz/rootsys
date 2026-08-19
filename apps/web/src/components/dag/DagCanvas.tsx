import {
  type DagGraph,
  type DagNodeId,
  DagNodeId as DagNodeIdSchema,
  dagEdgeWouldCreateCycle,
} from "@t3tools/contracts";
import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  Panel,
  ReactFlow,
  type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LayoutGridIcon, PlusIcon, UnlinkIcon } from "lucide-react";
import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from "react";

import { useTheme } from "../../hooks/useTheme";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { DAG_NODE_HEIGHT, DAG_NODE_WIDTH, layoutDag } from "./dagLayout";
import { buildDagNodeViews, dagStructureKey, type DagNodeView } from "./dagModel";
import { DagFlowNodeComponent, type DagFlowNode, type DagFlowNodeData } from "./DagFlowNode";

const NODE_TYPES: NodeTypes = { dagNode: DagFlowNodeComponent };
const EDGE_ID_SEPARATOR = ">";
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 };
const KEY_SEPARATOR = "|";

const edgeId = (from: DagNodeId, to: DagNodeId) => `${from}${EDGE_ID_SEPARATOR}${to}`;
const splitEdgeId = (id: string): readonly [DagNodeId, DagNodeId] | null => {
  const index = id.indexOf(EDGE_ID_SEPARATOR);
  if (index === -1) return null;
  return [
    DagNodeIdSchema.make(id.slice(0, index)),
    DagNodeIdSchema.make(id.slice(index + EDGE_ID_SEPARATOR.length)),
  ];
};

const nodeDataKey = (view: DagNodeView) =>
  [
    view.node.title,
    view.displayStatus,
    view.node.parallelSafe,
    view.node.executionMode,
    view.openQuestionCount,
  ].join(KEY_SEPARATOR);

export interface DagCanvasProps {
  readonly graph: DagGraph;
  readonly selectedNodeId: DagNodeId | null;
  readonly readOnly: boolean;
  readonly onSelectNode: (nodeId: DagNodeId | null) => void;
  readonly onAddEdge: (fromNodeId: DagNodeId, toNodeId: DagNodeId) => void;
  readonly onRemoveEdge: (fromNodeId: DagNodeId, toNodeId: DagNodeId) => void;
  readonly onAddNode: () => void;
}

/**
 * React Flow canvas over a `DagGraph`. Nodes are auto-laid-out with dagre
 * whenever the structure (node ids + edges) changes; positions the user dragged
 * win for the rest of the session and are never persisted.
 */
export function DagCanvas({
  graph,
  selectedNodeId,
  readOnly,
  onSelectNode,
  onAddEdge,
  onRemoveEdge,
  onAddNode,
}: DagCanvasProps) {
  // Manual memoization below (layout keyed on structure, cached node objects
  // via a ref) is deliberate; keep the compiler from second-guessing it.
  "use no memo";
  const { resolvedTheme } = useTheme();
  const [draggedPositions, setDraggedPositions] = useState<ReadonlyMap<string, XYPosition>>(
    () => new Map(),
  );
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const views = useMemo(() => buildDagNodeViews(graph), [graph]);
  const structureKey = dagStructureKey(graph);
  const layout = useMemo(
    () =>
      layoutDag(
        graph.nodes.map((node) => ({
          id: node.nodeId,
          width: DAG_NODE_WIDTH,
          height: DAG_NODE_HEIGHT,
        })),
        graph.edges.map((edge) => ({ from: edge.fromNodeId, to: edge.toNodeId })),
      ),
    // Structure only: status and text edits must not move nodes.
    [structureKey],
  );

  // Node objects must be referentially stable for React Flow to skip
  // re-rendering untouched nodes, so reuse the previous object when nothing
  // it renders has changed.
  const nodeCacheRef = useRef(new Map<string, { key: string; node: DagFlowNode }>());
  const nodes = useMemo(() => {
    const cache = nodeCacheRef.current;
    const next = new Map<string, { key: string; node: DagFlowNode }>();
    const result = views.map((view) => {
      const id = view.node.nodeId;
      const position = draggedPositions.get(id) ?? layout.get(id) ?? { x: 0, y: 0 };
      const selected = id === selectedNodeId;
      const key = [nodeDataKey(view), position.x, position.y, selected, readOnly].join(
        KEY_SEPARATOR,
      );
      const cached = cache.get(id);
      if (cached !== undefined && cached.key === key) {
        next.set(id, cached);
        return cached.node;
      }
      const data: DagFlowNodeData = {
        title: view.node.title,
        displayStatus: view.displayStatus,
        parallelSafe: view.node.parallelSafe,
        executionMode: view.node.executionMode,
        openQuestionCount: view.openQuestionCount,
      };
      const node: DagFlowNode = {
        id,
        type: "dagNode",
        position,
        data,
        selected,
        draggable: !readOnly,
        connectable: !readOnly,
        deletable: false,
      };
      next.set(id, { key, node });
      return node;
    });
    nodeCacheRef.current = next;
    return result;
  }, [draggedPositions, layout, readOnly, selectedNodeId, views]);

  const edges = useMemo<Array<Edge>>(
    () =>
      graph.edges.map((edge) => {
        const id = edgeId(edge.fromNodeId, edge.toNodeId);
        return {
          id,
          source: edge.fromNodeId,
          target: edge.toNodeId,
          selected: id === selectedEdgeId,
          deletable: false,
          focusable: true,
        };
      }),
    [graph.edges, selectedEdgeId],
  );

  const onNodesChange = useCallback(
    (changes: ReadonlyArray<NodeChange<DagFlowNode>>) => {
      for (const change of changes) {
        if (change.type === "position" && change.position !== undefined) {
          const position = change.position;
          setDraggedPositions((previous) => {
            const next = new Map(previous);
            next.set(change.id, position);
            return next;
          });
        } else if (change.type === "select") {
          if (change.selected) {
            onSelectNode(DagNodeIdSchema.make(change.id));
            setSelectedEdgeId(null);
          } else if (change.id === selectedNodeId) {
            onSelectNode(null);
          }
        }
      }
    },
    [onSelectNode, selectedNodeId],
  );

  const onEdgesChange = useCallback(
    (changes: ReadonlyArray<EdgeChange<Edge>>) => {
      for (const change of changes) {
        if (change.type !== "select") continue;
        if (change.selected) {
          setSelectedEdgeId(change.id);
          onSelectNode(null);
        } else {
          setSelectedEdgeId((current) => (current === change.id ? null : current));
        }
      }
    },
    [onSelectNode],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      const from = DagNodeIdSchema.make(connection.source);
      const to = DagNodeIdSchema.make(connection.target);
      if (graph.edges.some((edge) => edge.fromNodeId === from && edge.toNodeId === to)) return;
      if (dagEdgeWouldCreateCycle(graph.edges, from, to)) {
        toastManager.add({
          type: "error",
          title: "That dependency would create a cycle.",
          description: "A node cannot depend, directly or indirectly, on itself.",
        });
        return;
      }
      onAddEdge(from, to);
    },
    [graph.edges, onAddEdge, readOnly],
  );

  const removeSelectedEdge = useCallback(() => {
    if (selectedEdgeId === null || readOnly) return;
    const pair = splitEdgeId(selectedEdgeId);
    if (pair === null) return;
    setSelectedEdgeId(null);
    onRemoveEdge(pair[0], pair[1]);
  }, [onRemoveEdge, readOnly, selectedEdgeId]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (selectedEdgeId === null) return;
      event.preventDefault();
      removeSelectedEdge();
    },
    [removeSelectedEdge, selectedEdgeId],
  );

  const clearSelection = useCallback(() => {
    onSelectNode(null);
    setSelectedEdgeId(null);
  }, [onSelectNode]);

  const resetLayout = useCallback(() => setDraggedPositions(new Map()), []);

  return (
    <div className="relative h-full min-h-0 w-full" onKeyDown={onKeyDown}>
      <ReactFlow<DagFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={clearSelection}
        colorMode={resolvedTheme}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.2}
        maxZoom={1.5}
        deleteKeyCode={null}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
        className="bg-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
        <Panel position="top-left" className="flex items-center gap-1.5">
          {readOnly ? null : (
            <Button type="button" size="sm" variant="outline" onClick={onAddNode}>
              <PlusIcon />
              Add node
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={resetLayout}
                  disabled={draggedPositions.size === 0}
                  aria-label="Reset layout"
                >
                  <LayoutGridIcon />
                </Button>
              }
            />
            <TooltipPopup side="bottom">Reset layout</TooltipPopup>
          </Tooltip>
          {selectedEdgeId !== null && !readOnly ? (
            <Button type="button" size="sm" variant="outline" onClick={removeSelectedEdge}>
              <UnlinkIcon />
              Remove dependency
            </Button>
          ) : null}
        </Panel>
      </ReactFlow>
    </div>
  );
}
