import type { DagNodeExecutionMode } from "@t3tools/contracts";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { MessageCircleQuestionIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "../../lib/utils";
import type { DagNodeDisplayStatus } from "./dagModel";
import { DagNodeStatusBadge } from "./DagStatusBadge";

export interface DagFlowNodeData extends Record<string, unknown> {
  readonly title: string;
  readonly displayStatus: DagNodeDisplayStatus;
  readonly parallelSafe: boolean;
  readonly executionMode: DagNodeExecutionMode;
  readonly openQuestionCount: number;
  /** The node the viewer is "at" (the thread's own node); gets a distinct ring. */
  readonly isCurrent: boolean;
}

export type DagFlowNode = Node<DagFlowNodeData, "dagNode">;

const STATUS_BORDER: Record<DagNodeDisplayStatus, string> = {
  pending: "border-border",
  ready: "border-info/60",
  running: "border-warning",
  blocked: "border-destructive/70",
  done: "border-success/60",
  failed: "border-destructive",
  skipped: "border-border border-dashed",
};

export const DagFlowNodeComponent = memo(function DagFlowNodeComponent({
  data,
  selected,
  isConnectable,
}: NodeProps<DagFlowNode>) {
  return (
    <div
      className={cn(
        "flex w-[240px] flex-col gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-card-foreground shadow-xs",
        STATUS_BORDER[data.displayStatus],
        data.isCurrent && "ring-2 ring-primary/40 ring-offset-2 ring-offset-background",
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={isConnectable}
        className="!size-2.5 !border-background !bg-muted-foreground"
      />
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 min-w-0 text-sm leading-tight font-medium">{data.title}</span>
        {data.openQuestionCount > 0 ? (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 text-xs text-destructive-foreground"
            aria-label={`${data.openQuestionCount} open question${data.openQuestionCount === 1 ? "" : "s"}`}
          >
            <MessageCircleQuestionIcon className="size-3.5" />
            {data.openQuestionCount}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <DagNodeStatusBadge status={data.displayStatus} />
        {data.parallelSafe ? (
          <span className="rounded-sm bg-muted px-1 text-[.625rem] text-muted-foreground">
            parallel
          </span>
        ) : null}
        {data.executionMode !== "auto" ? (
          <span className="rounded-sm bg-muted px-1 text-[.625rem] text-muted-foreground">
            {data.executionMode}
          </span>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={isConnectable}
        className="!size-2.5 !border-background !bg-muted-foreground"
      />
    </div>
  );
});
