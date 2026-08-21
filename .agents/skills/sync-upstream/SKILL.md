---
name: sync-upstream
description: Merge upstream T3 Code (pingdotgg/t3code) into this rootsys fork and resolve the conflicts, including measuring the incoming surface first, resolving the four UI files that habitually conflict, regenerating rather than merging derived files, and verifying before committing. Use when pulling upstream changes, when asked to "sync with upstream", "merge upstream", or "catch up with T3 Code", or when deciding whether a fork change is shaped to survive future merges.
---

# Sync upstream into rootsys

rootsys is a fork of T3 Code (`upstream` = pingdotgg/t3code). Upstream moves fast and
we carry a large additive feature (project DAGs). This skill is how a merge is done so
it stays a 20-minute job instead of an afternoon.

**Do not rebase.** Our history is semantic commits that repeatedly touch the same few
UI files, so a rebase replays the same conflict once per commit. Merge, resolve once.

## 1. Never merge into the served checkout

`~/dev/rootsys` is usually running a dev server for the human. A conflicted merge there
leaves them with a broken tree mid-session.

Work in the linked worktree (`~/dev/rootsys-coherence`, or create one), on a throwaway
branch, then fast-forward `main` after it verifies:

```bash
cd ~/dev/rootsys-coherence
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
(`// rootsys:`) or an extra prop; upstream's is unrelated. Concatenate, don't choose.

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

Never run repo-wide checks (`vp check`, `vp run -r test`) — CI owns those, and they are
slow enough to hide the signal. Pre-existing `TS377030` / `TS377026` diagnostics in
`bin.test.ts` and migration tests are noise; compare against the pre-merge baseline
before believing a new error.

## 6. Land it

```bash
git commit                # message: what conflicted and WHY each side was chosen
cd ~/dev/rootsys && git merge --ff-only chore/upstream-sync
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
pid=$(cat /tmp/rootsys-dev.pid); pgid=$(ps -o pgid= -p $pid | tr -d ' ')
kill -- -$pgid; sleep 4
for r in 1 2; do
  for port in 13773 13774 5733 5734; do
    for p in $(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null); do
      cwd=$(lsof -p $p 2>/dev/null | awk '$4=="cwd"{print $NF}')
      case "$cwd" in /Users/doug/dev/rootsys*) kill $p;; esac   # only ours
    done
  done
  sleep 3
done
(pnpm exec vp run dev --home-dir <repo>/.t3 > /tmp/rootsys-dev.log 2>&1 &
 echo $! > /tmp/rootsys-dev.pid)
until grep -q "pairingUrl:" /tmp/rootsys-dev.log; do sleep 2; done
grep -E "dev-runner\]|pairingUrl:" /tmp/rootsys-dev.log | head -2
```

Confirm exactly one listener on 13773/5733 afterwards, and hand the human the **full
pairing URL including its token** — the old token dies with the old server.

## Keeping future merges cheap

Judge a fork change by how it will merge, not just whether it works:

- New behavior goes in **new files** under a rootsys-owned directory.
- Upstream files are touched only at **list-shaped seams** — a case, a union member, a
  registry entry, an array element. Those merge; interleaved edits inside a function body
  do not.
- Prefer **one entry in a registry** over N scattered hunks. If upstream has no registry
  and we need one, consider contributing it upstream rather than forking around it.
- Mark our insertions with a `// rootsys:` comment so a future resolver can tell at a
  glance which side is ours.
- **Merge weekly.** Four conflicted files after 59 commits is cheap; after 500 it is not.
