import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * N'importe PAS le registre : les manifests importent `@/core/modules`, donc toute
 * dépendance du store vers le registre créerait un cycle d'initialisation.
 * On ne stocke que les décisions explicites de l'utilisateur ; le défaut vient du manifest.
 */
type ModulesState = {
  overrides: Record<string, boolean>;
  /** Modules supprimés par la personne : absents partout, sauf de « Modules supprimés ». */
  removed: string[];
  setOverride: (id: string, enabled: boolean) => void;
  reset: (id: string) => void;
  markRemoved: (id: string) => void;
  markRestored: (id: string) => void;
};

export const useModulesStore = create<ModulesState>()(
  persist(
    (set) => ({
      overrides: {},
      removed: [],
      setOverride: (id, enabled) =>
        set((state) => ({ overrides: { ...state.overrides, [id]: enabled } })),
      reset: (id) =>
        set((state) => {
          const { [id]: _removed, ...rest } = state.overrides;
          return { overrides: rest };
        }),
      // Supprimé = désactivé : tout ce qui lit `overrides` le cache déjà.
      markRemoved: (id) =>
        set((state) => ({
          overrides: { ...state.overrides, [id]: false },
          removed: state.removed.includes(id) ? state.removed : [...state.removed, id],
        })),
      markRestored: (id) =>
        set((state) => ({
          overrides: { ...state.overrides, [id]: true },
          removed: state.removed.filter((r) => r !== id),
        })),
    }),
    { name: "archimed.modules" },
  ),
);

/** Un module est actif s'il est requis, forcé par l'utilisateur, ou actif par défaut. */
export function isModuleEnabled(
  overrides: Record<string, boolean>,
  module: { id: string; required?: boolean; enabledByDefault: boolean },
): boolean {
  if (module.required) return true;
  return overrides[module.id] ?? module.enabledByDefault;
}
