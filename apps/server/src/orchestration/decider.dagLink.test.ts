import {
  CommandId,
  DagId,
  DagNodeId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const projectId = ProjectId.make("project-1");

const readModel: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [
    {
      id: projectId,
      title: "Project",
      workspaceRoot: "/tmp/project-1",
      defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      scripts: [],
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    },
  ],
  threads: [],
  updatedAt: NOW,
};

const createCommand = (input: {
  readonly threadId: string;
  readonly dagLink?: { dagId: DagId; nodeId: DagNodeId | null; role: "executor" | "planner" };
}) =>
  ({
    type: "thread.create",
    commandId: CommandId.make(`cmd-${input.threadId}`),
    threadId: ThreadId.make(input.threadId),
    projectId,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    ...(input.dagLink !== undefined ? { dagLink: input.dagLink } : {}),
    createdAt: NOW,
  }) as const;

it.layer(NodeServices.layer)("thread.create dagLink decider", (it) => {
  it.effect("copies the command's dagLink into thread.created", () =>
    Effect.gen(function* () {
      const dagLink = {
        dagId: DagId.make("dag-1"),
        nodeId: DagNodeId.make("node-1"),
        role: "executor" as const,
      };
      const event = yield* decideOrchestrationCommand({
        command: createCommand({ threadId: "thread-1", dagLink }),
        readModel,
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events[0]?.type).toBe("thread.created");
      if (events[0]?.type === "thread.created") {
        expect(events[0].payload.dagLink).toEqual(dagLink);
      }
    }),
  );

  it.effect("defaults dagLink to null when the command omits it", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: createCommand({ threadId: "thread-2" }),
        readModel,
      });
      const events = Array.isArray(event) ? event : [event];
      if (events[0]?.type === "thread.created") {
        expect(events[0].payload.dagLink).toBeNull();
      }
    }),
  );
});
