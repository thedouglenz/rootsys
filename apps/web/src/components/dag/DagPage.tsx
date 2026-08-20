import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { DagId, DagNodeId, EnvironmentId } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { environmentDags } from "../../state/dags";
import { useProjects } from "../../state/entities";
import { useEnvironmentPresentation } from "../../state/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { buildThreadRouteParams } from "../../threadRoutes";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";
import { DagHeader } from "./DagHeader";
import { mintDagNodeId } from "./dagModel";
import { DagNodePanel } from "./DagNodePanel";
import { DagQuestionInbox } from "./DagQuestionInbox";
import { DagTimeline } from "./DagTimeline";
import { useDagDispatch } from "./useDagDispatch";

// React Flow and dagre only load when a canvas is actually opened.
const DagCanvas = lazy(() =>
  import("./DagCanvas").then((module) => ({ default: module.DagCanvas })),
);

function PlanChrome({ title, children }: { title: string | null; children: React.ReactNode }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          className={cn(
            "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center px-3 sm:px-5",
            isElectron &&
              "drag-region wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <WorkspaceBreadcrumb ariaLabel="Plan breadcrumb">
            <WorkspaceBreadcrumbItem>
              <Link to="/plans" className="hover:text-foreground">
                Plans
              </Link>
            </WorkspaceBreadcrumbItem>
            {title !== null ? (
              <>
                <WorkspaceBreadcrumbSeparator />
                <WorkspaceBreadcrumbItem current>
                  <h1 className="truncate">{title}</h1>
                </WorkspaceBreadcrumbItem>
              </>
            ) : null}
          </WorkspaceBreadcrumb>
        </div>
        {children}
      </div>
    </SidebarInset>
  );
}

function CenteredState({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center p-6">{children}</div>;
}

export function DagPage({
  environmentId,
  dagId,
  initialNodeId = null,
}: {
  environmentId: EnvironmentId;
  dagId: DagId;
  /** Node to open in the side panel on arrival (`?node=` on the route). */
  initialNodeId?: DagNodeId | null;
}) {
  const navigate = useNavigate();
  const { isReady: catalogReady, presentation: environment } =
    useEnvironmentPresentation(environmentId);
  const subscription = useEnvironmentQuery(
    environmentDags.stateAtom({ environmentId, input: { dagId } }),
  );
  const state = subscription.data;
  const dispatch = useDagDispatch(environmentId);
  const allProjects = useProjects();
  const projects = useMemo(
    () => allProjects.filter((project) => project.environmentId === environmentId),
    [allProjects, environmentId],
  );
  const [selectedNodeId, setSelectedNodeId] = useState<DagNodeId | null>(initialNodeId);
  useEffect(() => {
    if (initialNodeId !== null) setSelectedNodeId(initialNodeId);
  }, [initialNodeId]);
  const graph = state?.graph ?? null;
  const selectedNode = useMemo(
    () => graph?.nodes.find((node) => node.nodeId === selectedNodeId) ?? null,
    [graph, selectedNodeId],
  );
  const goToList = useCallback(() => void navigate({ to: "/plans" }), [navigate]);
  // Double-click on the canvas jumps to the node's executor thread; nodes that
  // have not started yet keep the panel open and do nothing.
  const openNodeThread = useCallback(
    (nodeId: DagNodeId) => {
      const threadId = graph?.nodes.find((node) => node.nodeId === nodeId)?.threadId ?? null;
      if (threadId === null) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
      });
    },
    [environmentId, graph, navigate],
  );

  const addNode = useCallback(async () => {
    if (graph === null) return;
    const nodeId = mintDagNodeId("New node");
    const ok = await dispatch({ type: "dag.node.upsert", dagId, nodeId, title: "New node" });
    if (ok) setSelectedNodeId(nodeId);
  }, [dagId, dispatch, graph]);
  const addEdge = useCallback(
    (fromNodeId: DagNodeId, toNodeId: DagNodeId) =>
      void dispatch({ type: "dag.edge.add", dagId, fromNodeId, toNodeId }),
    [dagId, dispatch],
  );
  const removeEdge = useCallback(
    (fromNodeId: DagNodeId, toNodeId: DagNodeId) =>
      void dispatch({ type: "dag.edge.remove", dagId, fromNodeId, toNodeId }),
    [dagId, dispatch],
  );

  if (environment === null && catalogReady) {
    return (
      <PlanChrome title={null}>
        <CenteredState>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Environment not connected</EmptyTitle>
              <EmptyDescription>
                This plan lives on a server that is not connected right now.
              </EmptyDescription>
            </EmptyHeader>
            <Button type="button" size="sm" variant="outline" onClick={goToList}>
              Back to plans
            </Button>
          </Empty>
        </CenteredState>
      </PlanChrome>
    );
  }

  if (
    state?.status === "deleted" ||
    (state?.status === "live" && graph === null) ||
    subscription.error !== null
  ) {
    return (
      <PlanChrome title={null}>
        <CenteredState>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Plan not found</EmptyTitle>
              <EmptyDescription>
                {state?.status === "deleted" ? "It was deleted." : "It may have been deleted."}
              </EmptyDescription>
            </EmptyHeader>
            <Button type="button" size="sm" variant="outline" onClick={goToList}>
              Back to plans
            </Button>
          </Empty>
        </CenteredState>
      </PlanChrome>
    );
  }

  if (graph === null) {
    return (
      <PlanChrome title={null}>
        <CenteredState>
          <Spinner className="size-5" />
        </CenteredState>
      </PlanChrome>
    );
  }

  const readOnly = graph.dag.status === "archived";

  return (
    <PlanChrome title={graph.dag.title}>
      <DagHeader
        environmentId={environmentId}
        graph={graph}
        projects={projects}
        dispatch={dispatch}
        onDeleted={goToList}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <Suspense
              fallback={
                <CenteredState>
                  <Spinner className="size-5" />
                </CenteredState>
              }
            >
              <DagCanvas
                graph={graph}
                selectedNodeId={selectedNodeId}
                readOnly={readOnly}
                onSelectNode={setSelectedNodeId}
                onOpenNodeThread={openNodeThread}
                onAddEdge={addEdge}
                onRemoveEdge={removeEdge}
                onAddNode={() => void addNode()}
              />
            </Suspense>
          </div>
          <DagQuestionInbox graph={graph} dispatch={dispatch} />
          <DagTimeline
            environmentId={environmentId}
            graph={graph}
            snapshotSequence={state?.snapshotSequence ?? 0}
          />
        </div>
        {selectedNode ? (
          <DagNodePanel
            key={selectedNode.nodeId}
            environmentId={environmentId}
            graph={graph}
            node={selectedNode}
            readOnly={readOnly}
            dispatch={dispatch}
            onClose={() => setSelectedNodeId(null)}
          />
        ) : null}
      </div>
    </PlanChrome>
  );
}
