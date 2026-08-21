/**
 * Says a plan is finished. Without this a completed 21-node run looks exactly
 * like a fresh one: the canvas is full of green nodes and nothing states the
 * plan is over, when it ended, or how long it took.
 */
import type { DagGraph } from "@t3tools/contracts";
import { CircleCheckIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import {
  describeDagCompletionCounts,
  formatDagDurationLabel,
  summarizeDagCompletion,
} from "./dagCompletion";

export function DagCompletionBanner({
  graph,
  onOpenRunLog,
  className,
}: {
  readonly graph: DagGraph;
  /** Opens the run log expanded. Pass null on surfaces that have no log. */
  readonly onOpenRunLog: (() => void) | null;
  readonly className?: string;
}) {
  if (graph.dag.status !== "completed") return null;

  const summary = summarizeDagCompletion(graph);
  const age = summary.finishedAt === null ? "" : formatRelativeTimeLabel(summary.finishedAt);
  const span = summary.nodeSpanMs === null ? null : formatDagDurationLabel(summary.nodeSpanMs);

  return (
    <Alert
      variant="success"
      controlAlignment="first-line"
      className={cn("py-2", className)}
      aria-live="polite"
    >
      <CircleCheckIcon />
      <AlertTitle className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs">
        <span>Plan complete</span>
        <span className="font-normal text-muted-foreground">
          {describeDagCompletionCounts(summary)}
        </span>
        {age.length > 0 ? <span className="font-normal text-muted-foreground">· {age}</span> : null}
      </AlertTitle>
      {span !== null ? (
        <AlertDescription className="text-xs">
          {span} from the first node finishing to the last.
        </AlertDescription>
      ) : null}
      {onOpenRunLog !== null ? (
        <AlertAction>
          <Button type="button" size="xs" variant="outline" onClick={onOpenRunLog}>
            Run log
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
