import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ModuleParams = Record<string, unknown>;

type UiState = {
  activeModuleId: string;
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  rawTerminalOpen: boolean;
  /** Paramètres passés d'un module à l'autre (ex : chat → code avec le dossier). */
  moduleParams: Record<string, ModuleParams>;
  navigate: (moduleId: string) => void;
  /** Ouvre un module en lui transmettant un contexte. Le module consomme puis efface. */
  openModule: (moduleId: string, params: ModuleParams) => void;
  clearModuleParams: (moduleId: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  toggleRawTerminal: () => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      activeModuleId: "home",
      sidebarCollapsed: false,
      paletteOpen: false,
      rawTerminalOpen: false,
      moduleParams: {},
      navigate: (moduleId) => set({ activeModuleId: moduleId, paletteOpen: false }),
      openModule: (moduleId, params) =>
        set((state) => ({
          activeModuleId: moduleId,
          paletteOpen: false,
          moduleParams: { ...state.moduleParams, [moduleId]: params },
        })),
      clearModuleParams: (moduleId) =>
        set((state) => {
          const { [moduleId]: _removed, ...rest } = state.moduleParams;
          return { moduleParams: rest };
        }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      toggleRawTerminal: () => set((s) => ({ rawTerminalOpen: !s.rawTerminalOpen })),
    }),
    {
      name: "archimed.ui",
      partialize: (s) => ({
        activeModuleId: s.activeModuleId,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    },
  ),
);
