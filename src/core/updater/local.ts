import { create } from "zustand";
import { isAppError } from "@/core/ipc";
import { flushConversations } from "@/core/engine/conversation-storage";
import { updaterApi, type LocalModule, type LocalStatus } from "./api";

/**
 * Mise à jour locale : modules créés ou modifiés dans le code source suivi, à intégrer en
 * recompilant ARCHIMED (core/updater/local.rs, ADR 0013).
 */

const DISMISS_KEY = "archimed.updater.localDismissed";

type State = {
  status: LocalStatus | null;
  error: string | null;
  rebuilding: boolean;
  /** Empreinte des modules prêts écartée par « Plus tard » (revient s'ils changent). */
  dismissed: string | null;
  refresh: () => Promise<void>;
  setSourceDir: (dir: string | null) => Promise<void>;
  rebuild: () => Promise<void>;
  dismiss: () => void;
};

const message = (error: unknown) => (isAppError(error) ? error.message : String(error));

function storedDismiss(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/** Modules prêts, sous une forme qui change dès que l'un d'eux bouge. */
export function readySignature(modules: LocalModule[]): string {
  return modules
    .filter((m) => m.ready)
    .map((m) => `${m.id}@${m.modifiedAt}`)
    .sort()
    .join("|");
}

export const useLocalUpdateStore = create<State>()((set, get) => ({
  status: null,
  error: null,
  rebuilding: false,
  dismissed: storedDismiss(),

  refresh: async () => {
    try {
      set({ status: await updaterApi.localStatus(), error: null });
    } catch (error) {
      set({ error: message(error) });
    }
  },

  setSourceDir: async (dir) => {
    try {
      set({ status: await updaterApi.setSourceDir(dir), error: null });
    } catch (error) {
      set({ error: message(error) });
      throw error;
    }
  },

  rebuild: async () => {
    if (get().rebuilding) return;
    set({ error: null });
    try {
      await flushConversations();
      await updaterApi.localRebuild();
      set({ rebuilding: true });
    } catch (error) {
      set({ error: message(error) });
    }
  },

  dismiss: () => {
    const signature = readySignature(get().status?.modules ?? []);
    try {
      localStorage.setItem(DISMISS_KEY, signature);
    } catch {
      // Stockage indisponible : écarté pour cette fenêtre seulement.
    }
    set({ dismissed: signature });
  },
}));

/** Vérifie toutes les 20 s et quand la fenêtre reprend le focus (retour de l'éditeur). */
const EVERY = 20_000;
let scheduled = false;

export function scheduleLocalChecks() {
  if (scheduled) return;
  scheduled = true;
  const refresh = () => void useLocalUpdateStore.getState().refresh();
  setTimeout(refresh, 3_000);
  setInterval(refresh, EVERY);
  window.addEventListener("focus", refresh);
}
