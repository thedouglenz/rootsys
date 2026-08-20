import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type DagGraph,
  type DagNode,
  type DagNodeExecutionMode,
  DagNodeId,
  dagEdgeWouldCreateCycle,
  type EnvironmentId,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { buildDagNodeViews, upstreamNodeIds } from "./dagModel";
import { DagNodeStatusBadge } from "./DagStatusBadge";
import type { DagDispatch } from "./useDagDispatch";

const EXECUTION_MODES: ReadonlyArray<{ value: DagNodeExecutionMode; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "turn", label: "Single turn" },
  { value: "workflow", label: "Workflow" },
];

/**
 * Text field draft that follows live server updates until the user edits it.
 * Once dirty it keeps the user's text; a save that round-trips resets it.
 */
function useDraftField(value: string) {
  const [state, setState] = useState({ base: value, draft: value });
  if (state.base !== value) {
    setState(
      state.draft === state.base ? { base: value, draft: value } : { ...state, base: value },
    );
  }
  return [state.draft, (draft: string) => setState((s) => ({ ...s, draft }))] as const;
}

export interface DagNodePanelProps {
  readonly environmentId: EnvironmentId;
  readonly graph: DagGraph;
  readonly node: DagNode;
  readonly readOnly: boolean;
  readonly dispatch: DagDispatch;
  readonly onClose: () => void;
}

