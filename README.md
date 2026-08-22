# rootsys

rootsys is a fork of [T3 Code](https://github.com/pingdotgg/t3code) that adds **plans**: a graph of work that agents build, edit, and then execute mostly unattended.

A plan's nodes are units of work an agent can finish in one focused session. Its edges say which nodes must finish before others may start. You describe a goal, a planner agent explores the repository and lays out the graph, and the execution engine hands each ready node to a coding agent and records what happened.

Everything T3 Code does, rootsys still does — it wraps the provider CLIs you already have (Claude Code, Codex, Cursor, Grok Build, OpenCode) and serves web, desktop, and mobile clients from a local server.

## What the fork adds

- **A plan canvas.** Nodes and dependencies laid out visually, editable by hand or by a companion agent that talks to a restricted `dag_*` toolkit over MCP.
- **Up-front planning.** Give a goal instead of a graph and a planner agent builds the plan, then summarizes it for you before anything runs.
- **Unattended execution.** Ready nodes run in dependency order, each as a thread turn. Failures pause the plan and explain why rather than cascading.
- **A question inbox.** A node that needs a decision parks itself as `blocked:question` while the rest of the frontier keeps running.
- **Per-node model selection.** Cheap models for mechanical nodes, expensive ones where it matters.

See [docs/user/plans.md](./docs/user/plans.md) for how to drive it, and [docs/internals/dag.md](./docs/internals/dag.md) for how it works.

## Relationship to T3 Code

T3 Code is built by [T3 Tools](https://github.com/pingdotgg) and is MIT licensed. rootsys keeps that license and that copyright notice, tracks upstream continuously, and sends non-plan fixes back where they apply.

This is an independent fork, not a T3 Tools product. Please don't take rootsys bugs to them — [open an issue here](https://github.com/thedouglenz/rootsys/issues) instead.

rootsys deliberately keeps its own identity so the two can coexist on one machine: its own npm package and binary, and its own state directory at `~/.rootsys`. It also keeps its own migration lineage, so a `state.sqlite` written by T3 Code is refused rather than silently half-migrated.

## Status

Early, and not yet published. There is no npm package, no desktop build, and no app-store listing — the only way to run it today is from source.

If you want the polished, installable product, use [T3 Code](https://github.com/pingdotgg/t3code). Come back here when you want plans.

## Running from source

You need Node.js 24.13.1+ and at least one provider CLI installed and authenticated:

- Codex: [Codex CLI](https://developers.openai.com/codex/cli), then `codex login`
- Claude: [Claude Code](https://claude.com/product/claude-code), then `claude auth login`
- Cursor: [Cursor CLI](https://cursor.com/cli), then `agent login`
- Grok Build: [Grok Build CLI](https://x.ai/cli), then `grok login`
- OpenCode: [OpenCode](https://opencode.ai), then `opencode auth login`

rootsys uses [Vite+](https://viteplus.dev/guide/), so install the `vp` CLI first:

```bash
curl -fsSL https://vite.plus | bash    # macOS / Linux
irm https://vite.plus/ps1 | iex        # Windows
```

Then:

```bash
git clone https://github.com/thedouglenz/rootsys.git
cd rootsys
vp i
vp run dev
```

The dev runner prints the URLs it bound to. The web app requires pairing — use the full pairing URL it prints, token included.

## Documentation

Full docs live in [docs/](./docs). There's no docs site.

- [Plans](./docs/user/plans.md)
- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Customize a project icon](./docs/user/project-settings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- Linux: [run rootsys as a background service](./docs/user/background-service.md)

Building on it? Start at [docs/internals/overview.md](./docs/internals/overview.md), then [docs/internals/dag.md](./docs/internals/dag.md).

## Contributing

It's early and the plan surface moves fast, so please open an issue before starting anything large.

Fixes that belong to T3 Code rather than to plans are better sent [upstream](https://github.com/pingdotgg/t3code) — everyone downstream gets them that way, this fork included.
