import type { AdapterInfo } from "@/core/engine/types";

/** Complexité d'une tâche, estimée par l'agent vocal qui la confie. */
export type Complexity = "simple" | "standard" | "complex";

export const COMPLEXITIES: Complexity[] = ["simple", "standard", "complex"];

type Tier = "light" | "balanced" | "strong";

const TIER_OF: Record<Complexity, Tier> = { simple: "light", standard: "balanced", complex: "strong" };

/** Mots qui situent un modèle, du plus parlant au moins parlant (rang dans sa gamme). */
const LIGHT: Array<[RegExp, number]> = [
  [/\bflash\b/i, 4],
  [/\bhaiku\b/i, 3],
  [/\bmini\b/i, 2],
  [/\b(lite|nano|small)\b/i, 1],
];
const STRONG: Array<[RegExp, number]> = [
  [/\bopus\b/i, 4],
  [/\bfable\b/i, 3],
  [/\b(ultra|max)\b/i, 2],
  [/\bpro\b/i, 1],
];

function rank(text: string, words: Array<[RegExp, number]>): number {
  return words.find(([pattern]) => pattern.test(text))?.[1] ?? 0;
}

/** Gamme d'un modèle d'après son nom : léger (Flash, Haiku, Mini), puissant (Opus, Pro), sinon équilibré. */
export function tierOf(model: { id: string; label: string }): Tier {
  const text = `${model.label} ${model.id.replace(/[-_]/g, " ")}`;
  if (rank(text, LIGHT) > 0) return "light";
  if (rank(text, STRONG) > 0) return "strong";
  return "balanced";
}

/** Numéro de version d'un nom (« Opus 5.5 » → 5.5), 0 sans numéro. */
function version(label: string): number {
  const match = /(\d+(?:\.\d+)?)/.exec(label);
  return match ? Number(match[1]) : 0;
}

export type Route = { adapter: string; adapterName: string; model: string; label: string };

/**
 * Agent et modèle pour une tâche : un modèle léger pour une tâche simple, le plus puissant pour
 * une tâche complexe, un modèle équilibré sinon, parmi les agents installés. `only` limite à un
 * agent (demandé par la personne) ; à rang égal, l'agent préféré passe devant. Aucun modèle de
 * la gamme : la gamme voisine, puis le modèle par défaut de l'agent préféré.
 */
export function routeModel(adapters: AdapterInfo[], complexity: Complexity, preferred: string, only?: string): Route | null {
  const usable = adapters.filter((a) => a.installed && (!only || a.id === only));
  const all = usable.flatMap((adapter) => adapter.models.map((model) => ({ adapter, model, tier: tierOf(model) })));
  const wanted = TIER_OF[complexity];
  const order: Tier[] = wanted === "balanced" ? ["balanced", "strong", "light"] : wanted === "light" ? ["light", "balanced"] : ["strong", "balanced"];
  for (const tier of order) {
    const candidates = all.filter((c) => c.tier === tier);
    if (candidates.length === 0) continue;
    const words = tier === "light" ? LIGHT : tier === "strong" ? STRONG : [];
    candidates.sort(
      (a, b) =>
        rank(b.model.label, words) - rank(a.model.label, words) ||
        version(b.model.label) - version(a.model.label) ||
        Number(b.adapter.id === preferred) - Number(a.adapter.id === preferred),
    );
    // Équilibré : l'agent préféré d'abord (le choix de la personne pour le travail courant).
    const best = tier === "balanced" ? (candidates.find((c) => c.adapter.id === preferred) ?? candidates[0]!) : candidates[0]!;
    return { adapter: best.adapter.id, adapterName: best.adapter.name, model: best.model.id, label: best.model.label };
  }
  const fallback = usable.find((a) => a.id === preferred) ?? usable[0];
  if (!fallback) return null;
  const model = fallback.models.find((m) => m.id === fallback.defaultModel) ?? fallback.models[0];
  return model
    ? { adapter: fallback.id, adapterName: fallback.name, model: model.id, label: model.label }
    : { adapter: fallback.id, adapterName: fallback.name, model: fallback.defaultModel ?? "", label: fallback.name };
}
