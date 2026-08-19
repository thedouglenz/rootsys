import type { EnvironmentId, ThreadDagLink } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { WorkflowIcon } from "lucide-react";
import { memo, useCallback } from "react";

import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  DAG_LINK_NEUTRAL_TINT_CLASS,
  DAG_NODE_STATUS_TINT_CLASS,
  dagLinkChipLabel,
} from "./dagThreadLink";
import { useDagLinkInfo } from "./useDagLinkInfo";

/**
 * Compact `Plan ▸ <node|planner|companion>` chip for the chat header. Clicking
 * opens the plan canvas with the executor's node preselected.
 */
export const DagThreadChip = memo(function DagThreadChip({
  environmentId,
  dagLink,
  className,
}: {
  environmentId: EnvironmentId;
  dagLink: ThreadDagLink;
  className?: string;
}) {
  const navigate = useNavigate();
  const info = useDagLinkInfo(environmentId, dagLink);
  const label = dagLinkChipLabel(dagLink, info.nodeTitle);
  const tint =
    info.nodeStatus === null
      ? DAG_LINK_NEUTRAL_TINT_CLASS
      : DAG_NODE_STATUS_TINT_CLASS[info.nodeStatus];
  const open = useCallback(() => {
    void navigate({
      to: "/plans/$environmentId/$dagId",
      params: { environmentId, dagId: dagLink.dagId },
      search: dagLink.nodeId === null ? {} : { node: dagLink.nodeId },
    });
  }, [dagLink.dagId, dagLink.nodeId, environmentId, navigate]);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={open}
            aria-label={`Open plan${info.dagTitle ? ` ${info.dagTitle}` : ""}`}
            className={cn(
              "inline-flex max-w-56 shrink-0 cursor-pointer items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          />
        }
      >
        <WorkflowIcon aria-hidden className={cn("size-3 shrink-0", tint)} />
        <span className="truncate">{label}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {info.dagTitle ? `Open plan: ${info.dagTitle}` : "Open plan"}
      </TooltipPopup>
    </Tooltip>
  );
});
