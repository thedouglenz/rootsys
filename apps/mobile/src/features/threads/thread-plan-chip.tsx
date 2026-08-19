import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { type EnvironmentId, type ThreadDagLink } from "@t3tools/contracts";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { useThemeColor } from "../../lib/useThemeColor";
import { environmentDags } from "../../state/dags";
import { threadPlanChipLabel } from "../plans/threadPlanLink";

function ExecutorChipLabel(props: {
  readonly environmentId: EnvironmentId;
  readonly link: ThreadDagLink;
}) {
  // Only executors need the graph (for the node title), so the DAG
  // subscription is scoped to this branch rather than every linked thread.
  const { graph } = useAtomValue(
    environmentDags.graphAtom({ environmentId: props.environmentId, dagId: props.link.dagId }),
  );
  return <ChipText label={threadPlanChipLabel(props.link, graph)} />;
}

function ChipText(props: { readonly label: string }) {
  return (
    <Text className="text-xs font-t3-medium text-foreground" numberOfLines={1}>
      {props.label}
    </Text>
  );
}

/**
 * Floating "Plan · …" pill pinned under the thread header for threads linked
 * to a DAG. Tapping opens the plan. `topInset` is the header height on
 * surfaces where content underlaps the native header (iOS glass), else 0.
 */
export function ThreadPlanChip(props: {
  readonly environmentId: EnvironmentId;
  readonly link: ThreadDagLink;
  readonly topInset: number;
}) {
  const navigation = useNavigation();
  const iconColor = useThemeColor("--color-foreground-muted");
  return (
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0 z-10 flex-row px-4"
      style={{ top: props.topInset + 8 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open plan"
        onPress={() =>
          navigation.navigate("PlanDetail", {
            environmentId: props.environmentId,
            dagId: props.link.dagId,
          })
        }
        className="max-w-full flex-row items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 active:opacity-70"
      >
        <SymbolView
          name="point.3.connected.trianglepath.dotted"
          size={12}
          tintColor={iconColor}
          type="monochrome"
        />
        {props.link.role === "executor" ? (
          <ExecutorChipLabel environmentId={props.environmentId} link={props.link} />
        ) : (
          <ChipText label={threadPlanChipLabel(props.link, null)} />
        )}
      </Pressable>
    </View>
  );
}
