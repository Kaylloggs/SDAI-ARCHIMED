/**
 * Ce qu'une opération demande à un modèle, et choix automatique d'un modèle compatible.
 * Les capacités viennent du fournisseur (liste des modèles) : rien n'est supposé ici, et
 * aucun modèle n'est classé « meilleur » qu'un autre.
 */
import type { ConnectionState } from "@/core/ipc/bindings/ConnectionState";
import type { ModelCapabilities } from "@/core/ipc/bindings/ModelCapabilities";
import type { ProviderId } from "@/core/ipc/bindings/ProviderId";
import type { ProviderModel } from "@/core/ipc/bindings/ProviderModel";

export type AiTask =
  | "generate"
  | "edit"
  | "inpaint"
  | "outpaint"
  | "variation"
  | "restyle"
  | "upscale"
  | "background"
  | "restore";

export type Needs = {
  /** Crée à partir d'un texte seul. */
  textToImage: boolean;
  /** Reçoit au moins une image. */
  imageInput: boolean;
  /** Images envoyées par demande (source, masque, références). */
  inputImages: number;
  /** Souhaits : non bloquants, mais un modèle qui les remplit est préféré. */
  ratio: string | null;
  transparent: boolean;
};

/** Besoins d'une opération. `references` : images de référence ajoutées. */
export function needsOf(
  task: AiTask,
  { references = 0, ratio = null, transparent = false }: { references?: number; ratio?: string | null; transparent?: boolean } = {},
): Needs {
  const inputs: Record<AiTask, number> = {
    generate: references,
    edit: 1 + references,
    inpaint: 2,
    outpaint: 2,
    variation: 1,
    restyle: 1,
    upscale: 1,
    background: 1,
    restore: 1,
  };
  const inputImages = inputs[task];
  return {
    textToImage: task === "generate" && references === 0,
    imageInput: inputImages > 0,
    inputImages,
    ratio,
    transparent,
  };
}

/** Pourquoi un modèle ne convient pas (bloquant) ; vide = il convient. */
export function blockers(caps: ModelCapabilities, needs: Needs): string[] {
  const out: string[] = [];
  if (needs.textToImage && !caps.textToImage) out.push("il part toujours d'une image");
  if (needs.imageInput && !caps.imageInput) out.push("il ne reçoit pas d'image");
  if (caps.imageInput && caps.maxInputImages !== null && needs.inputImages > caps.maxInputImages) {
    out.push(`il reçoit au plus ${caps.maxInputImages} image${caps.maxInputImages > 1 ? "s" : ""}`);
  }
  return out;
}

/** Souhaits que le modèle ne remplit pas (le réglage sera simplement ignoré). */
export function shortfalls(caps: ModelCapabilities, needs: Needs): string[] {
  const out: string[] = [];
  if (needs.ratio && caps.aspectRatios.length > 0 && !caps.aspectRatios.includes(needs.ratio)) {
    out.push(`le format ${needs.ratio} n'est pas proposé`);
  }
  if (needs.ratio && caps.aspectRatios.length === 0) out.push("le format n'est pas réglable");
  if (needs.transparent && !caps.transparentBackground) out.push("pas de fond transparent natif");
  return out;
}

/** Ce qu'un modèle apporte à l'opération, en mots simples (explication du mode Auto). */
export function strengths(caps: ModelCapabilities, needs: Needs): string[] {
  const out: string[] = [];
  if (needs.imageInput) out.push(needs.inputImages > 1 ? `reçoit ${needs.inputImages} images` : "reçoit une image");
  else out.push("crée à partir d'un texte");
  if (needs.ratio && caps.aspectRatios.includes(needs.ratio)) out.push(`propose le format ${needs.ratio}`);
  if (needs.transparent && caps.transparentBackground) out.push("rend un fond transparent");
  return out;
}

/** Une clé est présente (vérifiée ou non) : le fournisseur peut être essayé. */
export function usable(state: ConnectionState | undefined): boolean {
  return state === "connected" || state === "disconnected";
}

export type Candidate = { provider: ProviderId; state: ConnectionState | undefined; models: ProviderModel[] };

export type AutoChoice = {
  provider: ProviderId;
  model: ProviderModel;
  /** Ce qui a décidé le choix, lisible tel quel. */
  reasons: string[];
  /** Souhaits non remplis, à signaler. */
  shortfalls: string[];
};

/**
 * Mode Auto : premier modèle compatible, en gardant le choix de la personne s'il convient,
 * puis les autres modèles de son fournisseur, puis les autres fournisseurs connectés, chacun
 * dans l'ordre de sa propre liste. Un modèle qui remplit aussi les souhaits passe devant.
 */
export function autoPick(
  candidates: Candidate[],
  needs: Needs,
  preferred: { provider: ProviderId; model: string } | null,
): AutoChoice | null {
  const ordered = [...candidates]
    .filter((c) => usable(c.state))
    .sort((a, b) => Number(b.provider === preferred?.provider) - Number(a.provider === preferred?.provider));
  const pool: ProviderModel[] = [];
  for (const candidate of ordered) {
    const models = [...candidate.models].sort(
      (a, b) => Number(b.id === preferred?.model) - Number(a.id === preferred?.model),
    );
    pool.push(...models.filter((m) => blockers(m.capabilities, needs).length === 0));
  }
  if (pool.length === 0) return null;
  const complete = pool.find((m) => shortfalls(m.capabilities, needs).length === 0);
  const model = complete ?? pool[0]!;
  return {
    provider: model.provider,
    model,
    reasons: strengths(model.capabilities, needs),
    shortfalls: shortfalls(model.capabilities, needs),
  };
}
