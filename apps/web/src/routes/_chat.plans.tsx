import { createFileRoute } from "@tanstack/react-router";

import { PlansList } from "../components/dag/PlansList";

export const Route = createFileRoute("/_chat/plans")({
  component: PlansList,
});
