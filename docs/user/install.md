# Install rootsys

rootsys is a web and desktop GUI for running coding agents on your machine.

## Requirements

Node.js `^22.16 || ^23.11 || >=24.10` on the machine that runs the rootsys server.

At least one provider CLI, installed and authenticated. See [Providers](#providers) below.

## Run Without Installing

```bash
npx rootsys@latest
```

This starts the rootsys server on your machine and opens the local web app. Use
`npx rootsys@latest --help` for the full CLI reference.

Published builds do not bundle the native resource monitors, so the per-process CPU and memory
display is unavailable. The server treats the missing binary as a known condition rather than an
error, and nothing else is affected.

## Build From Source

There is no desktop build and no package-registry entry yet. To run the desktop app, or to work
on rootsys itself, build it:

```bash
git clone https://github.com/thedouglenz/rootsys.git
cd rootsys
vp i
vp run dev
```

That needs Node.js 24.13.1+ (stricter than the published CLI) and the
[Vite+](https://viteplus.dev/guide/) `vp` CLI, installed with
`curl -fsSL https://vite.plus | bash` on macOS and Linux, or `irm https://vite.plus/ps1 | iex` on
Windows.

The dev runner prints the URLs it bound to, along with a pairing URL for the web app. Use the
whole pairing URL, token included — the bare origin will not let you in.

## Providers

rootsys drives provider CLIs; it does not ship them. Install the CLI for each provider you want
to use, then authenticate it.

| Provider   | CLI                                                   | Default binary | Log in with           |
| ---------- | ----------------------------------------------------- | -------------- | --------------------- |
| Codex      | [Codex CLI](https://developers.openai.com/codex/cli)  | `codex`        | `codex login`         |
| Claude     | [Claude Code](https://claude.com/product/claude-code) | `claude`       | `claude auth login`   |
| Cursor     | [Cursor CLI](https://cursor.com/cli)                  | `cursor-agent` | `agent login`         |
| Grok Build | [Grok Build CLI](https://x.ai/cli)                    | `grok`         | `grok login`          |
| OpenCode   | [OpenCode](https://opencode.ai)                       | `opencode`     | `opencode auth login` |

Codex and Claude are on by default. Cursor, Grok Build, and OpenCode are off by default; turn
them on in **Settings** → the provider's card when you want to use them.

Cursor is the one to watch: install Cursor CLI, which provides the `cursor-agent` binary that
rootsys looks for, but authenticate with `agent login`, not `cursor-agent login`.

Run the login command on the machine running the rootsys server, not on the device you browse
from.

### Binary Discovery

Each provider CLI must be on the server's `PATH`, or have an explicit binary path set in
**Settings** → the provider instance → **Binary path**. Use the explicit path when a version
manager or a non-standard install location keeps the CLI off the `PATH` of the shell that
started rootsys.

### When Auth Is Needed

Provider auth is required before you start a session with that provider, not before you start
rootsys. You can install rootsys, open it, and add providers afterwards. A provider that is not
authenticated shows its status in **Settings** and fails at session start with the login command
to run.

For multi-account setups, see [Codex](./providers-codex.md) and [Claude](./providers-claude.md).

## Next Steps

- [Permission modes](./permission-modes.md): how much rootsys asks before acting
- [Remote access](./remote-access.md): connect from a phone, tablet, or another desktop
- [Keeping rootsys in sync](./updating.md): client and server version skew
- [Running in the background](./background-service.md): Linux background service