export function DagNodePanel({
  environmentId,
  graph,
  node,
  readOnly,
  dispatch,
  onClose,
}: DagNodePanelProps) {
  const dagId = graph.dag.dagId;
  const [title, setTitle] = useDraftField(node.title);
  const [description, setDescription] = useDraftField(node.description);
  const [acceptance, setAcceptance] = useDraftField(node.acceptance ?? "");

  const view = useMemo(
    () => buildDagNodeViews(graph).find((candidate) => candidate.node.nodeId === node.nodeId),
    [graph, node.nodeId],
  );
  const dependsOn = useMemo(() => upstreamNodeIds(graph, node.nodeId), [graph, node.nodeId]);
  const nodeTitle = useMemo(
    () => new Map(graph.nodes.map((candidate) => [candidate.nodeId, candidate.title] as const)),
    [graph.nodes],
  );
  const addableDependencies = useMemo(
    () =>
      graph.nodes.filter(
        (candidate) =>
          candidate.nodeId !== node.nodeId &&
          !dependsOn.includes(candidate.nodeId) &&
          !dagEdgeWouldCreateCycle(graph.edges, candidate.nodeId, node.nodeId),
      ),
    [dependsOn, graph.edges, graph.nodes, node.nodeId],
  );

  const saveTitle = () => {
    const trimmed = title.trim();
    if (trimmed.length === 0 || trimmed === node.title) return;
    void dispatch({ type: "dag.node.upsert", dagId, nodeId: node.nodeId, title: trimmed });
  };
  const saveDescription = () => {
    if (description === node.description) return;
    void dispatch({ type: "dag.node.upsert", dagId, nodeId: node.nodeId, description });
  };
  const saveAcceptance = () => {
    const next = acceptance.trim().length === 0 ? null : acceptance;
    if (next === node.acceptance) return;
    void dispatch({ type: "dag.node.upsert", dagId, nodeId: node.nodeId, acceptance: next });
  };

  const setStatus = (status: DagNode["status"], threadId?: null) =>
    dispatch({
      type: "dag.node.status.set",
      dagId,
      nodeId: node.nodeId,
      status,
      ...(threadId === null ? { threadId: null } : {}),
    });

  // Re-queues the node and gets the plan moving again. Offered for failed
  // nodes (the usual case) and for nodes stuck in running/blocked: a node
  // whose executor session died — server restart, crashed provider — keeps
  // its status forever, and the serial scheduler will not pass it.
  const retry = async () => {
    if (node.status === "running" || node.status === "blocked") {
      const confirmed = await requestConfirmDialog(
        `Restart node "${node.title}"?\nIf its executor is still working, that work is abandoned and a new thread starts from the node's description.`,
      );
      if (confirmed === false) return;
    }
    const ok = await setStatus("pending", null);
    if (!ok || graph.dag.status === "running") return;
    await dispatch({ type: "dag.status.set", dagId, status: "running" });
  };

  const deleteNode = async () => {
    const confirmed = await requestConfirmDialog(
      `Delete node "${node.title}"?\nIts dependencies and open questions are removed too.`,
      { variant: "destructive" },
    );
    if (confirmed === false) return;
    const ok = await dispatch({ type: "dag.node.delete", dagId, nodeId: node.nodeId });
    if (ok) onClose();
  };

  const executing = node.status === "running" || node.status === "blocked";

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-border bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          {view ? <DagNodeStatusBadge status={view.displayStatus} /> : null}
          <span className="truncate text-xs text-muted-foreground">{node.nodeId}</span>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-3">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Title</span>
            <Input
              value={title}
              disabled={readOnly}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={saveTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Description</span>
            <Textarea
              size="sm"
              value={description}
              disabled={readOnly}
              placeholder="What to change and where."
              onChange={(event) => setDescription(event.target.value)}
              onBlur={saveDescription}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Acceptance</span>
            <Textarea
              size="sm"
              value={acceptance}
              disabled={readOnly}
              placeholder="How the executor proves it is done."
              onChange={(event) => setAcceptance(event.target.value)}
              onBlur={saveAcceptance}
            />
          </label>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium">Parallel safe</p>
              <p className="text-xs text-muted-foreground">
                Touches no files a concurrently runnable sibling touches.
              </p>
            </div>
            <Switch
              checked={node.parallelSafe}
              disabled={readOnly}
              onCheckedChange={(parallelSafe) =>
                void dispatch({ type: "dag.node.upsert", dagId, nodeId: node.nodeId, parallelSafe })
              }
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium">Execution</p>
            <Select
              value={node.executionMode}
              disabled={readOnly}
              onValueChange={(value) => {
                if (value === null || value === node.executionMode) return;
                void dispatch({
                  type: "dag.node.upsert",
                  dagId,
                  nodeId: node.nodeId,
                  executionMode: value,
                });
              }}
            >
              <SelectTrigger size="sm" className="w-36" aria-label="Execution mode">
                <SelectValue>
                  {EXECUTION_MODES.find((mode) => mode.value === node.executionMode)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {EXECUTION_MODES.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <p className="text-xs font-medium">Depends on</p>
            <div className="flex flex-wrap gap-1">
              {dependsOn.length === 0 ? (
                <span className="text-xs text-muted-foreground">Nothing. Starts first.</span>
              ) : (
                dependsOn.map((fromNodeId) => (
                  <Badge key={fromNodeId} variant="outline" className="max-w-full gap-1">
                    <span className="truncate">{nodeTitle.get(fromNodeId) ?? fromNodeId}</span>
                    {readOnly ? null : (
                      <button
                        type="button"
                        aria-label="Remove dependency"
                        className="rounded-xs text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          void dispatch({
                            type: "dag.edge.remove",
                            dagId,
                            fromNodeId,
                            toNodeId: node.nodeId,
                          })
                        }
                      >
                        <XIcon className="size-3" />
                      </button>
                    )}
                  </Badge>
                ))
              )}
            </div>
            {readOnly || addableDependencies.length === 0 ? null : (
              <Select
                value={null}
                onValueChange={(value) => {
                  if (value === null) return;
                  void dispatch({
                    type: "dag.edge.add",
                    dagId,
                    fromNodeId: DagNodeId.make(value),
                    toNodeId: node.nodeId,
                  });
                }}
              >
                <SelectTrigger size="sm" aria-label="Add dependency">
                  <SelectValue placeholder="Add dependency" />
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {addableDependencies.map((candidate) => (
                    <SelectItem key={candidate.nodeId} value={candidate.nodeId}>
                      {candidate.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            )}
          </div>

          {node.outcome?.summary || node.threadId ? (
            <div className="grid gap-1.5 rounded-lg border border-border bg-muted/30 p-2.5">
              <p className="text-xs font-medium">Outcome</p>
              {node.outcome?.summary ? (
                <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                  {node.outcome.summary}
                </p>
              ) : null}
              {node.threadId ? (
                <Link
                  to="/$environmentId/$threadId"
                  params={buildThreadRouteParams(scopeThreadRef(environmentId, node.threadId))}
                  title="You can also double-click this node on the canvas."
                  className="inline-flex items-center gap-1 text-xs text-foreground underline-offset-2 hover:underline"
                >
                  <ExternalLinkIcon className="size-3" />
                  Open executing thread
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </ScrollArea>
      {readOnly ? null : (
        <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-border p-3">
          {node.status === "failed" || executing ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void retry()}>
              {node.status === "failed" ? "Retry" : "Restart"}
            </Button>
          ) : null}
          {node.status !== "done" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void setStatus("done")}
            >
              Mark done
            </Button>
          ) : null}
          {node.status !== "skipped" && node.status !== "done" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void setStatus("skipped")}
            >
              Skip
            </Button>
          ) : null}
          {node.status === "skipped" || (node.status === "done" && !executing) ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void setStatus("pending", null)}
            >
              Reopen
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive"
            onClick={() => void deleteNode()}
          >
            Delete
          </Button>
        </div>
      )}
    </aside>
  );
}
