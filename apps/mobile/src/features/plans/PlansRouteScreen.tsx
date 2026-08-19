import { useNavigation } from "@react-navigation/native";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { DagShell, EnvironmentId } from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { StatusPill } from "../../components/StatusPill";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { useThemeColor } from "../../lib/useThemeColor";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentDags } from "../../state/dags";
import { useProjects } from "../../state/entities";
import { type EnvironmentPresentation, useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { WorkspaceSidebarToolbar } from "../layout/workspace-sidebar-toolbar";
import { SettingsSection } from "../settings/components/SettingsSection";
import { dagStatusTone } from "./planPresentation";

function plansListAtom(environmentId: EnvironmentId, includeArchived: boolean) {
  return environmentDags.listAtom({
    environmentId,
    input: includeArchived ? { includeArchived: true } : {},
  });
}

function PlanRow(props: {
  readonly environmentId: EnvironmentId;
  readonly dag: DagShell;
  readonly projectTitle: string | null;
  readonly first: boolean;
}) {
  const navigation = useNavigation();
  const chevron = useThemeColor("--color-chevron");
  const warning = useThemeColor("--color-danger-foreground");
  const tone = dagStatusTone(props.dag.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open plan ${props.dag.title}`}
      className={
        props.first
          ? "flex-row items-center gap-3 p-4 active:opacity-70"
          : "border-t border-border flex-row items-center gap-3 p-4 active:opacity-70"
      }
      onPress={() =>
        navigation.navigate("PlanDetail", {
          environmentId: props.environmentId,
          dagId: props.dag.dagId,
        })
      }
    >
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-base font-t3-medium text-foreground" numberOfLines={1}>
          {props.dag.title}
        </Text>
        <View className="flex-row items-center gap-2">
          <Text className="shrink text-sm text-foreground-muted" numberOfLines={1}>
            {props.projectTitle ?? "No project"}
            {" · "}
            {props.dag.doneCount}/{props.dag.nodeCount} node{props.dag.nodeCount === 1 ? "" : "s"}{" "}
            done
          </Text>
          {props.dag.openQuestionCount > 0 ? (
            <View className="flex-row items-center gap-1">
              <SymbolView
                name="questionmark.circle"
                size={13}
                tintColor={warning}
                type="monochrome"
              />
              <Text className="text-sm text-danger-foreground">{props.dag.openQuestionCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <StatusPill size="compact" {...tone} />
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

function EnvironmentPlansSection(props: {
  readonly environment: EnvironmentPresentation;
  readonly includeArchived: boolean;
  readonly projects: ReadonlyArray<EnvironmentProject>;
}) {
  const query = useEnvironmentQuery(
    plansListAtom(props.environment.environmentId, props.includeArchived),
  );
  const projectTitle = useMemo(
    () => new Map(props.projects.map((project) => [project.id, project.title] as const)),
    [props.projects],
  );
  const dags = query.data?.dags ?? null;
  return (
    <SettingsSection title={props.environment.label} card>
      {dags === null ? (
        <Text className="px-4 py-5 text-sm text-foreground-muted">
          {query.error !== null ? `Could not load plans: ${query.error}` : "Loading plans…"}
        </Text>
      ) : dags.length === 0 ? (
        <Text className="px-4 py-5 text-sm text-foreground-muted">No plans yet.</Text>
      ) : (
        dags.map((dag, index) => (
          <PlanRow
            key={dag.dagId}
            environmentId={props.environment.environmentId}
            dag={dag}
            first={index === 0}
            projectTitle={
              dag.primaryProjectId === null
                ? null
                : (projectTitle.get(dag.primaryProjectId) ?? null)
            }
          />
        ))
      )}
    </SettingsSection>
  );
}

/**
 * Plans across every connected environment. Plans are created and edited on
 * web/desktop; mobile lists them, shows progress, and answers questions.
 */
export function PlansRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environments, isReady } = useEnvironments();
  const projects = useProjects();
  const [includeArchived, setIncludeArchived] = useState(false);
  // Each environment's section re-renders from its own query; the pull just
  // invalidates them, so the control never needs to hold a spinner.
  const refresh = useCallback(() => {
    for (const environment of environments) {
      appAtomRegistry.refresh(plansListAtom(environment.environmentId, includeArchived));
    }
  }, [environments, includeArchived]);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <WorkspaceSidebarToolbar />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader title="Plans" onBack={() => navigation.goBack()} />
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
      >
        <View className="flex-row items-center justify-between px-2">
          <Text className="text-sm text-foreground-muted">Show archived</Text>
          <ThemedSwitch value={includeArchived} onValueChange={setIncludeArchived} />
        </View>
        {environments.length === 0 ? (
          <EmptyState
            title={isReady ? "No environments" : "Connecting…"}
            detail={
              isReady
                ? "Connect an environment to see its plans."
                : "Plans appear once an environment is connected."
            }
          />
        ) : (
          environments.map((environment) => (
            <EnvironmentPlansSection
              key={environment.environmentId}
              environment={environment}
              includeArchived={includeArchived}
              projects={projects}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
