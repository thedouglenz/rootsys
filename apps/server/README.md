# trellis

A GUI for driving coding agents on your own machine, with your own subscriptions — from a browser, a desktop app, or your phone. It wraps the provider CLIs you already have (Claude Code, Codex, Cursor, Grok Build, OpenCode) rather than replacing them.

```bash
npx @thedouglenz/trellis@latest
```

That starts the server and opens the local web app. `--help` for the full CLI reference.

## This is a fork

trellis is a fork of **[T3 Code](https://github.com/pingdotgg/t3code)**, built by [T3 Tools Inc.](https://github.com/pingdotgg) and MIT licensed. Nearly all of this code is theirs. trellis keeps their copyright notice alongside its own, and sends fixes that belong to T3 Code back upstream.

It is an independent fork, **not a T3 Tools product**. Please don't take trellis bugs to them — [open an issue here](https://github.com/thedouglenz/trellis/issues).

If you want the packaged, supported product, use T3 Code.

## What the fork adds

**Plans** — a graph of work that agents build, edit, and then execute mostly unattended. Nodes are units of work an agent can finish in one focused session; edges say which must finish first. Describe a goal and a planner agent lays out the graph; the execution engine hands each ready node to a coding agent and records the outcome. Nodes that need a decision park themselves and ask, while the rest keeps running.

## Requirements

Node.js `^22.16 || ^23.11 || >=24.10`, and at least one provider CLI installed and authenticated.

Published builds do not bundle the native resource monitors, so per-process CPU and memory display is unavailable. Nothing else is affected.

Full documentation: <https://github.com/thedouglenz/trellis>
