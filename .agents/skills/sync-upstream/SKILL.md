---
name: sync-upstream
description: Merge upstream T3 Code (pingdotgg/t3code) into this trellis fork and resolve the conflicts, including measuring the incoming surface first, resolving the four UI files that habitually conflict, regenerating rather than merging derived files, renumbering incoming migrations into this fork's lineage, restoring the fork's identity where upstream reintroduces its own (Effect service keys, workspace filters, CI runner labels, workflow triggers, repo pointers), and verifying before committing. Use when pulling upstream changes, when asked to "sync with upstream", "merge upstream", or "catch up with T3 Code", when a merge breaks typecheck or CI, or when deciding whether a fork change is shaped to survive future merges.
---

# Sync upstream into trellis

trellis is a fork of T3 Code (`upstream` = pingdotgg/t3code). Upstream moves fast and
we carry a large additive feature (project DAGs). This skill is how a merge is done so
it stays a 20-minute job instead of an afternoon.

**Do not rebase.** Our history is semantic commits that repeatedly touch the same few
UI files, so a rebase replays the same conflict once per commit. Merge, resolve once.

## 1. Never merge into the served checkout

`~/dev/trellis` is usually running a dev server for the human. A conflicted merge there
leaves them with a broken tree mid-session.

Work in the linked worktree (`~/dev/trellis-coherence`, or create one), on a throwaway
branch, then fast-forward `main` after it verifies:

```bash
cd ~/dev/trellis-coherence
git fetch upstream
git checkout -b chore/upstream-sync   # from main
git merge upstream/main
```

Before touching anything, check nothing is executing: a DAG node with a live provider
session must not be interrupted (see `check-live-work` below).

## 2. Measure before resolving

Know the size of what is arriving and where it lands:

```bash
base=$(git merge-base upstream/main main)
git rev-list --count $base..upstream/main                     # incoming commits
git diff --name-only --diff-filter=U                          # actual conflicts
grep -c '^<<<<<<<' <file>                                     # blocks per file
```

Conflict _files_ overstate the work. Five conflicted files have run to five conflict
blocks in practice. Count blocks before estimating.

## 3. Derived files are regenerated, never merged

- `pnpm-lock.yaml` — `git checkout --theirs pnpm-lock.yaml && git add`, then `vp i` at
  the end. Never hand-resolve.
- `apps/web/src/routeTree.gen.ts` — take either side, regenerate with the TanStack
  router generator. It is `@ts-nocheck`'d and machine-written.

## 4. The four files that conflict

Everything server-side merges clean, because it lives in new directories
(`apps/server/src/dag/`, `orchestration/dag/`, `mcp/toolkits/dag/`,
`persistence/*Dags*`) and touches upstream only at list-shaped seams — a switch case, a
union member, a layer in a merge. Conflicts concentrate in the web UI:

| file                                                | why we touch it                             |
| --------------------------------------------------- | ------------------------------------------- |
| `apps/web/src/components/ChatView.tsx`              | Plan right-panel surface + auto-open effect |
| `apps/web/src/components/Sidebar.tsx`               | plan groups, row props, glyph               |
| `apps/web/src/components/RightPanelTabs.tsx`        | the Plan surface entry                      |
| `apps/web/src/components/sidebar/SidebarChrome.tsx` | the Plans nav entry                         |

Two shapes of conflict, and they resolve differently:

**Both sides added adjacent code** — keep both. Ours is usually a marked block
(`// trellis:`) or an extra prop; upstream's is unrelated. Concatenate, don't choose.

**Upstream refactored the seam we edited** — adopt their structure and re-apply our
addition inside it. Do NOT preserve our version of the old structure; that is how a
fork rots. Worked examples from the 59-commit sync:

- Upstream replaced the sidebar footer's inline menu with `SidebarUtilityMenu` /
  `SidebarUtilityItem`. Resolution: take theirs, re-add Plans as one
  `<SidebarUtilityItem icon={<WorkflowIcon />} label="Plans" onClick={handlePlansClick} />`.
- Upstream replaced the right-panel add-surface JSX with a data-driven
  `addSurfaceActions` array. Resolution: take theirs, add Plan as one array entry with
  its shortcut. This turned thirteen scattered hunks into one.

When upstream introduces a registry where we had scattered edits, that is a _win_ —
take it and delete our scatter.

## 4b. Migrations: trellis owns its own lineage

We hold migration ids 41, 42, 43 (`ProjectionDags`, `ProjectionThreadsDagLink`,
`McpCredentials`). Upstream's last is 40, so **the next migration upstream writes will
collide with ours.**

When an upstream migration arrives, do not keep its number. Renumber it to the next free
id in our sequence (44, then 45, ...) and rename its file to match. trellis databases are
a separate lineage from upstream databases; only our numbering ever runs against them, so
a divergent id is correct rather than a compromise.

