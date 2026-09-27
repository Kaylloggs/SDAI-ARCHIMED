import { create } from "zustand";
import { Channel, isAppError } from "@/core/ipc";
import { flushConversations } from "@/core/engine/conversation-storage";
import { updaterApi, type UpdateEvent, type UpdateStatus } from "./api";

export type UpdatePhase = "idle" | "downloading" | "verifying" | "installing" | "rebuilding" | "error";

type State = {
  status: UpdateStatus | null;
  checking: boolean;
  checkError: string | null;
  checkedAt: number | null;
  phase: UpdatePhase;
  received: number;
  total: number;
  installError: string | null;
  check: () => Promise<void>;
  /** `replaceSource` : remplacer une version compilée depuis le code source (modules perdus). */
  install: (replaceSource?: boolean) => Promise<void>;
  /** Version compilée depuis le code source : fusion et recompilation (garde ses modules). */
  rebuild: () => Promise<void>;
  cancel: () => void;
};

const message = (error: unknown) => (isAppError(error) ? error.message : String(error));

/** État des mises à jour, partagé par le bouton de la barre de titre et les Réglages. */
export const useUpdaterStore = create<State>()((set, get) => ({
  status: null,
  checking: false,
  checkError: null,
  checkedAt: null,
  phase: "idle",
  received: 0,
  total: 0,
  installError: null,

  check: async () => {
    if (get().checking || ["downloading", "verifying", "installing", "rebuilding"].includes(get().phase)) return;
    set({ checking: true });
    try {
      const status = await updaterApi.check();
      set({ status, checkError: null, checkedAt: Date.now() });
    } catch (error) {
      set({ checkError: message(error), checkedAt: Date.now() });
    } finally {
      set({ checking: false });
    }
  },

  install: async (replaceSource = false) => {
    const version = get().status?.available?.version;
    if (!version || get().phase === "downloading" || get().phase === "installing") return;
    set({ phase: "downloading", received: 0, total: get().status?.available?.size ?? 0, installError: null });
    const channel = new Channel<UpdateEvent>();
    channel.onmessage = (event) => {
      if (event.type === "downloading") set({ phase: "downloading", received: event.received, total: event.total });
      else if (event.type === "verifying") set({ phase: "verifying" });
      else {
        set({ phase: "installing" });
        // ARCHIMED va se fermer : les conversations sont écrites tout de suite.
        void flushConversations();
      }
    };
    try {
      await flushConversations();
      await updaterApi.install(version, replaceSource, channel);
      set({ phase: "installing" });
    } catch (error) {
      set({ phase: "error", installError: message(error) });
    }
  },

  rebuild: async () => {
    const version = get().status?.available?.version;
    if (!version || get().phase === "rebuilding") return;
    set({ installError: null });
    try {
      await flushConversations();
      await updaterApi.rebuild(version);
      set({ phase: "rebuilding" });
    } catch (error) {
      set({ phase: "error", installError: message(error) });
    }
  },

  cancel: () => {
    void updaterApi.cancel().catch(() => undefined);
  },
}));

/** Première vérification peu après le démarrage, puis toutes les six heures. */
const FIRST_CHECK = 8_000;
const EVERY = 6 * 60 * 60 * 1000;
let scheduled = false;

export function scheduleUpdateChecks() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => void useUpdaterStore.getState().check(), FIRST_CHECK);
  setInterval(() => void useUpdaterStore.getState().check(), EVERY);
}
