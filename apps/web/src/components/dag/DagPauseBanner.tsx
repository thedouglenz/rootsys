/**
 * Explains a pause the engine gave itself. Without this the plan simply stops
 * two seconds after every Resume and the provider's reason ("you've reached
 * your … limit") never reaches the user.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { DagGraph, DagNodeId, EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { PauseCircleIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { describeDagPauseReason, truncateProviderMessage } from "./dagPause";

export function DagPauseBanner({
  environmentId,
  graph,
  onChangeModel,
  className,
}: {
  readonly environmentId: EnvironmentId;
  readonly graph: DagGraph;
  /**
   * Takes the parked node (null when the pause is plan-wide). Pass null to
   * hide the action, e.g. on a surface that cannot edit the plan.
   */
  readonly onChangeModel: ((nodeId: DagNodeId | null) => void) | null;
  readonly className?: string;
}) {
  const { dag } = graph;
  const reason = dag.status === "paused" ? (dag.pauseReason ?? null) : null;
  if (reason === null) return null;

  const { headline, action } = describeDagPauseReason(reason);
  const node = graph.nodes.find((candidate) => candidate.nodeId === reason.nodeId) ?? null;
  const nodeLabel = node?.title ?? (reason.nodeId === null ? null : reason.nodeId);
  const age = formatRelativeTimeLabel(reason.pausedAt);

  return (
    <Alert
      variant="warning"
      controlAlignment="first-line"
      className={cn("py-2", className)}
      aria-live="polite"
    >
      <PauseCircleIcon />
      <AlertTitle className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs">
        <span>{headline}</span>
        {nodeLabel !== null ? (
          <span className="min-w-0 truncate font-normal text-warning-foreground/80">
            {reason.threadId !== null ? (
              <Link
                to="/$environmentId/$threadId"
                params={buildThreadRouteParams(scopeThreadRef(environmentId, reason.threadId))}
                className="underline-offset-2 hover:underline"
              >
                {nodeLabel}
              </Link>
            ) : (
              nodeLabel
            )}
          </span>
        ) : null}
        {age.length > 0 ? (
          <span className="font-normal text-warning-foreground/70">· {age}</span>
        ) : null}
      </AlertTitle>
      {reason.providerMessage !== null ? (
        <AlertDescription className="text-xs">
          <Tooltip>
            <TooltipTrigger render={<span className="truncate" />}>
              “{truncateProviderMessage(reason.providerMessage)}”
            </TooltipTrigger>
            <TooltipPopup side="bottom" className="max-w-96 whitespace-pre-wrap">
              {reason.providerMessage}
            </TooltipPopup>
          </Tooltip>
        </AlertDescription>
      ) : null}
      {action === "change-model" && onChangeModel !== null ? (
        <AlertAction>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => onChangeModel(reason.nodeId)}
          >
            Change model
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
