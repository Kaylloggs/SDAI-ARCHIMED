import type { GameSystem } from "@/core/ipc/bindings/GameSystem";

/**
 * Sélection des systèmes dans l'assistant de création : on ne retire pas un système dont un
 * autre système gardé a besoin, et ajouter un système ajoute aussi ce dont il dépend.
 */

/** Systèmes gardés qui dépendent directement de `id`. */
export function neededBy(id: string, kept: Set<string>, systems: Map<string, GameSystem>): GameSystem[] {
  const out: GameSystem[] = [];
  for (const keptId of kept) {
    const system = systems.get(keptId);
    if (system && system.id !== id && system.dependencies.includes(id)) out.push(system);
  }
  return out;
}

/** `id` et toutes ses dépendances (directes et indirectes) connues. */
export function withDependencies(id: string, systems: Map<string, GameSystem>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    const system = systems.get(current);
    if (!system) return;
    system.dependencies.forEach(visit);
    out.push(current);
  };
  visit(id);
  return out;
}

/** Garde les dépendances qui pointent vers un système gardé (les autres sont retirées). */
export function prune(systems: GameSystem[], kept: Set<string>): GameSystem[] {
  return systems
    .filter((s) => kept.has(s.id))
    .map((s) => ({ ...s, dependencies: s.dependencies.filter((d) => kept.has(d)) }));
}
