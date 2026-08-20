/**
 * Right-panel "Plan" surface: the DAG a thread belongs to, beside the
 * transcript. A List / Canvas segmented toggle (remembered globally) picks
 * between a compact topological node list and the read-only canvas, which
 * is the default.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  DagGraph,
  DagNodeId,
  EnvironmentId,
  ThreadDagLink,
  ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { ExternalLinkIcon, ListIcon, MessageCircleQuestionIcon, WorkflowIcon } from "lucide-react";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { buildDagNodeViews, type DagNodeView } from "./dagModel";
import { DagQuestionInbox } from "./DagQuestionInbox";
import { DagNodeStatusBadge, DagStatusBadge } from "./DagStatusBadge";
import { DAG_NODE_STATUS_DOT_CLASS, dagProgress, topologicalDagNodes } from "./dagThreadLink";
import { useDagDispatch } from "./useDagDispatch";
import { useDagLinkInfo } from "./useDagLinkInfo";

const DagCanvas = lazy(() =>
  import("./DagCanvas").then((module) => ({ default: module.DagCanvas })),
);

const noop = () => undefined;

const PLAN_PANEL_VIEW_KEY = "t3code:plan-panel:view";
const PlanPanelView = Schema.Literals(["list", "canvas"]);
type PlanPanelView = typeof PlanPanelView.Type;

function SidePanelMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

const NodeListRow = memo(function NodeListRow({
  view,
  isCurrent,
  onOpenThread,
}: {
  view: DagNodeView;
  isCurrent: boolean;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (isCurrent) ref.current?.scrollIntoView({ block: "nearest" });
  }, [isCurrent]);
  const { node } = view;
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          DAG_NODE_STATUS_DOT_CLASS[view.displayStatus],
        )}
      />
      <span className="min-w-0 flex-1 truncate">{node.title}</span>
      {view.openQuestionCount > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-destructive-foreground">
          <MessageCircleQuestionIcon aria-hidden className="size-3" />
          {view.openQuestionCount}
        </span>
      ) : null}
      <DagNodeStatusBadge status={view.displayStatus} />
    </>
  );
  const rowClass = cn(
    "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm",
    isCurrent ? "bg-accent text-foreground" : "text-foreground/85",
  );
  return (
    <li ref={ref} className="list-none" aria-current={isCurrent ? "true" : undefined}>
      {node.threadId !== null ? (
        <button
          type="button"
          onClick={() => onOpenThread(node.threadId!)}
          className={cn(rowClass, "cursor-pointer hover:bg-accent")}
          aria-label={`Open thread for ${node.title}`}
        >
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
});

function NodeList({
  graph,
  currentNodeId,
  onOpenThread,
}: {
  graph: DagGraph;
  currentNodeId: DagNodeId | null;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const views = useMemo(() => {
    const byId = new Map(buildDagNodeViews(graph).map((view) => [view.node.nodeId, view] as const));
    return topologicalDagNodes(graph).flatMap((node) => {
      const view = byId.get(node.nodeId);
      return view === undefined ? [] : [view];
    });
  }, [graph]);
  if (views.length === 0) {
    return <SidePanelMessage>This plan has no nodes yet.</SidePanelMessage>;
  }
  return (
    <ul className="flex flex-col gap-px p-2">
      {views.map((view) => (
        <NodeListRow
          key={view.node.nodeId}
          view={view}
          isCurrent={view.node.nodeId === currentNodeId}
          onOpenThread={onOpenThread}
        />
      ))}
    </ul>
  );
}

export function DagSidePanel({
  environmentId,
  threadId,
  dagLink,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  dagLink: ThreadDagLink | null;
}) {
  const navigate = useNavigate();
  const info = useDagLinkInfo(environmentId, dagLink);
  const dispatch = useDagDispatch(environmentId);
  const [mode, setMode] = useLocalStorage<PlanPanelView, PlanPanelView>(
    PLAN_PANEL_VIEW_KEY,
    "canvas",
    PlanPanelView,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<DagNodeId | null>(null);
  const graph = info.graph;

  const openThread = useCallback(
    (target: ThreadId) => {
      if (target === threadId) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, target)),
      });
    },
    [environmentId, navigate, threadId],
  );
  const openInPlans = useCallback(() => {
    if (!dagLink) return;
    void navigate({
      to: "/plans/$environmentId/$dagId",
      params: { environmentId, dagId: dagLink.dagId },
      search: dagLink.nodeId === null ? {} : { node: dagLink.nodeId },
    });
  }, [dagLink, environmentId, navigate]);
  // Canvas selection in the side panel is navigation, not editing: a node
  // with a thread opens that thread; anything else just highlights.
  const selectCanvasNode = useCallback(
    (nodeId: DagNodeId | null) => {
      setSelectedNodeId(nodeId);
      if (nodeId === null || graph === null) return;
      const target = graph.nodes.find((node) => node.nodeId === nodeId)?.threadId ?? null;
      if (target !== null) openThread(target);
    },
    [graph, openThread],
  );

  if (!dagLink) {
    return <SidePanelMessage>This thread is not part of a plan.</SidePanelMessage>;
  }
  if (graph === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  const progress = dagProgress(graph);
  const runningWhilePaused =
    graph.dag.status === "paused" && graph.nodes.some((node) => node.status === "running");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-start gap-2">
          <WorkflowIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <h2 className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-5">
            {graph.dag.title}
          </h2>
          <DagStatusBadge status={graph.dag.status} className="shrink-0" />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 tabular-nums">
            {progress.done}/{progress.total} done
          </span>
          <ToggleGroup
            className="shrink-0"
            variant="outline"
            size="xs"
            aria-label="Plan view"
            value={[mode]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "list" || next === "canvas") setMode(next);
            }}
          >
            <Toggle value="list" className="px-2">
              <ListIcon />
              List
            </Toggle>
            <Toggle value="canvas" className="px-2">
              <WorkflowIcon />
              Canvas
            </Toggle>
          </ToggleGroup>
          <span className="flex-1" />
          <Button type="button" size="xs" variant="outline" onClick={openInPlans}>
            <ExternalLinkIcon />
            Open in Plans
          </Button>
        </div>
        {runningWhilePaused ? (
          <p className="text-xs text-muted-foreground">
            Pause requested — the current node will finish first.
          </p>
        ) : null}
      </header>
      <DagQuestionInbox graph={graph} dispatch={dispatch} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {mode === "list" ? (
          <NodeList graph={graph} currentNodeId={dagLink.nodeId} onOpenThread={openThread} />
        ) : (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Spinner className="size-5" />
              </div>
            }
          >
            <div className="h-full min-h-64">
              <DagCanvas
                graph={graph}
                selectedNodeId={selectedNodeId}
                currentNodeId={dagLink.nodeId}
                readOnly
                compact
                onSelectNode={selectCanvasNode}
                // Single click here already navigates; double-click is a no-op repeat.
                onOpenNodeThread={selectCanvasNode}
                onAddEdge={noop}
                onRemoveEdge={noop}
                onAddNode={noop}
              />
            </div>
          </Suspense>
        )}
      </div>
    </div>
  );
}
