import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  DAG_COMPANION_TITLE_PREFIX,
  DAG_PLANNER_TITLE_PREFIX,
  type DagId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ThreadDagRole,
  type ThreadId,
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
  readonly dagId: DagId;
  readonly role: Extract<ThreadDagRole, "planner" | "companion">;
  /** False leaves the caller on its own surface (the plan page's dock hosts it). */
  readonly navigate?: boolean | undefined;
}

/**
 * Planner and companion threads are ordinary threads whose first user message
 * is the role brief. This hook creates the thread and its first turn in one
 * `thread.turn.start`, then navigates to it unless the caller opted out.
 * Returns the new thread's id, or null when the server refused.
 *
 * No `titleSeed` goes with the turn: these titles are deliberate, and a seed
 * equal to the title is exactly what `canReplaceThreadTitle` reads as "the
 * user did not name this", which auto-renamed planners and companions into
 * near-duplicates of each other. The server refuses to retitle a DAG thread
 * either way; leaving the seed off keeps the client honest on its own.
 */
export function useDagThreadKickoff() {
  const navigate = useNavigate();
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });

  const kickoff = useCallback(
    async (input: KickoffInput): Promise<ThreadId | null> => {
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
              dagLink: { dagId: input.dagId, nodeId: null, role: input.role },
              createdAt,
            },
          },
          createdAt,
        },
      });
      if (result._tag === "Failure") {
        toastManager.add({ type: "error", title: "Could not start the agent thread." });
        return null;
      }
      if (input.navigate ?? true) {
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(input.environmentId, threadId)),
        });
      }
      return threadId;
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
        title: `${DAG_PLANNER_TITLE_PREFIX}${input.dagTitle}`,
        dagId: input.dagId,
        role: "planner",
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
      /** False keeps the user where they are and just returns the thread id. */
      readonly navigate?: boolean | undefined;
    }) =>
      kickoff({
        environmentId: input.environmentId,
        projectId: input.projectId,
        modelSelection: input.modelSelection,
        title: `${DAG_COMPANION_TITLE_PREFIX}${input.dagTitle}`,
        dagId: input.dagId,
        role: "companion",
        text: buildDagCompanionBrief({ dagId: input.dagId, dagTitle: input.dagTitle }),
        navigate: input.navigate,
      }),
    [kickoff],
  );

  return { startPlanner, startCompanion };
}
