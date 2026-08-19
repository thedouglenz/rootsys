import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { type DagGraph, type EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BotIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { DagModelPicker } from "./DagModelPicker";
import { DAG_RUN_BLOCKER_HINTS, resolveDagRunAction, resolveDagRunBlocker } from "./dagModel";
import { DagPlannerDialog } from "./DagPlannerDialog";
import { DagStatusBadge } from "./DagStatusBadge";
import type { DagDispatch } from "./useDagDispatch";
import { useDagProviders } from "./useDagProviders";
import { useDagThreadKickoff } from "./useDagThreadKickoff";

export interface DagHeaderProps {
  readonly environmentId: EnvironmentId;
  readonly graph: DagGraph;
  /** Projects in this environment, for the primary-project select. */
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly dispatch: DagDispatch;
  readonly onDeleted: () => void;
}

export function DagHeader({ environmentId, graph, projects, dispatch, onDeleted }: DagHeaderProps) {
  const { dag } = graph;
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [companionPending, setCompanionPending] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const providers = useDagProviders(environmentId);
  const { startCompanion } = useDagThreadKickoff();

  const project = useMemo(
    () => projects.find((candidate) => candidate.id === dag.primaryProjectId) ?? null,
    [dag.primaryProjectId, projects],
  );
  const projectDefaultModel = project?.defaultModelSelection ?? null;
  const runBlocker = resolveDagRunBlocker({
    graph,
    projectDefaultModelSelection: projectDefaultModel,
  });
  const runAction = resolveDagRunAction(dag.status);
  const archived = dag.status === "archived";
  const agentModel = providers.resolveSelection(dag.defaultModelSelection ?? projectDefaultModel);
  const agentBlocker =
    project === null
      ? "Pick a project first."
      : agentModel === null
        ? "No provider is available in this environment."
        : null;

  const saveTitle = () => {
    const next = titleDraft?.trim() ?? "";
    setTitleDraft(null);
    if (next.length === 0 || next === dag.title) return;
    void dispatch({ type: "dag.meta.update", dagId: dag.dagId, title: next });
  };

  const openCompanion = async () => {
    if (project === null || agentModel === null) return;
    setCompanionPending(true);
    await startCompanion({
      environmentId,
      projectId: project.id,
      modelSelection: agentModel,
      dagId: dag.dagId,
      dagTitle: dag.title,
    });
    setCompanionPending(false);
  };

  const deleteDag = async () => {
    const confirmed = await requestConfirmDialog(
      `Delete plan "${dag.title}"?\nNodes, dependencies, and questions are removed. Threads it started are kept.`,
      { variant: "destructive" },
    );
    if (confirmed === false) return;
    const ok = await dispatch({ type: "dag.delete", dagId: dag.dagId });
    if (ok) onDeleted();
  };

  const runButton = (() => {
    if (runAction === null) return null;
    if (runAction === "pause") {
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            void dispatch({ type: "dag.status.set", dagId: dag.dagId, status: "paused" })
          }
        >
          <PauseIcon />
          Pause
        </Button>
      );
    }
    const button = (
      <Button
        type="button"
        size="sm"
        disabled={runBlocker !== null}
        onClick={() =>
          void dispatch({ type: "dag.status.set", dagId: dag.dagId, status: "running" })
        }
      >
        <PlayIcon />
        {runAction === "resume" ? "Resume" : "Run"}
      </Button>
    );
    if (runBlocker === null) return button;
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex">{button}</span>} />
        <TooltipPopup side="bottom">{DAG_RUN_BLOCKER_HINTS[runBlocker]}</TooltipPopup>
      </Tooltip>
    );
  })();

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Input
          aria-label="Plan title"
          size="sm"
          unstyled
          className="min-w-32 flex-1 truncate rounded-md px-1.5 text-base font-semibold hover:bg-muted/60 focus-visible:bg-muted/60"
          value={titleDraft ?? dag.title}
          disabled={archived}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={saveTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setTitleDraft(null);
              event.currentTarget.blur();
            }
          }}
        />
        <DagStatusBadge status={dag.status} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          value={dag.primaryProjectId}
          disabled={archived}
          onValueChange={(value) => {
            if (value === null || value === dag.primaryProjectId) return;
            void dispatch({
              type: "dag.meta.update",
              dagId: dag.dagId,
              primaryProjectId: ProjectId.make(value),
            });
          }}
        >
          <SelectTrigger size="sm" className="max-w-44" aria-label="Project">
            <SelectValue placeholder="Pick project">{project?.title}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {projects.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.title}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>

        <DagModelPicker
          environmentId={environmentId}
          value={dag.defaultModelSelection}
          fallback={projectDefaultModel}
          disabled={archived}
          onChange={(selection) =>
            void dispatch({
              type: "dag.meta.update",
              dagId: dag.dagId,
              defaultModelSelection: selection,
            })
          }
        />

        {archived ? null : (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={agentBlocker !== null}
                      onClick={() => setPlannerOpen(true)}
                    >
                      <SparklesIcon />
                      Plan with agent
                    </Button>
                  </span>
                }
              />
              <TooltipPopup side="bottom">
                {agentBlocker ?? "Start a planner thread that fills this plan."}
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={agentBlocker !== null || companionPending}
                      onClick={() => void openCompanion()}
                    >
                      <BotIcon />
                      Companion
                    </Button>
                  </span>
                }
              />
              <TooltipPopup side="bottom">
                {agentBlocker ?? "Open a chat that edits this plan for you."}
              </TooltipPopup>
            </Tooltip>
            {runButton}
          </>
        )}

        <Menu>
          <MenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="More plan actions" />}
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            {archived ? (
              <MenuItem
                onClick={() =>
                  void dispatch({ type: "dag.status.set", dagId: dag.dagId, status: "draft" })
                }
              >
                <ArchiveRestoreIcon />
                Unarchive
              </MenuItem>
            ) : (
              <MenuItem
                onClick={() =>
                  void dispatch({ type: "dag.status.set", dagId: dag.dagId, status: "archived" })
                }
              >
                <ArchiveIcon />
                Archive
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => void deleteDag()}>
              <Trash2Icon />
              Delete plan
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      {project ? (
        <DagPlannerDialog
          open={plannerOpen}
          onOpenChange={setPlannerOpen}
          environmentId={environmentId}
          dag={dag}
          projectId={project.id}
          projectTitle={project.title}
          projectDefaultModelSelection={projectDefaultModel}
        />
      ) : null}
    </div>
  );
}
