import { CommandId, ORCHESTRATION_WS_METHODS, type DagCommand } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { EnvironmentSupervisor } from "../connection/supervisor.ts";
import {
  type EnvironmentRpcFailure,
  type EnvironmentRpcSuccess,
  type EnvironmentRpcUnavailableError,
  request,
} from "../rpc/client.ts";

type DagCommandType = DagCommand["type"];
type DagCommandOf<T extends DagCommandType> = Extract<DagCommand, { readonly type: T }>;
/** Command payload without the envelope fields the helper fills in. */
export type DagCommandInput<T extends DagCommandType> = Omit<
  DagCommandOf<T>,
  "type" | "commandId" | "createdAt"
> & { readonly commandId?: CommandId };

type DispatchTag = typeof ORCHESTRATION_WS_METHODS.dispatchCommand;
type DagCommandEffect = Effect.Effect<
  EnvironmentRpcSuccess<DispatchTag>,
  EnvironmentRpcFailure<DispatchTag> | EnvironmentRpcUnavailableError,
  Crypto.Crypto | EnvironmentSupervisor
>;

const commandId = (input: { readonly commandId?: CommandId }) =>
  input.commandId !== undefined
    ? Effect.succeed(input.commandId)
    : Crypto.Crypto.pipe(
        Effect.flatMap((crypto) => crypto.randomUUIDv4.pipe(Effect.orDie)),
        Effect.map(CommandId.make),
      );

/**
 * Generic DAG command dispatcher: fills `commandId` (and `createdAt` for
 * `dag.create`) and sends through `orchestration.dispatchCommand`.
 */
export const dispatchDagCommand: <T extends DagCommandType>(
  type: T,
  input: DagCommandInput<T>,
) => DagCommandEffect = Effect.fn("EnvironmentCommands.dispatchDagCommand")(
  function* (type, input) {
    const id = yield* commandId(input);
    const command = {
      ...input,
      type,
      commandId: id,
      ...(type === "dag.create"
        ? { createdAt: yield* DateTime.now.pipe(Effect.map(DateTime.formatIso)) }
        : {}),
    } as DagCommand;
    return yield* request(ORCHESTRATION_WS_METHODS.dispatchCommand, command);
  },
);
