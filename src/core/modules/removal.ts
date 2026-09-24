import { bus } from "@/core/bus/event-bus";
import { invokeCore } from "@/core/ipc";
import type { ModuleFootprint } from "@/core/ipc/bindings/ModuleFootprint";
import type { ModuleRemoval } from "@/core/ipc/bindings/ModuleRemoval";
import { useModulesStore } from "@/core/stores/modules.store";

/**
 * Suppression d'un module par la personne. Son code reste dans l'exécutable, mais il
 * disparaît de l'interface et ses traces sur la machine sont effacées (`core/modules.rs`) :
 * dossier de données à la Corbeille, outils des agents, clés déclarées, réglages du navigateur.
 */

/** Réglages rangés par un module dans le navigateur : `archimed.<id>.…` ou `<id>.…`. */
export function moduleStorageKeys(id: string, keys: readonly string[]): string[] {
  return keys.filter((key) => key.startsWith(`archimed.${id}.`) || key.startsWith(`${id}.`));
}

export function moduleFootprint(id: string): Promise<ModuleFootprint> {
  return invokeCore<ModuleFootprint>("modules_footprint", { id });
}

export async function removeModule(id: string): Promise<ModuleRemoval> {
  const removal = await invokeCore<ModuleRemoval>("modules_remove", { id });
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? "");
    for (const key of moduleStorageKeys(id, keys)) localStorage.removeItem(key);
  } catch {
    // Stockage indisponible : rien à effacer.
  }
  useModulesStore.getState().markRemoved(id);
  bus.emit("modules.changed", { id, enabled: false });
  return removal;
}

export function restoreModule(id: string): void {
  useModulesStore.getState().markRestored(id);
  bus.emit("modules.changed", { id, enabled: true });
}
