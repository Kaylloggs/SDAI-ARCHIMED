import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyTheme, DEFAULT_THEME, type ThemeId } from "@/design-system/themes";

type ThemeState = {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
    }),
    {
      name: "archimed.theme",
      onRehydrateStorage: () => (state) => {
        applyTheme(state?.theme ?? DEFAULT_THEME);
      },
    },
  ),
);
