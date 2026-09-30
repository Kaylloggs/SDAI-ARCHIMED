import type { GameSystem } from "@/core/ipc/bindings/GameSystem";

/** Systèmes qui dépendent directement de `id` (« utilisé par »). */
export function consumers(systems: GameSystem[], id: string): GameSystem[] {
  return systems.filter((s) => s.dependencies.includes(id));
}

/** Systèmes touchés si `id` change (dépendants directs et indirects) : à retester (§84). */
export function impact(systems: GameSystem[], id: string): GameSystem[] {
  const out = new Map<string, GameSystem>();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    for (const consumer of consumers(systems, current)) {
      if (!out.has(consumer.id)) {
        out.set(consumer.id, consumer);
        stack.push(consumer.id);
      }
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Identifiant `snake_case` à partir d'un nom : « Pêche au harpon » → `peche_au_harpon`. */
export function systemId(name: string): string {
  const id = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return /^[a-z]/.test(id) ? id : `system_${id}`.replace(/_+$/, "");
}
