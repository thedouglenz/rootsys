import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  DAG_RUN_BLOCKER_HINTS,
  type DagNodeView,
  resolveDagPrimaryAction,
  resolveDagRunBlocker,
} from "@t3tools/client-runtime/state/dags";
import {
  DagId,
  type DagGraph,
  type DagQuestion,
  EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { StatusPill } from "../../components/StatusPill";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { environmentDags } from "../../state/dags";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironmentPresentation } from "../../state/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { WorkspaceSidebarToolbar } from "../layout/workspace-sidebar-toolbar";
import { SettingsSection } from "../settings/components/SettingsSection";
import {
  dagNodeStatusTone,
  dagNodeSummaryLine,
  dagStatusTone,
  orderedDagNodeViews,
} from "./planPresentation";
import { type LinkedPlanThread, linkedPlanThreads, threadDagRoleLabel } from "./threadPlanLink";
import { type DagDispatch, useDagDispatch } from "./useDagDispatch";

type PlanDetailRouteScreenProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly dagId: string;
}>;

function ActionButton(props: {
  readonly label: string;
  readonly icon: "play" | "pause";
  readonly disabled?: boolean;
  readonly variant?: "primary" | "outline" | "ghost";
  readonly onPress: () => void;
}) {
  const variant = props.variant ?? "primary";
  const primaryForeground = useThemeColor("--color-primary-foreground");
  const foreground = useThemeColor("--color-foreground");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      className={cn(
        "flex-row items-center gap-2 rounded-full px-4 py-2.5 active:opacity-70",
        variant === "primary" ? "bg-primary" : "border border-border bg-card",
        props.disabled && "opacity-40",
      )}
    >
      <SymbolView
        name={props.icon}
        size={14}
        tintColor={variant === "primary" ? primaryForeground : foreground}
        type="monochrome"
      />
      <Text
        className={cn(
          "text-sm font-t3-bold",
          variant === "primary" ? "text-primary-foreground" : "text-foreground",
        )}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function PlanHeader(props: {
  readonly graph: DagGraph;
  readonly environmentLabel: string | null;
  readonly dispatch: DagDispatch;
}) {
  const { dag } = props.graph;
  const projects = useProjects();
  const project = useMemo(
    () => projects.find((candidate) => candidate.id === dag.primaryProjectId) ?? null,
    [dag.primaryProjectId, projects],
  );
  const runBlocker = resolveDagRunBlocker({
    graph: props.graph,
    projectDefaultModelSelection: project?.defaultModelSelection ?? null,
  });
  // Graph-aware: a plan whose nodes are all finished offers no run
  // action at all, matching the web header.
  const runAction = resolveDagPrimaryAction(props.graph);
  const tone = dagStatusTone(dag.status);
  const doneCount = props.graph.nodes.filter(
    (node) => node.status === "done" || node.status === "skipped",
  ).length;
  const setStatus = (status: "running" | "paused") =>
    void props.dispatch({ type: "dag.status.set", dagId: dag.dagId, status });

  return (
    <View className="gap-3 rounded-[24px] border-continuous bg-card p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-xl font-t3-bold text-foreground">{dag.title}</Text>
          <Text className="text-sm text-foreground-muted" numberOfLines={1}>
            {[project?.title ?? "No project", props.environmentLabel]
              .filter((part): part is string => part !== null)
              .join(" · ")}
            {" · "}
            {doneCount}/{props.graph.nodes.length} done
          </Text>
        </View>
        <StatusPill {...tone} />
      </View>
      {dag.description.length > 0 ? (
        <Text className="text-sm leading-normal text-foreground-muted">{dag.description}</Text>
      ) : null}
      {runAction === "finished" ? (
        <Text className="text-xs text-foreground-muted">All nodes finished</Text>
      ) : null}
      {runAction === null || runAction === "finished" ? null : (
        <View className="gap-2">
          <View className="flex-row">
            {runAction === "pause" ? (
              <ActionButton
                label="Pause"
                icon="pause"
                variant="outline"
                onPress={() => setStatus("paused")}
              />
            ) : (
              <ActionButton
                label={runAction === "resume" ? "Resume" : "Run"}
                icon="play"
                disabled={runBlocker !== null}
                onPress={() => setStatus("running")}
              />
            )}
          </View>
          {runAction !== "pause" && runBlocker !== null ? (
            <Text className="text-xs text-foreground-muted">
              {DAG_RUN_BLOCKER_HINTS[runBlocker]}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

function QuestionRow(props: {
  readonly question: DagQuestion;
  readonly nodeTitle: string;
  readonly first: boolean;
  readonly dispatch: DagDispatch;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const answer = async (value: string | null) => {
    setPending(true);
    const ok = await props.dispatch({
      type: "dag.question.answer",
      dagId: props.question.dagId,
      questionId: props.question.questionId,
      answer: value,
    });
    if (!ok) setPending(false);
  };
  const trimmed = text.trim();
  return (
    <View className={cn("gap-3 p-4", !props.first && "border-t border-border")}>
      <Text className="text-xs text-foreground-muted">{props.nodeTitle}</Text>
      <Text className="text-base leading-normal text-foreground">{props.question.prompt}</Text>
      {props.question.options.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {props.question.options.map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              disabled={pending}
              onPress={() => void answer(option)}
              className={cn(
                "rounded-full border border-border bg-subtle px-3.5 py-2 active:opacity-70",
                pending && "opacity-40",
              )}
            >
              <Text className="text-sm font-t3-medium text-foreground">{option}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <TextInput
        accessibilityLabel="Answer"
        editable={!pending}
        multiline
        placeholder="Type an answer"
        value={text}
        onChangeText={setText}
      />
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          disabled={pending || trimmed.length === 0}
          onPress={() => void answer(trimmed)}
          className={cn(
            "rounded-full bg-primary px-4 py-2.5 active:opacity-70",
            (pending || trimmed.length === 0) && "opacity-40",
          )}
        >
          <Text className="text-sm font-t3-bold text-primary-foreground">Answer</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={pending}
          onPress={() => void answer(null)}
          className={cn("rounded-full px-4 py-2.5 active:opacity-70", pending && "opacity-40")}
        >
          <Text className="text-sm font-t3-medium text-foreground-muted">Dismiss</Text>
        </Pressable>
        {pending ? <ActivityIndicator /> : null}
      </View>
    </View>
  );
}

function NodeRow(props: {
  readonly view: DagNodeView;
  readonly first: boolean;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const { node } = props.view;
  const chevron = useThemeColor("--color-chevron");
  const tone = dagNodeStatusTone(props.view.displayStatus);
  const summary = dagNodeSummaryLine(props.view);
  const threadId = node.threadId;
  const content = (
    <>
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-base font-t3-medium text-foreground" numberOfLines={2}>
          {node.title}
        </Text>
        {summary !== null ? (
          <Text className="text-sm text-foreground-muted" numberOfLines={2}>
            {summary}
          </Text>
        ) : null}
        {props.view.openQuestionCount > 0 ? (
          <Text className="text-xs text-danger-foreground">
            {props.view.openQuestionCount} open question
            {props.view.openQuestionCount === 1 ? "" : "s"}
          </Text>
        ) : null}
      </View>
      <StatusPill size="compact" {...tone} />
      {threadId !== null ? (
        <SymbolView
          name="chevron.right"
          size={16}
          tintColor={chevron}
          type="monochrome"
          weight="semibold"
        />
      ) : null}
    </>
  );
  const className = cn("flex-row items-center gap-3 p-4", !props.first && "border-t border-border");
  if (threadId === null) {
    return <View className={className}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open thread for ${node.title}`}
      className={cn(className, "active:opacity-70")}
      onPress={() => props.onOpenThread(threadId)}
    >
      {content}
    </Pressable>
  );
}

function LinkedThreadRow(props: {
  readonly entry: LinkedPlanThread;
  readonly first: boolean;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const { thread, role, nodeTitle } = props.entry;
  const chevron = useThemeColor("--color-chevron");
  const detail = [threadDagRoleLabel(role), nodeTitle]
    .filter((part): part is string => part !== null)
    .join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open thread ${thread.title}`}
      className={cn(
        "flex-row items-center gap-3 p-4 active:opacity-70",
        !props.first && "border-t border-border",
      )}
      onPress={() => props.onOpenThread(thread.id)}
    >
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-base font-t3-medium text-foreground" numberOfLines={2}>
          {thread.title}
        </Text>
        <Text className="text-sm text-foreground-muted" numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <SymbolView
        name="chevron.right"
        size={16}
        tintColor={chevron}
        type="monochrome"
        weight="semibold"
      />
    </Pressable>
  );
}

function PlanDetailChrome(props: { readonly title: string; readonly children: React.ReactNode }) {
  const navigation = useNavigation();
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <WorkspaceSidebarToolbar />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader title={props.title} onBack={() => navigation.goBack()} />
      ) : (
        <NativeStackScreenOptions options={{ title: props.title }} />
      )}
      {props.children}
    </View>
  );
}

/**
 * One plan: status + run controls, the open-question inbox, and the node list
 * in dependency order. Editing the graph stays on web/desktop.
 */
export function PlanDetailRouteScreen(props: PlanDetailRouteScreenProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const dagId = DagId.make(props.route.params.dagId);
  const { isReady: catalogReady, presentation } = useEnvironmentPresentation(environmentId);
  const subscription = useEnvironmentQuery(
    environmentDags.stateAtom({ environmentId, input: { dagId } }),
  );
  const dispatch = useDagDispatch(environmentId);
  const state = subscription.data;
  const graph = state?.graph ?? null;
  const openQuestions = useMemo(
    () => graph?.questions.filter((question) => question.status === "open") ?? [],
    [graph],
  );
  const nodeTitle = useMemo(
    () => new Map(graph?.nodes.map((node) => [node.nodeId, node.title] as const) ?? []),
    [graph],
  );
  const nodeViews = useMemo(() => (graph === null ? [] : orderedDagNodeViews(graph)), [graph]);
  const threadShells = useThreadShells();
  const linkedThreads = useMemo(
    () =>
      linkedPlanThreads(
        threadShells.filter((shell) => shell.environmentId === environmentId),
        dagId,
        graph,
      ),
    [dagId, environmentId, graph, threadShells],
  );

  if (presentation === null && catalogReady) {
    return (
      <PlanDetailChrome title="Plan">
        <View className="flex-1 justify-center px-5">
          <EmptyState
            title="Environment not connected"
            detail="This plan lives on a server that is not connected right now."
          />
        </View>
      </PlanDetailChrome>
    );
  }

  if (
    state?.status === "deleted" ||
    (state?.status === "live" && graph === null) ||
    subscription.error !== null
  ) {
    return (
      <PlanDetailChrome title="Plan">
        <View className="flex-1 justify-center px-5">
          <EmptyState
            title="Plan not found"
            detail={state?.status === "deleted" ? "It was deleted." : "It may have been deleted."}
          />
        </View>
      </PlanDetailChrome>
    );
  }

  if (graph === null) {
    return (
      <PlanDetailChrome title="Plan">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </PlanDetailChrome>
    );
  }

  return (
    <PlanDetailChrome title={graph.dag.title}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <PlanHeader
          graph={graph}
          environmentLabel={presentation?.entry.target.label ?? null}
          dispatch={dispatch}
        />
        {openQuestions.length > 0 ? (
          <SettingsSection
            title={`${openQuestions.length} open question${openQuestions.length === 1 ? "" : "s"}`}
            card
          >
            {openQuestions.map((question, index) => (
              <QuestionRow
                key={question.questionId}
                question={question}
                nodeTitle={nodeTitle.get(question.nodeId) ?? question.nodeId}
                first={index === 0}
                dispatch={dispatch}
              />
            ))}
          </SettingsSection>
        ) : null}
        <SettingsSection title="Nodes" card>
          {nodeViews.length === 0 ? (
            <Text className="px-4 py-5 text-sm text-foreground-muted">
              No nodes yet. Add them from the plan on web or desktop.
            </Text>
          ) : (
            nodeViews.map((view, index) => (
              <NodeRow
                key={view.node.nodeId}
                view={view}
                first={index === 0}
                onOpenThread={(threadId) =>
                  navigation.navigate("Thread", { environmentId, threadId })
                }
              />
            ))
          )}
        </SettingsSection>
        {linkedThreads.length > 0 ? (
          <SettingsSection title="Threads" card>
            {linkedThreads.map((entry, index) => (
              <LinkedThreadRow
                key={`${entry.thread.environmentId}:${entry.thread.id}`}
                entry={entry}
                first={index === 0}
                onOpenThread={(threadId) =>
                  navigation.navigate("Thread", { environmentId, threadId })
                }
              />
            ))}
          </SettingsSection>
        ) : null}
      </ScrollView>
    </PlanDetailChrome>
  );
}
