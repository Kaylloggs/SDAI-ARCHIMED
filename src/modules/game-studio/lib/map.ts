import type { GameFoundSystem } from "@/core/ipc/bindings/GameFoundSystem";
import type { GameGraphOp } from "@/core/ipc/bindings/GameGraphOp";
import type { GameProjectMap } from "@/core/ipc/bindings/GameProjectMap";

/**
 * Système repéré dans le code, ajouté au graphe : avec ses dépendances du catalogue, ses
 * fichiers rattachés, et « en cours » (le code existe, rien ne dit qu'il est fini).
 */
export function adoptOps(found: GameFoundSystem): GameGraphOp[] {
  const ops: GameGraphOp[] = [];
  if (!found.inGraph) ops.push({ op: "addCatalogSystem", id: found.id });
  if (found.files.length) ops.push({ op: "linkFiles", id: found.id, files: found.files });
  if (!found.inGraph) ops.push({ op: "setSystemStatus", id: found.id, status: "inProgress" });
  return ops;
}

/** Part de chaque langage dans les lignes de code (pour les barres de la carte). */
export function languageShares(map: GameProjectMap): { language: string; files: number; lines: number; share: number }[] {
  const total = map.languages.reduce((sum, l) => sum + l.lines, 0) || 1;
  return map.languages.map((l) => ({ ...l, share: l.lines / total }));
}
