import { create } from "zustand";
import { persist } from "zustand/middleware";
import cavemanSkill from "./prompts/caveman.md?raw";

/**
 * Économie de tokens : le skill « caveman » est fourni avec ARCHIMED et, s'il est activé dans
 * les Réglages, s'applique à tous les prompts (Chat et Code, toutes les CLI).
 *
 * Coût maîtrisé : les règles complètes ne sont envoyées qu'une fois par conversation (ou quand
 * le niveau change) ; les messages suivants portent un simple rappel d'une ligne.
 */
export type CavemanLevel = "lite" | "full" | "ultra";

export const CAVEMAN_LEVELS: Array<{ id: CavemanLevel; label: string; description: string }> = [
  { id: "lite", label: "Léger", description: "Phrases complètes, sans remplissage ni précautions." },
  { id: "full", label: "Standard", description: "Style télégraphique, fragments acceptés (~ -65 % de sortie)." },
  { id: "ultra", label: "Maximal", description: "Abréviations et flèches, le plus court possible." },
];

type TokenSaverState = {
  enabled: boolean;
  level: CavemanLevel;
  /** Conversations ayant déjà reçu les règles complètes, clé `conversationId:niveau`. */
  primed: string[];
  setEnabled: (enabled: boolean) => void;
  setLevel: (level: CavemanLevel) => void;
  markPrimed: (conversationId: string) => void;
};

export const useTokenSaverStore = create<TokenSaverState>()(
  persist(
    (set, get) => ({
      enabled: false,
      level: "full",
      primed: [],
      setEnabled: (enabled) => set({ enabled }),
      setLevel: (level) => set({ level }),
      markPrimed: (conversationId) => {
        const key = `${conversationId}:${get().level}`;
        if (!get().primed.includes(key)) set({ primed: [...get().primed, key].slice(-500) });
      },
    }),
    { name: "archimed.token-saver" },
  ),
);

/** Corps du skill sans son en-tête YAML (inutile pour le modèle). */
export function cavemanRules(): string {
  return cavemanSkill.replace(/^---[\s\S]*?---\s*/, "").trim();
}

/**
 * Ajoute la consigne caveman au prompt. `primed` : la conversation a déjà reçu les règles
 * complètes pour ce niveau (un rappel suffit).
 */
export function applyTokenSaver(prompt: string, level: CavemanLevel, primed: boolean, rules = cavemanRules()): string {
  if (primed) {
    return `[Mode caveman ${level} actif : réponses compressées, code, commandes et termes techniques exacts.]\n\n${prompt}`;
  }
  return [
    `[Économie de tokens ARCHIMED — skill caveman, niveau ${level}. Applique ces règles à toutes tes réponses de cette conversation, sans les commenter.]`,
    rules,
    "[Fin des règles]",
    "",
    prompt,
  ].join("\n");
}
