import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { McpServer } from "effect/unstable/ai";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import * as McpHttpServer from "./McpHttpServer.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";

/**
 * Both toolkits must reach the same McpServer instance. Registering only the
 * preview toolkit (as the older test did) hid a regression where agents saw
 * `preview_*` but no `dag_*` tools at all.
 */
const StubOrchestrationEngine = Layer.succeed(OrchestrationEngineService, {
  readEvents: () => Stream.empty,
  dispatch: () => Effect.succeed({ sequence: 0 }),
  streamDomainEvents: Stream.empty,
  latestSequence: Effect.succeed(0),
} as unknown as OrchestrationEngineService["Service"]);

const StubSnapshotQuery = Layer.succeed(ProjectionSnapshotQuery, {
  getDagGraph: () => Effect.succeed(Option.none()),
} as unknown as ProjectionSnapshotQuery["Service"]);

const StubProviderRegistry = Layer.succeed(ProviderRegistry, {
  getProviders: Effect.succeed([]),
} as unknown as ProviderRegistry["Service"]);

const TestLayer = Layer.mergeAll(
  McpHttpServer.PreviewToolkitRegistrationLive,
  McpHttpServer.DagToolkitRegistrationLive,
).pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provideMerge(PreviewAutomationBroker.layer.pipe(Layer.provide(NodeServices.layer))),
  Layer.provideMerge(StubOrchestrationEngine),
  Layer.provideMerge(StubSnapshotQuery),
  Layer.provideMerge(StubProviderRegistry),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("MCP toolkit registration", (it) => {
  it.effect("registers the dag toolkit alongside preview", () =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const names = server.tools.map(({ tool }) => tool.name);
      expect(names).toContain("preview_status");
      for (const expected of [
        "dag_get",
        "dag_list",
        "dag_upsert_node",
        "dag_set_node_status",
        "dag_ask_user",
        "dag_list_models",
      ]) {
        expect(names).toContain(expected);
      }
    }),
  );

  /**
   * MCP requires every tool's `inputSchema` to be an object schema, and a
   * client that rejects one tool drops the *whole* server's toolset: agents
   * then see `t3-code` connected with zero tools and no error anywhere.
   * `Schema.Struct({})` renders as `anyOf: [object, array]`, so a no-argument
   * tool must omit `parameters` entirely rather than declare an empty struct.
   */
  it.effect("declares an object inputSchema for every tool", () =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const offenders = server.tools
        .map(({ tool }) => ({
          name: tool.name,
          type: (tool.inputSchema as { readonly type?: unknown }).type,
        }))
        .filter(({ type }) => type !== "object");
      expect(offenders).toEqual([]);
    }),
  );
});