Do NOT "fix" this by moving our migrations to a high range like 900+. The migrator skips
every migration whose id is `<=` the highest id already recorded
(`effect/unstable/sql/Migrator.ts`, the `currentId <= latestMigrationId` check) — ids are
a high-water mark, not a set. Renumbering ours to 900 would make every future upstream
migration below 900 silently skip on databases that had already reached 902.

`runMigrations` guards the other direction: it compares each recorded `(id, name)` in
`effect_sql_migrations` against `migrationEntries` and fails with
`ForeignMigrationLineageError` if a shared id carries a different name. That is what stops
a `state.sqlite` copied from upstream T3 Code from booting on a half-migrated schema. If
you renumber an upstream migration into our range, that guard is why the name must be
recorded exactly as we list it.

## 4c. Identity: what upstream keeps re-introducing

trellis publishes under its own name, so every upstream merge drags back the old one.
None of this is optional — the first three break the build or the product.

**Effect service keys.** `deterministicKeys` is `error` in `tsconfig.base.json` and derives
each key from the package name, so every service in `apps/server` must be keyed
`trellis/<path>`. Any new service upstream adds arrives keyed `t3/<path>` and fails
typecheck. `tsgo` prints the exact expected key for each one, so this is mechanical:

```bash
pnpm exec vp run --filter trellis typecheck 2>&1 | grep TS377049
```

**Workspace filters.** The server package is `trellis`, not `t3`. Upstream writes
`--filter=t3...` in workflows and `dependsOn: ["t3#build"]` in `apps/desktop/vite.config.ts`.
A stale filter fails with `Package 't3' not found`.

**The published package name is read, never written.** `cloud/pinnedRuntime.ts` takes it
from `packageJson.name`. If a merge reintroduces a literal `"t3"` there, self-update and
the boot service will npm-install upstream's package and exec its binary as ours.

**Runner labels.** Upstream runs on `blacksmith-*`, its paid runner service. We have no
account, so those jobs queue until they time out instead of failing. Map any new one to a
GitHub-hosted label (`ubuntu-24.04`, `macos-latest`), which is free on public repos.

**Workflow triggers.** `release.yml`, `deploy-relay.yml` and `mobile-eas-production.yml` are
`workflow_dispatch`-only here; they need Clerk, Cloudflare and EAS accounts we do not have.
Tagged releases go through `publish-cli.yml`. Merges that restore a `push:` or `schedule:`
trigger put a failing (or, for the nightly cron, three-hourly failing) job back.

**The lint ledger.** `oxlint-plugin-t3code/rules/no-manual-effect-runtime-in-tests.ts` carries
a per-file budget of legacy manual-runtime calls. trellis records
`ProviderCommandReactor.test.ts` at 71 where upstream says 70, because a trellis test added
one in that file's own idiom. Merges will bring back upstream's number. Note that the rule
counts every occurrence and reports whichever is past the budget **in source order**, so an
inline `oxlint-disable` on "our" call does nothing — the error just moves to someone else's.
Either genuinely reduce the file's count or record the real one.

**One state directory.** Three places resolve where the app keeps state, and they must agree
on `~/.trellis`: `apps/server/src/os-jank.ts` (`resolveBaseDir`),
`apps/desktop/src/app/DesktopStatePaths.ts`, and `DEFAULT_T3_HOME` in `scripts/dev-runner.ts`.
Miss one and a dev server writes to `~/.t3/dev` while the desktop reads `~/.trellis/dev`. The
worktree-local `<worktree>/.t3` from `packages/shared/src/devHome.ts` is a different thing and
stays as it is.

**Repo pointers.** `apps/server/src/cli/triagePrompt.ts` must name `thedouglenz/trellis`, or
`trellis triage` fetches upstream's playbook and files issues on their tracker.
`triagePrompt.test.ts` asserts the prompt is **byte-identical** to
`.github/triage/PLAYBOOK.md`, so edit both together — old installs fetch the repo copy from
`main` and follow it when it differs.

### Rename display text; never rename identifiers

When a merge brings in new "T3 Code" or `t3 <cmd>` strings, ask which kind it is. Renamed:
anything a user reads. Left alone, deliberately:

| Kept                                              | Why                                                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `T3CODE_*` env vars                               | ~300 occurrences, invisible to users, pure conflict surface                                                 |
| `t3.json`, its `t3.codes` schema URL              | the project files already in real repositories                                                              |
| `mcp_servers.t3-code` config key                  | wire identity every provider adapter writes; only MCP `serverInfo.name` was renamed                         |
| `legacyUserDataDirName`                           | names a directory that only ever existed as `T3 Code (Alpha)`; renaming breaks the legacy-install migration |
| `~/.t3/ssh-launch`, `~/.t3/dev`, `<worktree>/.t3` | not the server base dir; only `~/.t3/userdata` moved to `~/.trellis/userdata`                               |
| "T3 Connect"                                      | upstream's service, which we do not run                                                                     |
| `apps/desktop/src`, `apps/mobile/src`             | not shipped yet; rename by hand when they ship                                                              |
| `"T3 Code Mobile"` in tests                       | those model the unrenamed mobile client                                                                     |

