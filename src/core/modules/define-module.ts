import type { ModuleManifest, ModuleTutorial } from "./types";

/**
 * Déclare un module. Seul point d'entrée autorisé d'un `module.config.ts`.
 * Sert uniquement au typage : la validation runtime se fait dans le registre.
 */
export function defineModule(manifest: ModuleManifest): ModuleManifest {
  return manifest;
}

/** Déclare le tutoriel d'un module (fichier `tutorial.ts`, importé par `module.config.ts`). */
export function defineTutorial(tutorial: ModuleTutorial): ModuleTutorial {
  return tutorial;
}
