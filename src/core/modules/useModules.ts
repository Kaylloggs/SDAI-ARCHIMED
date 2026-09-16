import { useMemo } from "react";
import { allModules } from "./registry";
import { isModuleEnabled, useModulesStore } from "@/core/stores/modules.store";
import type { LoadedModule } from "./types";

/** Modules actifs (manifest valide + activé). */
export function useEnabledModules(): LoadedModule[] {
  const overrides = useModulesStore((s) => s.overrides);
  return useMemo(
    () => allModules.filter((module) => isModuleEnabled(overrides, module)),
    [overrides],
  );
}

export function useModule(id: string | undefined): LoadedModule | undefined {
  const modules = useEnabledModules();
  return modules.find((m) => m.id === id);
}
