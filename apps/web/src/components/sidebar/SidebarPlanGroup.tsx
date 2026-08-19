/**
 * Sidebar pieces for plan-linked threads (rootsys): the per-row glyph and the
 * collapsible "Plan: <title>" group header. Both read the live DAG graph
 * through the shared per-plan subscription.
 */
import type { DagId, EnvironmentId, ThreadDagLink } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, WorkflowIcon } from "lucide-react";
import { memo, useCallback } from "react";

import { cn } from "../../lib/utils";
import {
  DAG_LINK_NEUTRAL_TINT_CLASS,
  DAG_NODE_STATUS_DOT_CLASS,
  DAG_NODE_STATUS_TINT_CLASS,
  dagLinkRoleLabel,
  dagProgress,
} from "../dag/dagThreadLink";
import { useDagLinkInfo } from "../dag/useDagLinkInfo";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const SidebarDagLinkGlyph = memo(function SidebarDagLinkGlyph({
  environmentId,
  dagLink,
}: {
  environmentId: EnvironmentId;
  dagLink: ThreadDagLink;
}) {
  const info = useDagLinkInfo(environmentId, dagLink);
  const tint =
    info.nodeStatus === null
      ? DAG_LINK_NEUTRAL_TINT_CLASS
      : DAG_NODE_STATUS_TINT_CLASS[info.nodeStatus];
  const label = `Plan: ${info.dagTitle ?? "…"} · ${dagLinkRoleLabel(dagLink, info.nodeTitle)}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={label}
            className={cn("inline-flex shrink-0 items-center justify-center", tint)}
          />
        }
      >
        <WorkflowIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
});

/** Dot colour for the plan as a whole, from its DAG status. */
const DAG_STATUS_DOT_CLASS: Record<string, string> = {
  running: DAG_NODE_STATUS_DOT_CLASS.running,
  paused: "bg-muted-foreground/50",
  completed: DAG_NODE_STATUS_DOT_CLASS.done,
  failed: DAG_NODE_STATUS_DOT_CLASS.failed,
};

export const SidebarPlanGroupHeader = memo(function SidebarPlanGroupHeader({
  environmentId,
  dagId,
  fallbackTitle,
  memberCount,
  expanded,
  onToggle,
}: {
  environmentId: EnvironmentId;
  dagId: DagId;
  fallbackTitle: string | null;
  memberCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const navigate = useNavigate();
  const info = useDagLinkInfo(environmentId, { dagId, nodeId: null, role: "companion" });
  const graph = info.graph;
  const title = graph?.dag.title ?? fallbackTitle ?? "Plan";
  const progress = graph === null ? null : dagProgress(graph);
  const dotClass =
    (graph === null ? undefined : DAG_STATUS_DOT_CLASS[graph.dag.status]) ??
    DAG_NODE_STATUS_DOT_CLASS.pending;
  const openPlan = useCallback(() => {
    void navigate({ to: "/plans/$environmentId/$dagId", params: { environmentId, dagId } });
  }, [dagId, environmentId, navigate]);
  return (
    <li data-thread-selection-safe className="list-none">
      <div className="mb-0.5 mt-2 flex h-7 w-full items-center gap-1.5 px-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse plan ${title}` : `Expand plan ${title}`}
          className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground"
        >
          <ChevronDownIcon
            aria-hidden
            className={cn("size-3 transition-transform", !expanded && "-rotate-90")}
          />
        </button>
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dotClass)} />
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={openPlan}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
              />
            }
          >
            <WorkflowIcon aria-hidden className="size-3 shrink-0" />
            <span className="truncate">Plan: {title}</span>
          </TooltipTrigger>
          <TooltipPopup side="top">Open plan: {title}</TooltipPopup>
        </Tooltip>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
          {progress === null
            ? expanded
              ? null
              : `(${memberCount})`
            : `${progress.done}/${progress.total}`}
        </span>
      </div>
    </li>
  );
});
