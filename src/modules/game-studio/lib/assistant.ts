import type { AutoMode } from "@/core/engine/types";
import type { GameAutonomy } from "@/core/ipc/bindings/GameAutonomy";
import type { GameBuildRecord } from "@/core/ipc/bindings/GameBuildRecord";
import { ACTION } from "./labels";

/** Conversations des agents de Game Studio (distinctes de celles du Chat). */
export const ORIGIN = "game-studio";

/** Corrections d'affilée après un échec avant de rendre la main à la personne. */
export const MAX_FIX_ROUNDS = 3;

/**
 * Liberté des agents → mode de validation des actions de la CLI : manuel, tout est demandé ;
 * assisté, le Mode Auto tranche les gestes sûrs ; autonome, les tâches s'enchaînent (un point
 * de restauration est pris avant).
 */
export function autoModeFor(autonomy: GameAutonomy): AutoMode {
  return autonomy === "manual" ? "off" : autonomy === "assisted" ? "smart" : "full";
}

/** Message préparé pour l'agent de débogage à partir d'une exécution en échec. */
export function fixRequest(record: GameBuildRecord): string {
  const lines = [
    `${ACTION[record.action].label} en échec (code de sortie ${record.exitCode ?? "aucun"}). ${record.summary}`,
    "",
    "Erreurs relevées par Game Studio :",
  ];
  const errors = record.diagnostics.filter((d) => d.severity === "error").slice(0, 12);
  if (errors.length === 0) lines.push(`- (aucune erreur localisée : lis le journal complet avec engine_action_log, exécution ${record.id})`);
  for (const d of errors) {
    const where = d.file ? `${d.file}${d.line !== null ? `:${d.line}` : ""} — ` : "";
    const hint = d.suggestion ? ` (piste : ${d.suggestion})` : "";
    lines.push(`- ${where}${d.message}${hint}`);
  }
  const more = record.diagnostics.filter((d) => d.severity === "error").length - errors.length;
  if (more > 0) lines.push(`- … et ${more} autre(s).`);
  lines.push(
    "",
    `Trouve la cause racine, corrige le minimum, puis relance la même action (${record.action === "check" ? "check_game_code" : record.action === "test" ? "run_tests" : ACTION[record.action].verb}) pour prouver que c'est réparé.`,
  );
  return lines.join("\n");
}

/** Libellé d'un point de restauration pris avant l'intervention d'un agent. */
export function checkpointLabel(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return `Avant l'agent : ${clean.length > 60 ? `${clean.slice(0, 60)}…` : clean}`;
}
