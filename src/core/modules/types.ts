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
  /** chat.composer.actions : agent choisi dans le composer. */
  adapter?: string;
  /** chat.composer.actions : insère du texte en tête du message en cours de saisie. */
  insertText?: (text: string) => void;
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

/** Zone de l'écran mise en lumière par une étape de tutoriel (miniature du module Tutoriel). */
export const TUTORIAL_AREAS = ["rail", "top", "left", "center", "right", "bottom"] as const;
export type TutorialArea = (typeof TUTORIAL_AREAS)[number];

export type TutorialStep = {
  /** Pictogramme de l'étape (lucide), posé sur la zone mise en lumière. */
  icon: LucideIcon;
  /** Titre court qui commence par un verbe : « Choisir un agent ». */
  title: string;
  /** Une ou deux phrases, sans jargon. */
  text: string;
  /** Où se passe l'étape dans l'écran du module (défaut : centre). */
  area?: TutorialArea;
  /** Raccourci montré en touches : ["Ctrl", "K"]. */
  keys?: string[];
  /** Commande ou extrait de code, montré à la place de la miniature (tutoriels techniques). */
  code?: string;
};

/**
 * Tutoriel d'utilisation d'un module, affiché par le module Tutoriel s'il est présent.
 * Obligatoire pour tout module non requis (vérifié par `pnpm check`).
 */
export type ModuleTutorial = {
  /** À quoi sert le module, en une phrase. */
  summary: string;
  /** Trois à sept étapes, dans l'ordre où on les fait. */
  steps: TutorialStep[];
  /** Astuces montrées à la fin. */
  tips?: string[];
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
  /** Tutoriel d'utilisation (données seulement, voir `ModuleTutorial`). */
  tutorial?: ModuleTutorial;
};

export type LoadedModule = ModuleManifest & {
  /** Chemin de route : /m/<id> */
  path: string;
};
