import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { DagShell, EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { MessageCircleQuestionIcon, PlusIcon, WorkflowIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { environmentDags } from "../../state/dags";
import { useProjects } from "../../state/entities";
import { type EnvironmentPresentation, useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";
import { DagStatusBadge } from "./DagStatusBadge";
import { NewPlanDialog } from "./NewPlanDialog";

function PlanRow({
  environmentId,
  dag,
  projectTitle,
}: {
  environmentId: EnvironmentId;
  dag: DagShell;
  projectTitle: string | null;
}) {
  return (
    <li>
      <Link
        to="/plans/$environmentId/$dagId"
        params={{ environmentId, dagId: dag.dagId }}
        className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 hover:bg-accent/40"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{dag.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {projectTitle ?? "No project"}
            {" · "}
            {dag.doneCount}/{dag.nodeCount} node{dag.nodeCount === 1 ? "" : "s"} done
          </span>
        </div>
        {dag.openQuestionCount > 0 ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 text-xs text-destructive-foreground"
            aria-label={`${dag.openQuestionCount} open questions`}
          >
            <MessageCircleQuestionIcon className="size-3.5" />
            {dag.openQuestionCount}
          </span>
        ) : null}
        <DagStatusBadge status={dag.status} />
      </Link>
    </li>
  );
}

function EnvironmentPlans({
  environment,
  includeArchived,
  showEnvironmentLabel,
  projects,
}: {
  environment: EnvironmentPresentation;
  includeArchived: boolean;
  showEnvironmentLabel: boolean;
  projects: ReadonlyArray<EnvironmentProject>;
}) {
  const query = useEnvironmentQuery(
    environmentDags.listAtom({
      environmentId: environment.environmentId,
      input: includeArchived ? { includeArchived: true } : {},
    }),
  );
  const projectTitle = useMemo(
    () => new Map(projects.map((project) => [project.id, project.title] as const)),
    [projects],
  );
  const dags = query.data?.dags ?? null;
  return (
    <section className="flex flex-col gap-2">
      {showEnvironmentLabel ? (
        <h2 className="text-xs font-medium text-muted-foreground">{environment.label}</h2>
      ) : null}
      {dags === null ? (
        query.error !== null ? (
          <p className="text-xs text-muted-foreground">Could not load plans: {query.error}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )
      ) : dags.length === 0 ? (
        <p className="text-xs text-muted-foreground">No plans yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {dags.map((dag) => (
            <PlanRow
              key={dag.dagId}
              environmentId={environment.environmentId}
              dag={dag}
              projectTitle={
                dag.primaryProjectId === null
                  ? null
                  : (projectTitle.get(dag.primaryProjectId) ?? null)
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function PlansList() {
  const { environments } = useEnvironments();
  const projects = useProjects();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [newPlanOpen, setNewPlanOpen] = useState(false);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          className={cn(
            "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 px-3 sm:px-5",
            isElectron &&
              "drag-region wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <WorkspaceBreadcrumb ariaLabel="Plans breadcrumb">
            <WorkspaceBreadcrumbItem current>
              <h1>Plans</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Archived
            <Switch checked={includeArchived} onCheckedChange={setIncludeArchived} />
          </label>
          <Button
            type="button"
            size="sm"
            disabled={environments.length === 0}
            onClick={() => setNewPlanOpen(true)}
          >
            <PlusIcon />
            New plan
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
            {environments.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <WorkflowIcon />
                  </EmptyMedia>
                  <EmptyTitle>No environment connected</EmptyTitle>
                  <EmptyDescription>
                    Plans live on a T3 Code server. Connect one to see or create plans.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              environments.map((environment) => (
                <EnvironmentPlans
                  key={environment.environmentId}
                  environment={environment}
                  includeArchived={includeArchived}
                  showEnvironmentLabel={environments.length > 1}
                  projects={projects}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>
      {newPlanOpen ? (
        <NewPlanDialog
          open
          onOpenChange={setNewPlanOpen}
          environments={environments}
          projects={projects}
          initialEnvironmentId={environments[0]?.environmentId ?? null}
        />
      ) : null}
    </SidebarInset>
  );
}
