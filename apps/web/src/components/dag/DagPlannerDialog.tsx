import type { Dag, EnvironmentId, ModelSelection, ProjectId } from "@t3tools/contracts";
import { useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { DagModelPicker } from "./DagModelPicker";
import { useDagProviders } from "./useDagProviders";
import { useDagThreadKickoff } from "./useDagThreadKickoff";

export interface DagPlannerDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly dag: Pick<Dag, "dagId" | "title" | "defaultModelSelection">;
  readonly projectId: ProjectId;
  readonly projectTitle: string | undefined;
  readonly projectDefaultModelSelection: ModelSelection | null;
}

/** Collects the goal and model, then starts a planner thread for the DAG. */
export function DagPlannerDialog({
  open,
  onOpenChange,
  environmentId,
  dag,
  projectId,
  projectTitle,
  projectDefaultModelSelection,
}: DagPlannerDialogProps) {
  const providers = useDagProviders(environmentId);
  const { startPlanner } = useDagThreadKickoff();
  const [goal, setGoal] = useState("");
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [pending, setPending] = useState(false);
  const resolvedModel = providers.resolveSelection(
    model ?? dag.defaultModelSelection ?? projectDefaultModelSelection,
  );
  const canStart = goal.trim().length > 0 && resolvedModel !== null && !pending;

  const start = async () => {
    if (!canStart || resolvedModel === null) return;
    setPending(true);
    const threadId = await startPlanner({
      environmentId,
      projectId,
      projectTitle,
      modelSelection: resolvedModel,
      supportsWorkflows: providers.supportsWorkflows(resolvedModel),
      dagId: dag.dagId,
      dagTitle: dag.title,
      goal: goal.trim(),
    });
    setPending(false);
    if (threadId !== null) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Plan with an agent</DialogTitle>
          <DialogDescription>
            A planner thread explores the repository and fills this plan with nodes. You can discuss
            and adjust it in the thread before it is marked ready.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Goal</span>
            <Textarea
              autoFocus
              value={goal}
              placeholder="What should this plan achieve? Include constraints and what done looks like."
              onChange={(event) => setGoal(event.target.value)}
              className="min-h-32"
            />
          </label>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium">Planner model</span>
            <DagModelPicker
              environmentId={environmentId}
              value={model}
              fallback={dag.defaultModelSelection ?? projectDefaultModelSelection}
              onChange={setModel}
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!canStart} onClick={() => void start()}>
            {pending ? "Starting..." : "Start planning"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
