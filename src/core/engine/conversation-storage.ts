import type { StateStorage } from "zustand/middleware";
import { invokeCore } from "@/core/ipc";

/**
 * Stockage des conversations sur disque (`%APPDATA%\com.sdai.archimed\sessions\conversations.json`)
 * au lieu du localStorage du WebView, limité à quelques Mo.
 *
 * - Lecture : disque d'abord ; s'il est vide, reprise de l'ancien localStorage (migration).
 * - Écriture : regroupée (500 ms) pour ne pas réécrire le fichier à chaque delta de streaming.
 * - Hors Tauri (tests, preview navigateur) : repli transparent sur localStorage.
 */
const SAVE_DELAY = 500;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Dernier état en attente d'écriture, par nom de stockage. */
const pending = new Map<string, string>();

function save(name: string, value: string): Promise<void> {
  pending.delete(name);
  return invokeCore<void>("engine_save_conversations", { state: value })
    .then(() => local()?.removeItem(name)) // migration terminée : libère le localStorage
    .catch(() => local()?.setItem(name, value));
}

/** Écrit tout de suite ce qui attend encore (avant une fermeture ou une mise à jour). */
export async function flushConversations(): Promise<void> {
  const waiting = [...pending.entries()];
  for (const [name] of waiting) clearTimeout(timers.get(name));
  await Promise.all(waiting.map(([name, value]) => save(name, value)));
}

function local(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const conversationStorage: StateStorage = {
  getItem: async (name) => {
    try {
      const fromDisk = await invokeCore<string | null>("engine_load_conversations");
      if (fromDisk) return fromDisk;
    } catch {
      // backend indisponible : repli localStorage
    }
    return local()?.getItem(name) ?? null;
  },

  setItem: (name, value) => {
    clearTimeout(timers.get(name));
    pending.set(name, value);
    timers.set(
      name,
      setTimeout(() => void save(name, value), SAVE_DELAY),
    );
  },

  removeItem: (name) => {
    clearTimeout(timers.get(name));
    pending.delete(name);
    local()?.removeItem(name);
    void invokeCore<void>("engine_save_conversations", {
      state: JSON.stringify({ state: { sessions: [], activeId: null }, version: 1 }),
    }).catch(() => undefined);
  },
};
