import type { ComponentType, LazyExoticComponent } from "react";
import type { LucideIcon } from "lucide-react";

/** Catégories de la sidebar, dans l'ordre d'affichage. */
export const MODULE_CATEGORIES = [
  "core",
  "ai",
  "productivity",
  "system",
  "creative",
  "automation",
  "settings",
] as const;
export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ModuleCategory, string> = {
  core: "Essentiel",
  ai: "Intelligence",
  productivity: "Organisation",
  system: "Système",
  creative: "Création",
  automation: "Automatisation",
  settings: "Réglages",
};

export type LazyPage = LazyExoticComponent<ComponentType<unknown>>;
/**
 * Contexte qu'un écran hôte transmet aux contributions d'un slot.
 * Tous les champs sont optionnels : chaque slot n'en fournit qu'une partie
 * (contrat par slot documenté dans slots.tsx). Ajouter un champ = l'y documenter.
 */
export type SlotContext = {
  /** chat.message.actions : texte du message de l'assistant. */
  text?: string;
  /** chat.message.actions : dossier de travail de la conversation. */
  cwd?: string | null;
  /** code.editor.footer : racine du projet ouvert. */
  root?: string;
};

export type LazySlot = LazyExoticComponent<ComponentType<SlotContext>>;

export type LaunchpadConfig = {
  /** Largeur de la tuile dans la grille 12 colonnes. */
  size: "sm" | "md" | "lg";
  /** Met la tuile en avant avec l'accent (une seule par écran). */
  accent?: boolean;
};

export type ModuleCommand = {
  id: string;
  title: string;
  shortcut?: string;
  /** "navigate" ouvre la page du module ; sinon callback. */
  run: "navigate" | (() => void | Promise<void>);
};

export type ModuleManifest = {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: LucideIcon;
  category: ModuleCategory;
  order: number;
  enabledByDefault: boolean;
  /** Module non désactivable (shell de base). */
  required?: boolean;
  page: LazyPage;
  launchpad?: LaunchpadConfig | false;
  backend?: { plugin: string };
  provides?: Record<string, () => Promise<unknown>>;
  consumes?: string[];
  slots?: Record<string, LazySlot>;
  cards?: Record<string, LazyPage>;
  commands?: ModuleCommand[];
  settings?: LazyPage;
};

export type LoadedModule = ModuleManifest & {
  /** Chemin de route : /m/<id> */
  path: string;
};
