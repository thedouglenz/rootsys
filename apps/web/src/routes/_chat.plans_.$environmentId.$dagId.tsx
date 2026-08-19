import { DagId, EnvironmentId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { DagPage } from "../components/dag/DagPage";

function DagRouteView() {
  const { environmentId, dagId } = Route.useParams();
  return (
    <DagPage
      key={`${environmentId}:${dagId}`}
      environmentId={EnvironmentId.make(environmentId)}
      dagId={DagId.make(dagId)}
    />
  );
}

export const Route = createFileRoute("/_chat/plans_/$environmentId/$dagId")({
  component: DagRouteView,
});
