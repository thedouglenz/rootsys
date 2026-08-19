import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type DagId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
} from "@t3tools/contracts";
import { buildDagCompanionBrief, buildDagPlannerBrief } from "@t3tools/shared/dagPrompts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { newMessageId, newThreadId } from "../../lib/utils";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { toastManager } from "../ui/toast";

interface KickoffInput {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly modelSelection: ModelSelection;
  readonly title: string;
  readonly text: string;
}

/**
 * Planner and companion threads are ordinary threads whose first user message
 * is the role brief. This hook creates the thread and its first turn in one
 * `thread.turn.start` and navigates to it.
 */
export function useDagThreadKickoff() {
  const navigate = useNavigate();
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });

  const kickoff = useCallback(
    async (input: KickoffInput): Promise<boolean> => {
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      const result = await startTurn({
        environmentId: input.environmentId,
        input: {
          threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: input.text,
            attachments: [],
          },
          modelSelection: input.modelSelection,
          titleSeed: input.title,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          bootstrap: {
            createThread: {
              projectId: input.projectId,
              title: input.title,
              modelSelection: input.modelSelection,
              runtimeMode: DEFAULT_RUNTIME_MODE,
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              branch: null,
              worktreePath: null,
              createdAt,
            },
          },
          createdAt,
        },
      });
      if (result._tag === "Failure") {
        toastManager.add({ type: "error", title: "Could not start the agent thread." });
        return false;
      }
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(input.environmentId, threadId)),
      });
      return true;
    },
    [navigate, startTurn],
  );

  const startPlanner = useCallback(
    (input: {
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly projectTitle: string | undefined;
      readonly modelSelection: ModelSelection;
      readonly supportsWorkflows: boolean;
      readonly dagId: DagId;
      readonly dagTitle: string;
      readonly goal: string;
    }) =>
      kickoff({
        environmentId: input.environmentId,
        projectId: input.projectId,
        modelSelection: input.modelSelection,
        title: `Plan: ${input.dagTitle}`,
        text: buildDagPlannerBrief({
          dagId: input.dagId,
          goal: input.goal,
          projectTitle: input.projectTitle,
          supportsWorkflows: input.supportsWorkflows,
        }),
      }),
    [kickoff],
  );

  const startCompanion = useCallback(
    (input: {
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly modelSelection: ModelSelection;
      readonly dagId: DagId;
      readonly dagTitle: string;
    }) =>
      kickoff({
        environmentId: input.environmentId,
        projectId: input.projectId,
        modelSelection: input.modelSelection,
        title: `Companion: ${input.dagTitle}`,
        text: buildDagCompanionBrief({ dagId: input.dagId, dagTitle: input.dagTitle }),
      }),
    [kickoff],
  );

  return { startPlanner, startCompanion };
}
