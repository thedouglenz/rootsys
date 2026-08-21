// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";

import { hydratePosixHome, resolveBaseDir } from "./os-jank.ts";

it("hydrates HOME for minimal service environments from the user account", () => {
  const env: NodeJS.ProcessEnv = {};

  hydratePosixHome(env);

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("hydrates HOME independently of a blank process HOME", () => {
  const originalHome = process.env.HOME;
  const env: NodeJS.ProcessEnv = { HOME: " " };

  try {
    process.env.HOME = " ";
    hydratePosixHome(env);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("preserves an explicitly configured HOME", () => {
  const env: NodeJS.ProcessEnv = { HOME: "/custom/home" };

  hydratePosixHome(env, () => {
    throw new Error("HOME lookup should not run");
  });

  assert.equal(env.HOME, "/custom/home");
});

it.layer(NodeServices.layer)("base directory resolution", (it) => {
  // rootsys must never default into `~/.t3`: upstream T3 Code owns that
  // directory, and the two carry divergent migration ledgers, so a shared
  // state.sqlite would leave one of them unable to migrate.
  it.effect("defaults to ~/.rootsys", () =>
    Effect.gen(function* () {
      const expected = NodePath.join(NodeOS.homedir(), ".rootsys");

      assert.equal(yield* resolveBaseDir(undefined), expected);
      assert.equal(yield* resolveBaseDir(""), expected);
      assert.equal(yield* resolveBaseDir("   "), expected);
    }),
  );

  it.effect("expands a leading ~ in an explicit base dir", () =>
    Effect.gen(function* () {
      assert.equal(
        yield* resolveBaseDir("~/custom-state"),
        NodePath.join(NodeOS.homedir(), "custom-state"),
      );
    }),
  );
});
