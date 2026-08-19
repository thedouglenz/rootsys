/**
 * Run log for a plan: `orchestration.getDagTimeline` entries newest-first,
 * under the canvas. The list only queries while expanded and re-queries when
 * the live graph advances, so an open log tracks the engine without polling.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  DagGraph,
  DagNodeId,
  DagTimelineEntry,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, HistoryIcon, MessageSquareIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { environmentDags } from "../../state/dags";
import { useEnvironmentQuery } from "../../state/query";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Badge } from "../ui/badge";
import { Spinner } from "../ui/spinner";

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const KIND_LABEL: Record<DagTimelineEntry["kind"], string> = {
  "dag-created": "plan created",
  "dag-status": "plan",
  "node-status": "node",
  "node-upserted": "node edited",
  "node-deleted": "node removed",
  "edge-added": "dependency added",
  "edge-removed": "dependency removed",
  "question-asked": "asked",
  "question-answered": "answered",
};

const ACTOR_CLASS: Record<DagTimelineEntry["actor"], string> = {
  user: "text-info-foreground",
  agent: "text-success-foreground",
  engine: "text-warning-foreground",
  server: "text-muted-foreground",
};

const DETAIL_PREVIEW_LENGTH = 120;

const TimelineRow = memo(function TimelineRow({
  entry,
  nodeTitle,
  onOpenThread,
}: {
  entry: DagTimelineEntry;
  nodeTitle: string | null;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detail = entry.detail;
  const truncated = detail !== null && detail.length > DETAIL_PREVIEW_LENGTH && !expanded;
  return (
    <li className="flex flex-col gap-0.5 px-3 py-1.5 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 tabular-nums text-muted-foreground/70">
          {TIME_FORMAT.format(new Date(entry.occurredAt))}
        </span>
        <span className={cn("shrink-0 font-medium", ACTOR_CLASS[entry.actor])}>{entry.actor}</span>
        <span className="shrink-0 text-muted-foreground">{KIND_LABEL[entry.kind]}</span>
        {nodeTitle !== null ? (
          <span className="min-w-0 truncate text-foreground/90">{nodeTitle}</span>
        ) : null}
        {entry.status !== null ? (
          <Badge variant="outline" size="sm">
            {entry.status}
          </Badge>
        ) : null}
        {entry.threadId !== null ? (
          <button
            type="button"
            onClick={() => onOpenThread(entry.threadId!)}
            aria-label="Open thread"
            className="ml-auto inline-flex shrink-0 cursor-pointer items-center text-muted-foreground hover:text-foreground"
          >
            <MessageSquareIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
      {detail !== null ? (
        <p
          className={cn(
            "whitespace-pre-wrap text-muted-foreground",
            detail.length > DETAIL_PREVIEW_LENGTH && "cursor-pointer",
          )}
          onClick={
            detail.length > DETAIL_PREVIEW_LENGTH ? () => setExpanded((value) => !value) : undefined
          }
        >
          {truncated ? `${detail.slice(0, DETAIL_PREVIEW_LENGTH)}…` : detail}
        </p>
      ) : null}
    </li>
  );
});

function DagTimelineList({
  environmentId,
  graph,
  snapshotSequence,
}: {
  environmentId: EnvironmentId;
  graph: DagGraph;
  snapshotSequence: number;
}) {
  const navigate = useNavigate();
  const query = useEnvironmentQuery(
    environmentDags.timelineAtom({ environmentId, input: { dagId: graph.dag.dagId } }),
  );
  const { refresh } = query;
  // The graph subscription is the change signal: every folded event bumps
  // the sequence, so the log re-reads exactly when there is something new.
  const lastSequenceRef = useRef(snapshotSequence);
  useEffect(() => {
    if (lastSequenceRef.current === snapshotSequence) return;
    lastSequenceRef.current = snapshotSequence;
    refresh();
  }, [refresh, snapshotSequence]);
  const nodeTitle = useMemo(
    () => new Map<DagNodeId, string>(graph.nodes.map((node) => [node.nodeId, node.title] as const)),
    [graph.nodes],
  );
  const entries = useMemo(
    () =>
      query.data === null ? null : query.data.entries.toSorted((a, b) => b.sequence - a.sequence),
    [query.data],
  );
  const openThread = useCallback(
    (threadId: ThreadId) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
      });
    },
    [environmentId, navigate],
  );
  if (entries === null) {
    return (
      <div className="flex h-16 items-center justify-center">
        {query.error !== null ? (
          <p className="text-xs text-muted-foreground">Could not load the run log: {query.error}</p>
        ) : (
          <Spinner className="size-4" />
        )}
      </div>
    );
  }
  if (entries.length === 0) {
    return <p className="px-3 py-3 text-xs text-muted-foreground">Nothing has happened yet.</p>;
  }
  return (
    <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto">
      {entries.map((entry) => (
        <TimelineRow
          key={entry.sequence}
          entry={entry}
          nodeTitle={entry.nodeId === null ? null : (nodeTitle.get(entry.nodeId) ?? entry.nodeId)}
          onOpenThread={openThread}
        />
      ))}
    </ul>
  );
}

export function DagTimeline({
  environmentId,
  graph,
  snapshotSequence,
}: {
  environmentId: EnvironmentId;
  graph: DagGraph;
  snapshotSequence: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const pauseRequested =
    graph.dag.status === "paused" && graph.nodes.some((node) => node.status === "running");
  return (
    <section className="shrink-0 border-t border-border bg-background">
      <button
        type="button"
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm font-medium"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <HistoryIcon className="size-4 text-muted-foreground" />
        Run log
        {pauseRequested ? (
          <span className="text-xs font-normal text-muted-foreground">
            Pause requested — the current node will finish first.
          </span>
        ) : null}
        <ChevronDownIcon
          className={cn("ml-auto size-4 text-muted-foreground", !expanded && "-rotate-90")}
        />
      </button>
      {expanded ? (
        <DagTimelineList
          environmentId={environmentId}
          graph={graph}
          snapshotSequence={snapshotSequence}
        />
      ) : null}
    </section>
  );
}
