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
  type ReactFlowInstance,
  useReactFlow,
  useStore,
  type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LayoutGridIcon, PlusIcon, UnlinkIcon } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useTheme } from "../../hooks/useTheme";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { DAG_NODE_HEIGHT, DAG_NODE_WIDTH, layoutDag } from "./dagLayout";
import { buildDagNodeViews, dagStructureKey, type DagNodeView } from "./dagModel";
import { DagFlowNodeComponent, type DagFlowNode, type DagFlowNodeData } from "./DagFlowNode";

const NODE_TYPES: NodeTypes = { dagNode: DagFlowNodeComponent };
const EDGE_ID_SEPARATOR = ">";
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 };
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.5;
/** Zoom used when a compact canvas cannot fit the whole graph and centers on the current node. */
const FOCUS_ZOOM = 0.75;
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
  /** Node the surrounding surface is "at" (e.g. the thread's own node); drawn with its own ring. */
  readonly currentNodeId?: DagNodeId | null;
  readonly readOnly: boolean;
  /**
   * Side-panel presentation: refits on container resize, centers on
   * `currentNodeId` when the graph does not fit, smaller controls, no toolbar.
   */
  readonly compact?: boolean;
  readonly onSelectNode: (nodeId: DagNodeId | null) => void;
  /**
   * Double-click on a node. The parent decides what "open" means (usually
   * navigating to the node's executor thread) and ignores nodes without one.
   */
  readonly onOpenNodeThread?: (nodeId: DagNodeId) => void;
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
  currentNodeId = null,
  readOnly,
  compact = false,
  onSelectNode,
  onOpenNodeThread,
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
      const isCurrent = id === currentNodeId;
      const key = [nodeDataKey(view), position.x, position.y, selected, isCurrent, readOnly].join(
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
        isCurrent,
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
  }, [currentNodeId, draggedPositions, layout, readOnly, selectedNodeId, views]);

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

  // Double-click opens the node's thread. `zoomOnDoubleClick` is off below so
  // this never fights the canvas zoom.
  const onNodeDoubleClick = useCallback(
    (_event: MouseEvent, node: DagFlowNode) => {
      onOpenNodeThread?.(DagNodeIdSchema.make(node.id));
    },
    [onOpenNodeThread],
  );

  const clearSelection = useCallback(() => {
    onSelectNode(null);
    setSelectedEdgeId(null);
  }, [onSelectNode]);

  const resetLayout = useCallback(() => setDraggedPositions(new Map()), []);

  // Compact canvases start centered on the current node when fit-to-view had
  // to bottom out at min zoom (the graph is bigger than the panel). Layout is
  // read through a render-synced ref so the mount-time callback sees the
  // latest positions without re-registering on every layout change.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const onInit = useCallback(
    (instance: ReactFlowInstance<DagFlowNode, Edge>) => {
      if (!compact || currentNodeId === null) return;
      if (instance.getZoom() > MIN_ZOOM + 1e-3) return;
      const position = layoutRef.current.get(currentNodeId);
      if (position === undefined) return;
      void instance.setCenter(position.x + DAG_NODE_WIDTH / 2, position.y + DAG_NODE_HEIGHT / 2, {
        zoom: FOCUS_ZOOM,
        duration: 0,
      });
    },
    [compact, currentNodeId],
  );

  return (
    <div className="relative h-full min-h-0 w-full" onKeyDown={onKeyDown}>
      <ReactFlow<DagFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={clearSelection}
        onInit={onInit}
        colorMode={resolvedTheme}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
        className="bg-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls
          showInteractive={false}
          position="bottom-left"
          className={cn(compact && "[&_button]:!size-6")}
        />
        {compact ? <RefitOnResize /> : null}
        {compact ? null : (
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
            {onOpenNodeThread === undefined ? null : (
              <span className="pl-1 text-xs text-muted-foreground">
                Double-click a node to open its thread
              </span>
            )}
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

/**
 * Refits the viewport whenever React Flow's own container measurement
 * changes after mount (the initial fit and any current-node centering are
 * handled by `fitView` / `onInit`). Must render inside `<ReactFlow>` to reach
 * its store.
 */
function RefitOnResize() {
  const { fitView } = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const measuredOnceRef = useRef(false);
  useEffect(() => {
    if (width === 0 || height === 0) return;
    if (!measuredOnceRef.current) {
      measuredOnceRef.current = true;
      return;
    }
    void fitView(FIT_VIEW_OPTIONS);
  }, [fitView, height, width]);
  return null;
}
