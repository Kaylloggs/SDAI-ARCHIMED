import type { ModuleManifest } from "./types";

/**
 * Déclare un module. Seul point d'entrée autorisé d'un `module.config.ts`.
 * Sert uniquement au typage : la validation runtime se fait dans le registre.
 */
export function defineModule(manifest: ModuleManifest): ModuleManifest {
  return manifest;
}
