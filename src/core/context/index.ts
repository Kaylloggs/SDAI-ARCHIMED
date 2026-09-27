import { useEffect } from "react";
import { create } from "zustand";
import { useUiStore } from "@/core/stores/ui.store";

/**
 * Contexte que chaque module expose sur ce que la personne a sous les yeux : projet ouvert,
 * fichier, image ou objet sélectionné, tâche en cours. La couche vocale (et tout agent via
 * MCP) s'en sert pour comprendre « ajoute-lui une armure » ou « change le ciel ».
 *
 * Rien n'est capturé à l'écran : seuls les champs que le module choisit de publier.
 */
export type ModuleContext = {
  project?: { name: string; path?: string | null };
  file?: string | null;
  /** Texte ou élément sélectionné, en clair. */
  selection?: string | null;
  image?: { path?: string | null; description?: string | null } | null;
  /** Objet sélectionné : bloc, entité, carte, offre… */
  object?: { type: string; name: string; id?: string } | null;
  task?: string | null;
  /** Détails propres au module (courts, lisibles par un agent). */
  details?: Record<string, string | number | boolean | null>;
};

export type AppContextSnapshot = {
  activeModule: string;
  modules: Record<string, ModuleContext>;
};

type ContextState = {
  contexts: Record<string, ModuleContext>;
  set: (moduleId: string, context: ModuleContext | null) => void;
};

export const useAppContextStore = create<ContextState>()((set) => ({
  contexts: {},
  set: (moduleId, context) =>
    set((state) => {
      const next = { ...state.contexts };
      if (context) next[moduleId] = context;
      else delete next[moduleId];
      return { contexts: next };
    }),
}));

export function setModuleContext(moduleId: string, context: ModuleContext | null): void {
  useAppContextStore.getState().set(moduleId, context);
}

/**
 * Publie le contexte d'un module tant que son écran est affiché (retiré au démontage).
 * `context` doit être mémoïsé par l'appelant (ou construit de valeurs simples).
 */
export function useModuleContext(moduleId: string, context: ModuleContext | null): void {
  const signature = JSON.stringify(context);
  useEffect(() => {
    setModuleContext(moduleId, signature === "null" ? null : (JSON.parse(signature) as ModuleContext));
  }, [moduleId, signature]);
  useEffect(() => () => setModuleContext(moduleId, null), [moduleId]);
}

/** Instantané : module affiché et contexte de chaque module. */
export function currentContext(): AppContextSnapshot {
  return {
    activeModule: useUiStore.getState().activeModuleId,
    modules: useAppContextStore.getState().contexts,
  };
}
