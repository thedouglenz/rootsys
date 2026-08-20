/**
 * Companion chat docked into the plan page: a small pane pinned to the
 * bottom-right of the canvas so plan edits happen while the graph stays on
 * screen. Only the plan page uses it; the Plan side panel in chat threads is
 * unchanged.
 *
 * Everything the dock subscribes to lives below `DagCompanionDockBody`, so a
 * closed dock costs one localStorage read and nothing else. Its open state is
 * persisted per plan and shared with the header's Companion button through
 * `useDagCompanionDock`, which keeps the toggle out of `DagPage` — the canvas
 * never re-renders because a message arrived.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useAtomValue } from "@effect/atom-react";
import type {
  DagId,
  EnvironmentId,
  ModelSelection,
  OrchestrationThreadShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  MessageSquarePlusIcon,
  MinusIcon,
  SendHorizontalIcon,
  XIcon,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn, newMessageId } from "../../lib/utils";
import { environmentSnapshotAtom } from "../../state/shell";
import { useEnvironmentPresentation } from "../../state/presentation";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  buildCompanionTranscript,
  DAG_COMPANION_TRANSCRIPT_LIMIT,
  dagCompanionDockStorageKey,
  DagCompanionDockState,
  DEFAULT_DAG_COMPANION_DOCK_STATE,
  selectCompanionThread,
} from "./dagCompanion";
import { DagModelPicker } from "./DagModelPicker";
import { useDagProviders } from "./useDagProviders";
import { useDagThreadKickoff } from "./useDagThreadKickoff";

// The chat markdown renderer pulls syntax highlighting with it; the plan page
// only pays for it once someone opens the dock.
const importChatMarkdown = () => import("../ChatMarkdown");
const ChatMarkdown = lazy(importChatMarkdown);

const EMPTY_THREAD_SHELLS: ReadonlyArray<OrchestrationThreadShell> = [];

/**
 * The dock's persisted open state for one plan. Both the header button and
 * the dock itself read it, so neither has to own the other.
 */
export function useDagCompanionDock(dagId: DagId) {
  return useLocalStorage(
    dagCompanionDockStorageKey(dagId),
    DEFAULT_DAG_COMPANION_DOCK_STATE,
    DagCompanionDockState,
  );
}

export interface DagCompanionDockProps {
  readonly environmentId: EnvironmentId;
  readonly dagId: DagId;
  readonly dagTitle: string;
  /** Null while the plan has no project; the companion cannot start without one. */
  readonly projectId: ProjectId | null;
  /** Plan default, then project default; used only when creating the thread. */
  readonly fallbackModelSelection: ModelSelection | null;
}

export function DagCompanionDock(props: DagCompanionDockProps) {
  const [dockState, setDockState] = useDagCompanionDock(props.dagId);
  if (dockState === "closed") return null;
  return <DagCompanionDockBody {...props} dockState={dockState} onDockStateChange={setDockState} />;
}

/**
 * "Working" is the turn, not the process: `latestTurn` flips the moment the
 * turn is recorded, while the session still reports `starting`.
 */
function isWorking(shell: OrchestrationThreadShell | null): boolean {
  if (shell === null) return false;
  if (shell.latestTurn?.state === "running") return true;
  return shell.session?.status === "running" && shell.session.activeTurnId !== null;
}

/**
 * Anchors the dock to the bottom-right of the canvas. The frame spans the
 * canvas (so the pane's percentage max-height has something definite to
 * resolve against) but never takes a pointer event of its own.
 */
function DockFrame({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-3 z-20 flex items-end justify-end">
      {children}
    </div>
  );
}