## 5. Verify before committing

```bash
pnpm exec vp i                                  # after the lockfile reset
# per package, from its directory:
pnpm exec tsgo --noEmit                         # apps/mobile uses: pnpm exec tsc --noEmit
pnpm exec vp test run src/components            # apps/web
pnpm exec vp test run src/dag src/orchestration src/mcp   # apps/server
pnpm exec vp fmt <resolved files>
pnpm exec vp lint <resolved files>
```

Never run repo-wide checks (`vp check`, `vp run -r test`) for a routine merge — CI owns
those, and they are slow enough to hide the signal.

**`vp lint` is not `vp check`.** CI's Check job runs `vp check`, which reported an error on a
tree where `vp lint` reported none. If you are chasing a red Check job, reproduce it with
`vp check`, and read the output rather than grepping it — a narrow grep hid this twice.

`apps/server` typechecks clean as of #1, so there is no longer a baseline of expected
noise. Any `TS377049` / `TS377030` / `TS377026` you see is real.

**Before tagging a release, run the full server suite once anyway:**

```bash
pnpm exec vp run --filter trellis test
```

Picking test files by grepping for the strings you changed is not good enough, and has
missed real breakage twice. It misses cross-file invariants (`triagePrompt.test.ts` compares
against `.github/triage/PLAYBOOK.md`), fixtures that encode a path rather than a message
(`pinnedRuntime.test.ts` builds `node_modules/<pkg>/dist/bin.mjs`), and URL-encoded copies
of a string (`client_label=T3+Code+Mobile`). The full run takes about three minutes.

## 6. Land it

```bash
git commit                # message: what conflicted and WHY each side was chosen
cd ~/dev/trellis && git merge --ff-only chore/upstream-sync
```

If the merge touched `apps/server`, the running dev server needs a restart to pick it
up — see `restart-dev-server` below. Web-only merges hot-reload.

## check-live-work

Before any restart, confirm no DAG node is mid-execution. Node status alone is not
enough — check the session:

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('.t3/userdata/state.sqlite', { readOnly: true });
console.log('live dag sessions:', db.prepare(\"select count(*) n from projection_thread_sessions s join projection_threads t on t.thread_id=s.thread_id where s.status in ('running','starting') and t.dag_link_json is not null\").get().n);
"
```

Non-zero means an agent is working. Ask the human before restarting; killing the server
kills the provider subprocess and strands the node in `running` with a dead session.

## restart-dev-server

`pnpm exec vp run dev` spawns the server in its own process group, and the dev-runner
**respawns it** if the server dies alone. Killing only the listener leaves an orphan
holding the port, and the next start silently shifts to 13774/5734 — which then looks
like two servers fighting over one SQLite file.

Order matters: kill the supervisor first, then reap survivors by verified port
ownership, then start.

```bash
pid=$(cat /tmp/trellis-dev.pid); pgid=$(ps -o pgid= -p $pid | tr -d ' ')
kill -- -$pgid; sleep 4
for r in 1 2; do
  for port in 13773 13774 5733 5734; do
    for p in $(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null); do
      cwd=$(lsof -p $p 2>/dev/null | awk '$4=="cwd"{print $NF}')
      case "$cwd" in /Users/doug/dev/trellis*) kill $p;; esac   # only ours
    done
  done
  sleep 3
done
(pnpm exec vp run dev --home-dir <repo>/.t3 > /tmp/trellis-dev.log 2>&1 &
 echo $! > /tmp/trellis-dev.pid)
until grep -q "pairingUrl:" /tmp/trellis-dev.log; do sleep 2; done
grep -E "dev-runner\]|pairingUrl:" /tmp/trellis-dev.log | head -2
```

Confirm exactly one listener on 13773/5733 afterwards, and hand the human the **full
pairing URL including its token** — the old token dies with the old server.

## Keeping future merges cheap

Judge a fork change by how it will merge, not just whether it works:

- New behavior goes in **new files** under a trellis-owned directory.
- Upstream files are touched only at **list-shaped seams** — a case, a union member, a
  registry entry, an array element. Those merge; interleaved edits inside a function body
  do not.
- Prefer **one entry in a registry** over N scattered hunks. If upstream has no registry
  and we need one, consider contributing it upstream rather than forking around it.
- Mark our insertions with a `// trellis:` comment so a future resolver can tell at a
  glance which side is ours.
- **Merge weekly.** Four conflicted files after 59 commits is cheap; after 500 it is not.
