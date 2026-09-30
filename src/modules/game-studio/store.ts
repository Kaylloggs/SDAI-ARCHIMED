import { create } from "zustand";
import type { GameEnvironment } from "@/core/ipc/bindings/GameEnvironment";
import type { GameGraphOp } from "@/core/ipc/bindings/GameGraphOp";
import type { GameProjectPatch } from "@/core/ipc/bindings/GameProjectPatch";
import type { GameProjectState } from "@/core/ipc/bindings/GameProjectState";
import type { GameProjectSummary } from "@/core/ipc/bindings/GameProjectSummary";
import { errorText, gameStudioApi } from "./api";

export type SectionId =
  | "dashboard"
  | "design"
  | "systems"
  | "tasks"
  | "history"
  | "journal"
  | "tools"
  | "settings";

type GameStudioState = {
  projects: GameProjectSummary[];
  loaded: boolean;
  error: string | null;
  openId: string | null;
  /** Projet ouvert, relu après chaque modification. */
  current: GameProjectState | null;
  loadingCurrent: boolean;
  section: SectionId;
  /** Système sélectionné dans la vue Systèmes. */
  selectedSystem: string | null;
  environment: GameEnvironment | null;
  environmentLoading: boolean;

  refresh: () => Promise<void>;
  open: (id: string | null) => Promise<void>;
  reload: () => Promise<void>;
  go: (section: SectionId) => void;
  selectSystem: (id: string | null) => void;
  /** Modifie le graphe du projet ouvert ; rend la phrase d'erreur, ou `null`. */
  apply: (op: GameGraphOp) => Promise<string | null>;
  patch: (patch: GameProjectPatch) => Promise<string | null>;
  loadEnvironment: (refresh?: boolean) => Promise<void>;
  setEnvironment: (env: GameEnvironment) => void;
  clearError: () => void;
};

export const useGameStudioStore = create<GameStudioState>()((set, get) => ({
  projects: [],
  loaded: false,
  error: null,
  openId: null,
  current: null,
  loadingCurrent: false,
  section: "dashboard",
  selectedSystem: null,
  environment: null,
  environmentLoading: false,

  refresh: async () => {
    try {
      const projects = await gameStudioApi.list();
      set({ projects, loaded: true });
    } catch (error) {
      set({ error: errorText(error), loaded: true });
    }
  },

  open: async (id) => {
    set({ openId: id, current: null, selectedSystem: null, section: "dashboard" });
    if (id) await get().reload();
  },

  reload: async () => {
    const id = get().openId;
    if (!id) return;
    set({ loadingCurrent: true });
    try {
      const current = await gameStudioApi.state(id);
      if (get().openId === id) set({ current, loadingCurrent: false, error: null });
    } catch (error) {
      set({ error: errorText(error), loadingCurrent: false });
    }
  },

  go: (section) => set({ section }),
  selectSystem: (selectedSystem) => set({ selectedSystem }),

  apply: async (op) => {
    const { openId, current } = get();
    if (!openId || !current) return "Aucun projet ouvert.";
    try {
      const graph = await gameStudioApi.graphOp(openId, op);
      set({ current: { ...current, graph } });
      void get().refresh();
      return null;
    } catch (error) {
      return errorText(error);
    }
  },

  patch: async (patch) => {
    const { openId } = get();
    if (!openId) return "Aucun projet ouvert.";
    try {
      await gameStudioApi.update(openId, patch);
      await Promise.all([get().reload(), get().refresh()]);
      return null;
    } catch (error) {
      return errorText(error);
    }
  },

  loadEnvironment: async (refresh = false) => {
    set({ environmentLoading: true });
    try {
      const environment = await gameStudioApi.environment(refresh);
      set({ environment, environmentLoading: false });
    } catch (error) {
      set({ error: errorText(error), environmentLoading: false });
    }
  },

  setEnvironment: (environment) => set({ environment }),
  clearError: () => set({ error: null }),
}));
