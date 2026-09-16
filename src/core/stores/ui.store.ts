import { create } from "zustand";
import { persist } from "zustand/middleware";

type UiState = {
  activeModuleId: string;
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  rawTerminalOpen: boolean;
  navigate: (moduleId: string) => void;
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
      navigate: (moduleId) => set({ activeModuleId: moduleId, paletteOpen: false }),
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
