/**
 * Service `image.maker`, offert aux autres modules (contrat décrit dans le README du module) :
 * générer, modifier, détourer, agrandir, varier une image sans ouvrir le studio. Les images
 * arrivent dans le projet « Demandes des autres modules » d'Image Maker, et chaque fonction
 * renvoie les chemins des fichiers produits. Un module consommateur DOIT gérer l'absence du
 * service (Image Maker désactivé ou supprimé).
 */
import type { ImageAiOperation } from "@/core/ipc/bindings/ImageAiOperation";
import type { ImageAiSettings } from "@/core/ipc/bindings/ImageAiSettings";
import type { ProviderId } from "@/core/ipc/bindings/ProviderId";
import type { ProviderModel } from "@/core/ipc/bindings/ProviderModel";
import { imageMakerApi as api } from "../api";
import { autoPick, blockers, needsOf, usable, type AiTask, type Candidate } from "../lib/capabilities";
import { PROVIDERS } from "../lib/format";

export type ImageOptions = {
  /** Fournisseur et modèle ; sans eux, le choix suit le mode Auto (modèle compatible). */
  provider?: ProviderId;
  model?: string;
  /** « 16:9 »… (création seulement). */
  aspectRatio?: string;
  /** Nombre de résultats (1…8). */
  count?: number;
  /** Chemins d'images de référence (création et modification). */
  references?: string[];
};

export type ImageResult = {
  /** Fichiers produits (chemins absolus), dans l'ordre d'arrivée. */
  files: string[];
  /** Projet Image Maker qui les garde (historique, retouches possibles). */
  projectId: string;
  /** Modèle réellement utilisé ; `null` pour un traitement fait sur la machine. */
  provider: ProviderId | null;
  model: string | null;
  /** Demandes en échec, avec leur message (les autres ont abouti). */
  errors: string[];
};

async function pickModel(task: AiTask, references: number, options: ImageOptions): Promise<ProviderModel> {
  const statuses = await api.statuses(false);
  const candidates: Candidate[] = [];
  for (const provider of PROVIDERS) {
    const state = statuses.find((s) => s.provider === provider)?.state;
    if (!usable(state)) continue;
    const list = await api.models(provider).catch(() => null);
    candidates.push({ provider, state, models: list?.models ?? [] });
  }
  const needs = needsOf(task, { references, ratio: options.aspectRatio ?? null });
  if (options.provider && options.model) {
    const model = candidates.find((c) => c.provider === options.provider)?.models.find((m) => m.id === options.model);
    if (!model) throw new Error(`Modèle ${options.model} indisponible (clé absente ou modèle retiré).`);
    const blocked = blockers(model.capabilities, needs);
    if (blocked.length > 0) throw new Error(`${model.name} ne convient pas : ${blocked.join(", ")}.`);
    return model;
  }
  const preferred = options.provider ? candidates.filter((c) => c.provider === options.provider) : candidates;
  const choice = autoPick(preferred, needs, null);
  if (!choice) throw new Error("Aucun modèle d'Image Maker ne sait faire cela : ajoutez une clé dans Image Maker › Connexions.");
  return choice.model;
}

async function importOne(projectId: string, path: string): Promise<string> {
  const outcome = await api.importFiles(projectId, [path]);
  const id = outcome.created[0];
  if (!id) throw new Error(outcome.skipped[0] ?? `Image illisible : ${path}`);
  return id;
}

async function runTask(
  task: AiTask,
  build: (projectId: string, source: string | null, references: { node: string; role: string }[]) => ImageAiOperation,
  source: string | null,
  prompt: string,
  options: ImageOptions,
): Promise<ImageResult> {
  const project = await api.integrationProject();
  const sourceNode = source ? await importOne(project.id, source) : null;
  const references = [];
  for (const path of options.references ?? []) references.push({ node: await importOne(project.id, path), role: "" });
  const model = await pickModel(task, task === "generate" || task === "edit" ? references.length : 0, options);
  const settings: ImageAiSettings = {
    provider: model.provider,
    model: model.id,
    prompt,
    negativePrompt: null,
    aspectRatio: task === "generate" ? (options.aspectRatio ?? null) : null,
    resolution: null,
    count: Math.min(8, Math.max(1, options.count ?? 1)),
    seed: null,
    quality: null,
    transparentBackground: false,
  };
  const jobs = await api.submit(project.id, build(project.id, sourceNode, references), settings);
  const done = await api.waitJobs(jobs.map((j) => j.id));
  const created = new Set(done.flatMap((j) => j.results));
  const errors = done.filter((j) => j.status === "failed").map((j) => j.error ?? "Échec");
  const nodes = (await api.project(project.id)).nodes.filter((n) => created.has(n.id));
  if (nodes.length === 0) throw new Error(errors[0] ?? "Aucune image produite.");
  return { files: nodes.map((n) => n.file), projectId: project.id, provider: model.provider, model: model.id, errors };
}

/** Texte → image(s). */
export function generateImage(prompt: string, options: ImageOptions = {}): Promise<ImageResult> {
  return runTask("generate", (_p, _s, references) => ({ type: "generate", references }), null, prompt, options);
}

/** Modifie toute l'image selon une consigne. */
export function editImage(image: string, instruction: string, options: ImageOptions = {}): Promise<ImageResult> {
  return runTask("edit", (_p, source, references) => ({ type: "edit", source: source!, references }), image, instruction, options);
}

/** Fond transparent (transparence du modèle, sinon fond uni détouré sur la machine). */
export function removeBackground(image: string, options: ImageOptions = {}): Promise<ImageResult> {
  return runTask("background", (_p, source) => ({ type: "background", source: source!, action: "remove" }), image, "", {
    ...options,
    count: 1,
  });
}

/**
 * Agrandit une image. `local: true` : sur la machine (Lanczos), sans IA ni envoi ;
 * sinon régénération plus nette par le modèle.
 */
export async function upscaleImage(
  image: string,
  options: ImageOptions & { local?: boolean; factor?: number } = {},
): Promise<ImageResult> {
  if (!options.local) {
    return runTask("upscale", (_p, source) => ({ type: "upscale", source: source! }), image, "", { ...options, count: 1 });
  }
  const project = await api.integrationProject();
  const source = await importOne(project.id, image);
  const updated = await api.applyLocal(project.id, source, { type: "upscale", factor: options.factor ?? 2, sharpen: true });
  const node = updated.nodes.find((n) => n.id === updated.current);
  if (!node) throw new Error("Agrandissement impossible.");
  return { files: [node.file], projectId: project.id, provider: null, model: null, errors: [] };
}

/** Variantes ; `keep` : éléments à garder (« le visage », « la pose »…). */
export function createVariation(
  image: string,
  options: ImageOptions & { keep?: string[]; change?: string } = {},
): Promise<ImageResult> {
  return runTask(
    "variation",
    (_p, source) => ({ type: "variation", source: source!, keep: options.keep ?? [] }),
    image,
    options.change ?? "",
    options,
  );
}
