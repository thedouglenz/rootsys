import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { useDagProviders } from "./useDagProviders";

/**
 * Model picker bound to one environment's providers. `value` null renders the
 * environment's default so the user sees what would run; picking stores an
 * explicit selection.
 */
export function DagModelPicker({
  environmentId,
  value,
  fallback,
  disabled,
  onChange,
}: {
  environmentId: EnvironmentId;
  value: ModelSelection | null;
  /** Shown when `value` is null (for example the project default). */
  fallback?: ModelSelection | null;
  disabled?: boolean;
  onChange: (selection: ModelSelection) => void;
}) {
  const providers = useDagProviders(environmentId);
  const resolved = providers.resolveSelection(value ?? fallback ?? null);
  if (resolved === null) {
    return <span className="text-xs text-muted-foreground">No providers available</span>;
  }
  return (
    <ProviderModelPicker
      activeInstanceId={resolved.instanceId}
      model={resolved.model}
      lockedProvider={null}
      instanceEntries={providers.instanceEntries}
      modelOptionsByInstance={providers.modelOptionsByInstance}
      triggerVariant="outline"
      triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
      disabled={disabled ?? false}
      onInstanceModelChange={(instanceId, model) =>
        onChange(createModelSelection(instanceId, model))
      }
    />
  );
}
