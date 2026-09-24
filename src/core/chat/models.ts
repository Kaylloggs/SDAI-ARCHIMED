import type { EffortOption, ModelInfo } from "@/core/engine/types";

/** Modèle retrouvé à partir de l'identifiant enregistré, et son niveau d'effort. */
export type ModelChoice = { model: ModelInfo; effort: EffortOption | null };

function exact(models: ModelInfo[], id: string): ModelChoice | null {
  for (const model of models) {
    const effort = model.efforts.find((e) => e.id === id);
    if (effort) return { model, effort };
  }
  const model = models.find((m) => m.id === id);
  return model ? { model, effort: null } : null;
}

/**
 * Identifiant enregistré avant les noms réels (`sonnet:medium`, `opus:high`) : on retrouve le
 * modèle dont l'identifiant contient ce nom, au même niveau d'effort. La CLI reçoit toujours
 * l'identifiant enregistré ; seul l'affichage est rapproché.
 */
function legacy(models: ModelInfo[], id: string): ModelChoice | null {
  const [base, level] = id.toLowerCase().split(":");
  if (!base) return null;
  const model = models.find((m) => m.id.toLowerCase().includes(base) || m.label.toLowerCase().includes(base));
  if (!model) return null;
  const effort = model.efforts.find((e) => e.level === (level ?? "auto")) ?? null;
  return { model, effort };
}

/**
 * Modèle et effort affichés pour l'identifiant `id` (celui de la session), sinon pour le modèle
 * par défaut de l'agent. `null` : aucun modèle choisi, la CLI prend le sien.
 */
export function resolveModel(models: ModelInfo[], id: string | null, fallback: string | null): ModelChoice | null {
  if (id) {
    const found = exact(models, id) ?? legacy(models, id);
    if (found) return found;
  }
  return fallback ? exact(models, fallback) : null;
}

/** Identifiant à envoyer quand on passe à `model` : même niveau d'effort s'il existe, sinon le sien par défaut. */
export function switchModel(model: ModelInfo, current: EffortOption | null): string {
  const same = current && model.efforts.find((e) => e.level === current.level);
  return same ? same.id : model.id;
}

/** Nom lisible d'un identifiant de modèle (« Opus 5.5 · Élevé ») ; l'identifiant brut s'il est inconnu. */
export function modelLabel(models: ModelInfo[], id: string): string {
  const choice = resolveModel(models, id, null);
  if (!choice) return id;
  const { model, effort } = choice;
  return effort && effort.level !== "auto" && model.efforts.length > 1 ? `${model.label} · ${effort.label}` : model.label;
}