function DagCompanionDockBody({
  environmentId,
  dagId,
  dagTitle,
  projectId,
  fallbackModelSelection,
  dockState,
  onDockStateChange,
}: DagCompanionDockProps & {
  readonly dockState: Exclude<DagCompanionDockState, "closed">;
  readonly onDockStateChange: (state: DagCompanionDockState) => void;
}) {
  const navigate = useNavigate();
  // Warm the markdown chunk while the thread loads so the first reply does
  // not arrive into an empty Suspense fallback.
  useEffect(() => {
    void importChatMarkdown();
  }, []);
  const { presentation } = useEnvironmentPresentation(environmentId);
  const connected = presentation?.connection.phase === "connected";
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId));
  const threads = snapshot?.threads ?? EMPTY_THREAD_SHELLS;
  const companion = useMemo(() => selectCompanionThread(threads, dagId), [threads, dagId]);

  const providers = useDagProviders(environmentId);
  const modelSelection = providers.resolveSelection(fallbackModelSelection);
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const { startCompanion } = useDagThreadKickoff();
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  // One failed create must not turn into a retry loop; the user retries.
  const [createFailed, setCreateFailed] = useState(false);

  const create = useCallback(async () => {
    if (creatingRef.current || modelSelection === null || projectId === null) return;
    creatingRef.current = true;
    setCreating(true);
    setCreateFailed(false);
    const threadId = await startCompanion({
      environmentId,
      projectId,
      modelSelection,
      dagId,
      dagTitle,
      navigate: false,
    });
    creatingRef.current = false;
    setCreating(false);
    if (threadId === null) setCreateFailed(true);
  }, [dagId, dagTitle, environmentId, modelSelection, projectId, startCompanion]);

  // Adopt the plan's existing companion thread; only start one when the
  // environment's threads are known and none of them is a live companion.
  useEffect(() => {
    if (dockState !== "open") return;
    if (companion !== null || snapshot === null) return;
    if (creatingRef.current || createFailed || !connected) return;
    if (modelSelection === null || projectId === null) return;
    void create();
  }, [companion, connected, create, createFailed, dockState, modelSelection, projectId, snapshot]);

  const openFullThread = useCallback(
    (threadId: ThreadId) =>
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
      }),
    [environmentId, navigate],
  );

  const working = isWorking(companion);

  if (dockState === "collapsed") {
    return (
      <DockFrame>
        <button
          type="button"
          onClick={() => onDockStateChange("open")}
          className="pointer-events-auto flex h-8 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground shadow-md hover:bg-accent"
          aria-label="Expand the plan companion"
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              working ? "bg-warning" : "bg-muted-foreground/40",
            )}
          />
          Companion
          {working ? <span className="text-muted-foreground">working…</span> : null}
        </button>
      </DockFrame>
    );
  }

  return (
    <DockFrame>
      <section
        aria-label="Plan companion"
        className="pointer-events-auto flex h-130 max-h-[min(70vh,100%)] w-95 max-w-full flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
      >
        <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2.5">
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              working ? "bg-warning" : "bg-muted-foreground/40",
            )}
          />
          <span className="shrink-0 text-xs font-medium">Companion</span>
          {companion !== null ? (
            // The companion inherited the plan default when its thread was
            // created; letting it be repointed here matters when that model
            // is rate-limited, which is exactly when you want to talk to it.
            <span className="flex min-w-0 flex-1 items-center">
              <DagModelPicker
                environmentId={environmentId}
                value={companion.modelSelection}
                onChange={(selection) => {
                  void updateThreadMetadata({
                    environmentId,
                    input: { threadId: companion.id, modelSelection: selection },
                  });
                }}
              />
            </span>
          ) : (
            <span className="flex-1" />
          )}
          {companion !== null ? (
            <>
              {/* A fresh thread is the recovery path when the current one's
                  agent session has lost its tool access. */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Start a new companion conversation"
                      disabled={creating}
                      onClick={() => void create()}
                    >
                      <MessageSquarePlusIcon />
                    </Button>
                  }
                />
                <TooltipPopup side="bottom">New conversation</TooltipPopup>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Open the companion thread"
                      onClick={() => openFullThread(companion.id)}
                    >
                      <ExternalLinkIcon />
                    </Button>
                  }
                />
                <TooltipPopup side="bottom">Open the full thread</TooltipPopup>
              </Tooltip>
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Minimize the companion"
            onClick={() => onDockStateChange("collapsed")}
          >
            <MinusIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close the companion"
            onClick={() => onDockStateChange("closed")}
          >
            <XIcon />
          </Button>
        </header>

        {companion !== null ? (
          <DagCompanionConversation
            environmentId={environmentId}
            shell={companion}
            connected={connected}
            working={working}
            onOpenFullThread={openFullThread}
          />
        ) : (
          <DockPlaceholder
            creating={creating}
            connected={connected}
            failed={createFailed}
            canStart={modelSelection !== null && projectId !== null}
            onRetry={() => void create()}
          />
        )}
      </section>
    </DockFrame>
  );
}

