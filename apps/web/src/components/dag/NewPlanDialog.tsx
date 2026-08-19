import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { DagId, type EnvironmentId, type ModelSelection, ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { randomUUID } from "../../lib/utils";
import { dagCommands } from "../../state/dags";
import type { EnvironmentPresentation } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
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
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { DagModelPicker } from "./DagModelPicker";
import { useDagProviders } from "./useDagProviders";
import { useDagThreadKickoff } from "./useDagThreadKickoff";

export interface NewPlanDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environments: ReadonlyArray<EnvironmentPresentation>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly initialEnvironmentId: EnvironmentId | null;
}

/**
 * Creates a DAG in one environment/project. With a goal it also starts the
 * planner thread and lands there; without one it opens the empty canvas.
 */
export function NewPlanDialog(props: NewPlanDialogProps) {
  const { open, onOpenChange } = props;
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(
    props.initialEnvironmentId,
  );
  const resolvedEnvironmentId =
    environmentId ?? props.initialEnvironmentId ?? props.environments[0]?.environmentId ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New plan</DialogTitle>
          <DialogDescription>
            A plan is a graph of work nodes that agents execute in dependency order. Give it a goal
            to have a planner agent build the graph for you.
          </DialogDescription>
        </DialogHeader>
        {resolvedEnvironmentId === null ? (
          <DialogPanel>
            <p className="text-sm text-muted-foreground">No environment is connected.</p>
          </DialogPanel>
        ) : (
          <NewPlanForm
            key={resolvedEnvironmentId}
            environmentId={resolvedEnvironmentId}
            environments={props.environments}
            onEnvironmentChange={setEnvironmentId}
            projects={props.projects}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function NewPlanForm({
  environmentId,
  environments,
  onEnvironmentChange,
  projects,
  onClose,
}: {
  environmentId: EnvironmentId;
  environments: ReadonlyArray<EnvironmentPresentation>;
  onEnvironmentChange: (environmentId: EnvironmentId) => void;
  projects: ReadonlyArray<EnvironmentProject>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const providers = useDagProviders(environmentId);
  const { startPlanner } = useDagThreadKickoff();
  const dispatch = useAtomCommand(dagCommands.dispatch, { reportFailure: false });
  const environmentProjects = useMemo(
    () => projects.filter((project) => project.environmentId === environmentId),
    [environmentId, projects],
  );
  const [projectId, setProjectId] = useState<ProjectId | null>(environmentProjects[0]?.id ?? null);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [pending, setPending] = useState(false);

  const project = environmentProjects.find((candidate) => candidate.id === projectId) ?? null;
  const projectDefaultModel = project?.defaultModelSelection ?? null;
  const resolvedModel = providers.resolveSelection(model ?? projectDefaultModel);
  const trimmedGoal = goal.trim();
  const canCreate =
    title.trim().length > 0 &&
    project !== null &&
    !pending &&
    (trimmedGoal.length === 0 || resolvedModel !== null);

  const create = async () => {
    if (!canCreate || project === null) return;
    setPending(true);
    const dagId = DagId.make(randomUUID());
    // Store what the picker showed so the plan is runnable as created.
    const defaultModelSelection = model ?? projectDefaultModel ?? resolvedModel;
    const result = await dispatch({
      environmentId,
      input: {
        type: "dag.create",
        dagId,
        title: title.trim(),
        primaryProjectId: project.id,
        defaultModelSelection,
      },
    });
    if (result._tag === "Failure") {
      setPending(false);
      toastManager.add({ type: "error", title: "Could not create the plan." });
      return;
    }
    if (trimmedGoal.length > 0 && resolvedModel !== null) {
      const started = await startPlanner({
        environmentId,
        projectId: project.id,
        projectTitle: project.title,
        modelSelection: resolvedModel,
        supportsWorkflows: providers.supportsWorkflows(resolvedModel),
        dagId,
        dagTitle: title.trim(),
        goal: trimmedGoal,
      });
      if (started) {
        onClose();
        return;
      }
    }
    await navigate({ to: "/plans/$environmentId/$dagId", params: { environmentId, dagId } });
    onClose();
  };

  return (
    <>
      <DialogPanel className="space-y-4">
        {environments.length > 1 ? (
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Environment</span>
            <Select
              value={environmentId}
              onValueChange={(value) => {
                if (value !== null) onEnvironmentChange(value as EnvironmentId);
              }}
            >
              <SelectTrigger size="sm" aria-label="Environment">
                <SelectValue>
                  {environments.find((candidate) => candidate.environmentId === environmentId)
                    ?.label ?? environmentId}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {environments.map((candidate) => (
                  <SelectItem key={candidate.environmentId} value={candidate.environmentId}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
        ) : null}
        <label className="grid gap-1.5">
          <span className="text-xs font-medium">Project</span>
          <Select
            value={projectId}
            onValueChange={(value) => setProjectId(value === null ? null : ProjectId.make(value))}
          >
            <SelectTrigger size="sm" aria-label="Project">
              <SelectValue placeholder="Pick a project">{project?.title}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {environmentProjects.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          {environmentProjects.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              Add a project to this environment first.
            </span>
          ) : null}
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium">Title</span>
          <Input
            autoFocus
            value={title}
            placeholder="Migrate auth to passkeys"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium">Goal (optional)</span>
          <Textarea
            size="sm"
            value={goal}
            placeholder="Describe the outcome and a planner agent will draft the graph. Leave empty to build it yourself."
            onChange={(event) => setGoal(event.target.value)}
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium">Default model</span>
          <DagModelPicker
            environmentId={environmentId}
            value={model}
            fallback={projectDefaultModel}
            onChange={setModel}
          />
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={!canCreate} onClick={() => void create()}>
          {pending ? "Creating..." : trimmedGoal.length > 0 ? "Create and plan" : "Create"}
        </Button>
      </DialogFooter>
    </>
  );
}
