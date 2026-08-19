import type { DagCommandDispatchInput } from "@t3tools/client-runtime/state/dags";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { useCallback } from "react";

import { dagCommands } from "../../state/dags";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";

/**
 * Dispatch one DAG command against an environment. Failures surface as a
 * toast (the server's decider message when it has one) and resolve `false`
 * so callers can keep local UI honest.
 */
export function useDagDispatch(environmentId: EnvironmentId) {
  const dispatch = useAtomCommand(dagCommands.dispatch, { reportFailure: false });
  return useCallback(
    async (input: DagCommandDispatchInput): Promise<boolean> => {
      const result = await dispatch({ environmentId, input });
      if (result._tag === "Success") return true;
      const error = Cause.squash(result.cause);
      toastManager.add({
        type: "error",
        title: "Plan update failed",
        description:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "The server rejected the change.",
      });
      return false;
    },
    [dispatch, environmentId],
  );
}

export type DagDispatch = ReturnType<typeof useDagDispatch>;