function DockPlaceholder({
  creating,
  connected,
  failed,
  canStart,
  onRetry,
}: {
  readonly creating: boolean;
  readonly connected: boolean;
  readonly failed: boolean;
  /** The plan has both a project and a model to start the companion with. */
  readonly canStart: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
      {!connected ? (
        <p>Reconnecting…</p>
      ) : failed ? (
        <>
          <p>Could not start the companion.</p>
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </>
      ) : !canStart ? (
        <p>Give the plan a project and a model first.</p>
      ) : (
        <>
          <Spinner className="size-4" />
          <p>{creating ? "Starting the companion…" : "Looking for this plan's companion…"}</p>
        </>
      )}
    </div>
  );
}

function DagCompanionConversation({
  environmentId,
  shell,
  connected,
  working,
  onOpenFullThread,
}: {
  readonly environmentId: EnvironmentId;
  readonly shell: OrchestrationThreadShell;
  readonly connected: boolean;
  readonly working: boolean;
  readonly onOpenFullThread: (threadId: ThreadId) => void;
}) {
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, shell.id),
    [environmentId, shell.id],
  );
  const messages = useAtomValue(environmentThreadDetails.messagesAtom(threadRef));
  const transcript = useMemo(() => buildCompanionTranscript(messages), [messages]);

  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const busy = working || sending;

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (element === null) return;
    pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
  }, []);
  useEffect(() => {
    if (!pinnedRef.current) return;
    const element = scrollRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [transcript, busy]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (text.length === 0 || busy || !connected) return;
    setDraft("");
    setSending(true);
    const result = await startTurn({
      environmentId,
      input: {
        threadId: shell.id,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        modelSelection: shell.modelSelection,
        titleSeed: shell.title,
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        createdAt: new Date().toISOString(),
      },
    });
    setSending(false);
    if (result._tag === "Failure") {
      setDraft((current) => (current.length === 0 ? text : current));
      toastManager.add({ type: "error", title: "Could not send to the companion." });
    }
  }, [busy, connected, draft, environmentId, shell, startTurn]);

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2.5 py-2"
      >
        {transcript.hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => onOpenFullThread(shell.id)}
            className="shrink-0 self-center rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Showing the last {DAG_COMPANION_TRANSCRIPT_LIMIT} messages — open full thread
          </button>
        ) : null}
        {transcript.brief !== null ? <CompanionBrief text={transcript.brief} /> : null}
        <Suspense fallback={null}>
          {transcript.entries.map((entry) =>
            entry.role === "user" ? (
              <p
                key={entry.id}
                className="max-w-[85%] self-end whitespace-pre-wrap wrap-break-word rounded-lg bg-muted px-2.5 py-1.5 text-xs text-foreground/90"
              >
                {entry.text}
              </p>
            ) : (
              <ChatMarkdown
                key={entry.id}
                text={entry.text}
                cwd={shell.worktreePath ?? undefined}
                threadRef={threadRef}
                isStreaming={entry.streaming}
                className="max-w-full text-xs"
              />
            ),
          )}
        </Suspense>
        {busy ? (
          <p className="shrink-0 text-[11px] text-muted-foreground">Editing the plan…</p>
        ) : transcript.entries.length === 0 ? (
          <p className="m-auto max-w-64 text-center text-xs text-muted-foreground">
            Ask for plan edits — split a node, add a dependency, retarget models…
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-end gap-1.5 border-t border-border px-2 py-2">
        <textarea
          rows={1}
          value={draft}
          disabled={!connected || busy}
          placeholder={connected ? "Ask for a plan edit…" : "Reconnecting…"}
          aria-label="Message the companion"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void send();
          }}
          className="field-sizing-content max-h-28 min-h-8 w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring disabled:opacity-64 dark:bg-input/32"
        />
        {busy ? (
          <span className="shrink-0 self-center text-[11px] text-muted-foreground">working…</span>
        ) : null}
        <Button
          type="button"
          size="icon-sm"
          className="shrink-0"
          aria-label="Send to the companion"
          disabled={!connected || busy || draft.trim().length === 0}
          onClick={() => void send()}
        >
          <SendHorizontalIcon />
        </Button>
      </div>
    </>
  );
}

/** The seeded brief is a system-ish prompt; show it as a chip, not a wall. */
function CompanionBrief({ text }: { readonly text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="shrink-0 self-start">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDownIcon aria-hidden className="size-3" />
        ) : (
          <ChevronRightIcon aria-hidden className="size-3" />
        )}
        Companion instructions
      </button>
      {expanded ? (
        <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-md bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground">
          {text}
        </p>
      ) : null}
    </div>
  );
}
