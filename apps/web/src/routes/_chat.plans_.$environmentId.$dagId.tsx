import { DagId, DagNodeId, EnvironmentId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { DagPage } from "../components/dag/DagPage";

export interface DagRouteSearch {
  /** Node to preselect in the side panel, e.g. when arriving from a thread's plan chip. */
  readonly node?: string;
}

function DagRouteView() {
  const { environmentId, dagId } = Route.useParams();
  const { node } = Route.useSearch();
  return (
    <DagPage
      key={`${environmentId}:${dagId}`}
      environmentId={EnvironmentId.make(environmentId)}
      dagId={DagId.make(dagId)}
      initialNodeId={node === undefined ? null : DagNodeId.make(node)}
    />
  );
}

export const Route = createFileRoute("/_chat/plans_/$environmentId/$dagId")({
  validateSearch: (raw: Record<string, unknown>): DagRouteSearch =>
    typeof raw.node === "string" && raw.node.length > 0 ? { node: raw.node } : {},
  component: DagRouteView,
});
