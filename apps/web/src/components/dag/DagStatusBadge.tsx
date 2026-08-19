import type { DagStatus } from "@t3tools/contracts";

import { Badge } from "../ui/badge";
import type { DagNodeDisplayStatus } from "./dagModel";

type BadgeVariant = NonNullable<Parameters<typeof Badge>[0]["variant"]>;

const NODE_STATUS_VARIANT: Record<DagNodeDisplayStatus, BadgeVariant> = {
  pending: "outline",
  ready: "info",
  running: "warning",
  blocked: "error",
  done: "success",
  failed: "destructive",
  skipped: "secondary",
};

const DAG_STATUS_VARIANT: Record<DagStatus, BadgeVariant> = {
  draft: "outline",
  ready: "info",
  running: "warning",
  paused: "secondary",
  completed: "success",
  failed: "destructive",
  archived: "secondary",
};

export function DagNodeStatusBadge({
  status,
  className,
}: {
  status: DagNodeDisplayStatus;
  className?: string;
}) {
  return (
    <Badge variant={NODE_STATUS_VARIANT[status]} size="sm" className={className}>
      {status}
    </Badge>
  );
}

export function DagStatusBadge({ status, className }: { status: DagStatus; className?: string }) {
  return (
    <Badge variant={DAG_STATUS_VARIANT[status]} className={className}>
      {status}
    </Badge>
  );
}
