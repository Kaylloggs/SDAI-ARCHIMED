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
    timers.set(
      name,
      setTimeout(() => {
        invokeCore<void>("engine_save_conversations", { state: value })
          .then(() => local()?.removeItem(name)) // migration terminée : libère le localStorage
          .catch(() => local()?.setItem(name, value));
      }, SAVE_DELAY),
    );
  },

  removeItem: (name) => {
    clearTimeout(timers.get(name));
    local()?.removeItem(name);
    void invokeCore<void>("engine_save_conversations", {
      state: JSON.stringify({ state: { sessions: [], activeId: null }, version: 1 }),
    }).catch(() => undefined);
  },
};
