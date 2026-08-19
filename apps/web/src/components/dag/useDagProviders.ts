import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { serverEnvironment } from "../../state/server";

const EMPTY_PROVIDERS: ReadonlyArray<never> = [];

/**
 * Provider/model picker inputs for one environment. Plans live in a specific
 * environment, so the picker must list that server's instances rather than
 * the primary one's.
 */
export function useDagProviders(environmentId: EnvironmentId) {
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const settings = useEnvironmentSettings(environmentId);
  const providers = serverConfig?.providers ?? EMPTY_PROVIDERS;
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
      ),
    [providers, settings],
  );
  const modelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(settings, providers),
    [providers, settings],
  );
  const resolveSelection = useCallback(
    (selection: ModelSelection | null | undefined) =>
      resolveDefaultProviderModelSelection(providers, selection),
    [providers],
  );
  const supportsWorkflows = useCallback(
    (selection: ModelSelection | null) =>
      instanceEntries.find((entry) => entry.instanceId === selection?.instanceId)?.driverKind ===
      "claude",
    [instanceEntries],
  );
  return {
    providers,
    instanceEntries,
    modelOptionsByInstance,
    resolveSelection,
    supportsWorkflows,
  };
}
