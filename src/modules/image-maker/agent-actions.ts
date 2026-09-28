import type { ImageBackgroundAction } from "@/core/ipc/bindings/ImageBackgroundAction";
import type { ImageExportFormat } from "@/core/ipc/bindings/ImageExportFormat";
import type { ImageLocalOperation } from "@/core/ipc/bindings/ImageLocalOperation";
import type { ImageNode } from "@/core/ipc/bindings/ImageNode";
import type { ProviderId } from "@/core/ipc/bindings/ProviderId";
import { defineActions, findByName, type ActionResult } from "@/core/modules";
import { prepareCreate, prepareEdit } from "./actions";
import { imageMakerApi } from "./api";
import { PROVIDERS, PROVIDER_NAMES } from "./lib/format";
import { useImageMaker, type EditTask } from "./store";

const EDIT_TASKS: EditTask[] = ["edit", "variation", "restyle", "background", "upscale", "restore", "outpaint"];
const FORMATS: ImageExportFormat[] = ["png", "jpeg", "webp", "tiff", "gif", "bmp"];
const TRANSFORMS = ["rotate", "flip", "resize", "crop", "upscale", "adjust", "blur"] as const;

const store = () => useImageMaker.getState();
const s = (n: number) => (n > 1 ? "s" : "");
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** Le studio a besoin de ses fournisseurs et de ses projets, même page jamais ouverte. */
async function ready() {
  if (!store().ready) await store().init();
}

/**
 * Projet désigné (nom ou identifiant) rendu courant ; sans précision, le projet ouvert. Avec
 * `create`, un projet absent est créé sous ce nom.
 */
async function project(ref: unknown, create = false): Promise<ActionResult | null> {
  await ready();
  const wanted = typeof ref === "string" ? ref.trim() : "";
  if (!wanted) return store().project ? null : { ok: false, message: "Aucun projet d'images ouvert : précise lequel (list_projects)." };
  const found = findByName(await imageMakerApi.listProjects(), wanted, (p) => p.name, (p) => p.id);
  if (found) {
    if (store().project?.id !== found.id) await store().openProject(found.id);
    return null;
  }
  if (create && (await store().createProject(wanted))) return null;
  return { ok: false, message: `Projet d'images introuvable : « ${wanted} ».` };
}

/** Version désignée (identifiant, nom ou « current ») du projet courant. */
function image(ref: unknown): ImageNode | null {
  const current = store().project;
  if (!current) return null;
  const wanted = typeof ref === "string" ? ref.trim() : "";
  if (!wanted || wanted === "current") return current.nodes.find((n) => n.id === current.current) ?? current.nodes.at(-1) ?? null;
  return findByName(current.nodes, wanted, (n) => n.label || n.prompt || n.id, (n) => n.id);
}

const noImage = (ref: unknown): ActionResult => ({ ok: false, message: `Image introuvable dans le projet : « ${String(ref ?? "")} ». Appelle list_images.` });

const describeNode = (n: ImageNode, current: string | null) => ({
  id: n.id,
  label: n.label,
  kind: n.kind,
  prompt: n.prompt,
  size: `${n.width}x${n.height}`,
  model: n.model,
  favorite: n.favorite,
  current: n.id === current,
  file: n.file,
});

/** Choisit le fournisseur et le modèle demandés ; sinon le studio garde son choix (ou Auto). */
async function chooseModel(args: Record<string, unknown>): Promise<ActionResult | null> {
  if (!args.model && !args.provider) return null;
  const providers = args.provider ? PROVIDERS.filter((p) => p === args.provider || PROVIDER_NAMES[p].toLowerCase() === String(args.provider).toLowerCase()) : PROVIDERS;
  for (const provider of providers) {
    if (!store().models[provider]) await store().loadModels(provider);
    const models = store().models[provider]?.models ?? [];
    const found = args.model ? findByName(models, String(args.model), (m) => m.name, (m) => m.id) : models[0];
    if (found) {
      store().chooseModel(provider, found.id);
      return null;
    }
  }
  return { ok: false, message: `Modèle introuvable : ${String(args.model ?? args.provider)}. Appelle list_models.` };
}

/** Lance une demande préparée ; attend (au plus `wait` s) que la file la termine. */
async function submit(kind: "create" | "edit", wait: number): Promise<ActionResult> {
  const prepared = kind === "create" ? prepareCreate(store()) : prepareEdit(store(), true);
  if ("problem" in prepared) return { ok: false, message: prepared.problem };
  const jobs = await store().submit(prepared.operation, prepared.task);
  if (!jobs || jobs.length === 0) return { ok: false, message: store().notice?.text ?? "Demande refusée par le studio." };
  const ids = jobs.map((j) => j.id);
  const model = jobs[0]!.model;
  if (wait > 0) {
    const done = await Promise.race([imageMakerApi.waitJobs(ids), new Promise<null>((resolve) => setTimeout(() => resolve(null), wait * 1000))]);
    if (done) {
      const failed = done.filter((j) => j.status !== "completed");
      const results = done.flatMap((j) => j.results);
      if (failed.length === done.length) return { ok: false, message: `Échec : ${failed[0]?.error ?? "le fournisseur a refusé la demande"}.`, data: { jobs: ids } };
      return {
        ok: true,
        message: `${results.length} image${s(results.length)} prête${s(results.length)} (${model}).`,
        data: { jobs: ids, images: results, project: store().project?.id ?? null },
        open: { module: "image-maker" },
      };
    }
  }
  return {
    ok: true,
    message: `Demande envoyée à ${model} : ${jobs.length} tâche${s(jobs.length)} dans la file. Suis-la avec list_jobs.`,
    data: { jobs: ids, project: store().project?.id ?? null },
    open: { module: "image-maker" },
  };
}

function localOperation(args: Record<string, unknown>, node: ImageNode): ImageLocalOperation | string {
  switch (args.operation) {
    case "rotate":
      return { type: "rotate", degrees: num(args.degrees, 90) };
    case "flip":
      return { type: "flip", horizontal: args.horizontal !== false };
    case "resize": {
      const width = Math.round(num(args.width, 0));
      const height = Math.round(num(args.height, width ? (node.height * width) / node.width : 0));
      return width > 0 && height > 0 ? { type: "resize", width, height } : "Donne la largeur (et la hauteur) en pixels.";
    }
    case "crop": {
      const width = Math.round(num(args.width, 0));
      const height = Math.round(num(args.height, 0));
      return width > 0 && height > 0 ? { type: "crop", x: Math.round(num(args.x, 0)), y: Math.round(num(args.y, 0)), width, height } : "Donne le rectangle (x, y, width, height).";
    }
    case "upscale":
      return { type: "upscale", factor: num(args.factor, 2), sharpen: args.sharpen !== false };
    case "adjust":
      return { type: "adjust", brightness: num(args.brightness, 0), contrast: num(args.contrast, 0), hue: num(args.hue, 0) };
    case "blur":
      return { type: "blur", sigma: num(args.sigma, 3), mask_png: null, inside: true };
    default:
      return `Opération inconnue : ${TRANSFORMS.join(", ")}.`;
  }
}

const projectParam = { type: "string" as const, description: "Nom ou identifiant du projet (sinon le projet ouvert)." };
const imageParam = { type: "string" as const, description: "Version : identifiant ou nom (list_images) ; sinon l'image affichée." };
const modelParams = {
  provider: { type: "string" as const, enum: PROVIDERS, description: "Fournisseur (sinon celui choisi dans le studio)." },
  model: { type: "string" as const, description: "Modèle (nom ou identifiant, voir list_models)." },
  wait: { type: "number" as const, description: "Secondes à attendre le résultat (0 : ne pas attendre ; 90 par défaut)." },
};

/** Commandes d'Image Maker : projets, génération et retouches par IA, transformations locales, file, export. */
export default defineActions([
  // ── Projets ──
  {
    name: "list_projects",
    description: "Liste les projets d'images (nom, nombre de versions).",
    risk: "read",
    run: async () => {
      const projects = await imageMakerApi.listProjects();
      return {
        ok: true,
        message: projects.length === 0 ? "Aucun projet d'images." : `${projects.length} projet${s(projects.length)} : ${projects.map((p) => p.name).join(", ")}.`,
        data: { projects: projects.map((p) => ({ id: p.id, name: p.name, images: p.images })) },
      };
    },
  },
  {
    name: "open_project",
    description: "Ouvre un projet d'images dans le studio.",
    params: { project: { ...projectParam, required: true } },
    risk: "read",
    run: async (args) => {
      const problem = await project(args.project);
      if (problem) return problem;
      return { ok: true, message: `Projet ${store().project?.name} ouvert.`, open: { module: "image-maker" } };
    },
  },
  {
    name: "create_project",
    description: "Crée un projet d'images vide et l'ouvre.",
    params: { name: { type: "string", description: "Nom du projet.", required: true } },
    risk: "write",
    run: async (args) => {
      await ready();
      const created = await store().createProject(String(args.name).trim());
      if (!created) return { ok: false, message: store().notice?.text ?? "Projet impossible à créer." };
      return { ok: true, message: `Projet ${created.name} créé.`, data: { projectId: created.id }, open: { module: "image-maker" } };
    },
  },
  {
    name: "rename_project",
    description: "Renomme un projet d'images.",
    params: { project: projectParam, name: { type: "string", description: "Nouveau nom.", required: true } },
    risk: "write",
    run: async (args) => {
      const problem = await project(args.project);
      if (problem) return problem;
      await store().renameProject(String(args.name).trim());
      return { ok: true, message: `Projet renommé en ${String(args.name).trim()}.` };
    },
  },
  {
    name: "delete_project",
    description: "Supprime un projet d'images et toutes ses versions.",
    params: { project: { ...projectParam, required: true } },
    risk: "destructive",
    confirm: (args) => `Supprimer le projet d'images « ${String(args.project)} » et toutes ses images ?`,
    run: async (args) => {
      await ready();
      const found = findByName(await imageMakerApi.listProjects(), String(args.project), (p) => p.name, (p) => p.id);
      if (!found) return { ok: false, message: `Projet d'images introuvable : « ${String(args.project)} ».` };
      await store().deleteProject(found.id);
      return { ok: true, message: `Projet ${found.name} supprimé.` };
    },
  },

  // ── Images du projet ──
  {
    name: "list_images",
    description: "Liste les versions d'images du projet (identifiant, nom, consigne, taille, favori, affichée).",
    params: { project: projectParam },
    risk: "read",
    run: async (args) => {
      const problem = await project(args.project);
      if (problem) return problem;
      const current = store().project!;
      return {
        ok: true,
        message: `${current.nodes.length} image${s(current.nodes.length)} dans ${current.name}.`,
        data: { project: current.id, images: current.nodes.map((n) => describeNode(n, current.current)) },
      };
    },
  },
  {
    name: "select_image",
    description: "Affiche une version d'image du projet (celle que les retouches modifieront).",
    params: { project: projectParam, image: { ...imageParam, required: true } },
    risk: "read",
    run: async (args) => {
      const problem = await project(args.project);
      if (problem) return problem;
      const node = image(args.image);
      if (!node) return noImage(args.image);
      await store().selectNode(node.id);
      return { ok: true, message: `${node.label || "Image"} affichée.`, open: { module: "image-maker" } };
    },
  },
  {
    name: "undo",
    description: "Revient à la version précédente de l'image (Annuler) ou avance (redo à true).",
    params: { redo: { type: "boolean", description: "true : rétablir." } },
    risk: "write",
    run: async (args) => {
      await ready();
      if (!store().project) return { ok: false, message: "Aucun projet d'images ouvert." };
      if (args.redo === true) store().stepForward();
      else store().stepBack();
      return { ok: true, message: args.redo === true ? "Version suivante affichée." : "Version précédente affichée." };
    },
  },
  {
    name: "rename_image",
    description: "Renomme une version d'image.",
    params: { project: projectParam, image: imageParam, name: { type: "string", description: "Nouveau nom.", required: true } },
    risk: "write",
    run: async (args) => {
      const problem = await project(args.project);
      if (problem) return problem;
      const node = image(args.image);
      if (!node) return noImage(args.image);
      store().applyProject(await imageMakerApi.renameNode(store().project!.id, node.id, String(args.name).trim()));
      return { ok: true, message: `Image renommée en ${String(args.name).trim()}.` };
    },
  },
  {
    name: "set_favorite",
    description: "Marque (ou retire) une image comme favorite.",
    params: { project: projectParam, image: imageParam, favorite: { type: "boolean", description: "false pour retirer (true par défaut)." } },
    risk: "write",
    run: async (args) => {
      const problem = await project(args.project);
      if (problem) return problem;
      const node = image(args.image);
      if (!node) return noImage(args.image);
      const wanted = args.favorite !== false;
      if (node.favorite !== wanted) await store().toggleFavorite(node.id);
      return { ok: true, message: wanted ? "Ajoutée aux favoris." : "Retirée des favoris." };
    },
  },
  {
    name: "delete_image",
    description: "Supprime une version d'image du projet.",
    params: { project: projectParam, image: { ...imageParam, required: true } },
    risk: "destructive",
    confirm: (args) => `Supprimer l'image « ${String(args.image)} » ?`,
    run: async (args) => {
      const problem = await project(args.project);
      if (problem) return problem;
      const node = image(args.image);
      if (!node) return noImage(args.image);
      await store().deleteNode(node.id);
      return { ok: true, message: `${node.label || "Image"} supprimée.` };
    },
  },
  {
    name: "import_images",
    description: "Ajoute des images au projet depuis des fichiers (PNG, JPEG, WebP…).",
    params: { project: projectParam, paths: { type: "array", description: "Chemins complets des fichiers.", required: true } },
    risk: "write",
    run: async (args) => {
      const problem = await project(args.project, true);
      if (problem) return problem;
      const paths = (args.paths as unknown[]).map(String).filter(Boolean);
      const before = store().project!.nodes.length;
      await store().importPaths(paths);
      const added = (store().project?.nodes.length ?? before) - before;
      return { ok: added > 0, message: added > 0 ? `${added} image${s(added)} importée${s(added)}.` : store().notice?.text ?? "Aucune image importée.", open: { module: "image-maker" } };
    },
  },
  {
    name: "export_images",
    description: "Exporte des images du projet dans un dossier (format, qualité, plus grand côté, nommage).",
    params: {
      project: projectParam,
      directory: { type: "string", description: "Dossier de destination.", required: true },
      images: { type: "array", description: "Versions à exporter (identifiants ou noms) ; sinon l'image affichée." },
      format: { type: "string", enum: FORMATS, description: "Format (png par défaut)." },
      quality: { type: "number", description: "Qualité JPEG/WebP, 1 à 100 (90 par défaut)." },
      max_side: { type: "number", description: "Plus grand côté en pixels (sinon taille d'origine)." },
      naming: { type: "string", description: "Modèle de nom, ex. {projet}-{n}." },
    },
    risk: "write",
    run: async (args) => {
      const problem = await project(args.project);
      if (problem) return problem;
      const refs = Array.isArray(args.images) && args.images.length > 0 ? args.images : [undefined];
      const nodes = refs.map((ref) => image(ref));
      if (nodes.some((n) => !n)) return noImage(refs[nodes.findIndex((n) => !n)]);
      const format = FORMATS.includes(args.format as ImageExportFormat) ? (args.format as ImageExportFormat) : "png";
      const result = await imageMakerApi.exportImages({
        projectId: store().project!.id,
        nodes: nodes.map((n) => n!.id),
        directory: String(args.directory),
        format,
        quality: Math.min(100, Math.max(1, Math.round(num(args.quality, 90)))),
        maxSide: typeof args.max_side === "number" ? Math.round(args.max_side) : null,
        naming: typeof args.naming === "string" && args.naming.trim() ? args.naming : "{projet}-{n}",
        matte: [255, 255, 255],
      });
      return { ok: true, message: `${result.files.length} fichier${s(result.files.length)} exporté${s(result.files.length)}.${result.notes.length ? ` ${result.notes.join(" ")}` : ""}`, data: { files: result.files } };
    },
  },

  // ── IA ──
  {
    name: "prepare_image",
    description:
      "Prépare une demande d'image dans le studio (projet existant ou nouveau) sans la lancer : la personne choisit le modèle et lance la génération.",
    params: {
      prompt: { type: "string", description: "Description de l'image, précise.", required: true },
      project: { type: "string", description: "Nom du projet ; absent ou introuvable : un nouveau projet est créé." },
    },
    risk: "write",
    run: async (args) => {
      const prompt = String(args.prompt).trim();
      const problem = await project(typeof args.project === "string" && args.project.trim() ? args.project : prompt.slice(0, 40), true);
      if (problem) return problem;
      const current = store();
      current.setPanel("create");
      current.setDraft({ prompt, structured: false });
      current.set({ focusPrompt: current.focusPrompt + 1 });
      return {
        ok: true,
        message: `Demande prête dans Image Maker (${current.project?.name ?? "nouveau projet"}). Choisissez le modèle puis « Générer ».`,
        data: { projectId: current.project?.id ?? null },
        open: { module: "image-maker" },
      };
    },
  },
  {
    name: "generate_image",
    description:
      "Génère une ou plusieurs images par IA (fournisseur et modèle du studio, ou ceux demandés ; souvent payant) dans un projet, créé s'il n'existe pas.",
    params: {
      prompt: { type: "string", description: "Description de l'image, précise.", required: true },
      project: { type: "string", description: "Projet (créé s'il n'existe pas) ; sinon le projet ouvert ou un nouveau." },
      ratio: { type: "string", description: "Format, ex. 1:1, 16:9, 9:16, 4:3." },
      count: { type: "number", description: "Nombre d'images (1 par défaut)." },
      negative: { type: "string", description: "Ce qu'il ne faut pas voir (si le modèle l'accepte)." },
      transparent: { type: "boolean", description: "Fond transparent (si le modèle l'accepte)." },
      ...modelParams,
    },
    risk: "destructive",
    confirm: () => "Lancer la génération ? Elle peut être payante selon le modèle.",
    run: async (args) => {
      const prompt = String(args.prompt).trim();
      const ref = typeof args.project === "string" && args.project.trim() ? args.project : store().project ? "" : prompt.slice(0, 40);
      const problem = (await project(ref, true)) ?? (await chooseModel(args));
      if (problem) return problem;
      store().setPanel("create");
      store().setDraft({
        prompt,
        structured: false,
        negative: typeof args.negative === "string" ? args.negative : "",
        ...(typeof args.ratio === "string" && /^\d+:\d+$/.test(args.ratio) ? { ratio: args.ratio } : {}),
        count: Math.min(8, Math.max(1, Math.round(num(args.count, 1)))),
        transparent: args.transparent === true,
      });
      return submit("create", num(args.wait, 90));
    },
  },
  {
    name: "edit_image",
    description:
      "Retouche par IA l'image affichée (ou celle donnée) : edit (consigne libre), variation, restyle (style), background (remove ou replace), upscale, restore, outpaint (agrandir à un format). Souvent payant.",
    params: {
      task: { type: "string", enum: EDIT_TASKS, description: "Type de retouche.", required: true },
      instruction: { type: "string", description: "Consigne (edit, fond de remplacement)." },
      style: { type: "string", description: "Style voulu (restyle)." },
      background: { type: "string", enum: ["remove", "replace"], description: "Fond : retirer ou remplacer (background)." },
      ratio: { type: "string", description: "Format final (outpaint), ex. 16:9." },
      keep: { type: "string", description: "Ce qu'une variation doit garder (liste séparée par des virgules)." },
      project: projectParam,
      image: imageParam,
      ...modelParams,
    },
    risk: "destructive",
    confirm: (args) => `Lancer la retouche « ${String(args.task)} » ? Elle peut être payante selon le modèle.`,
    run: async (args) => {
      const problem = (await project(args.project)) ?? (await chooseModel(args));
      if (problem) return problem;
      const node = image(args.image);
      if (!node) return noImage(args.image);
      if (store().project?.current !== node.id) await store().selectNode(node.id);
      store().setPanel("edit");
      store().setDraft({
        task: args.task as EditTask,
        instruction: typeof args.instruction === "string" ? args.instruction : "",
        style: typeof args.style === "string" ? args.style : "",
        backgroundAction: (args.background === "replace" ? "replace" : "remove") as ImageBackgroundAction,
        ...(typeof args.ratio === "string" && /^\d+:\d+$/.test(args.ratio) ? { extendRatio: args.ratio } : {}),
        keep: typeof args.keep === "string" ? args.keep : "",
      });
      return submit("edit", num(args.wait, 90));
    },
  },
  {
    name: "transform_image",
    description:
      "Transforme l'image sur la machine, sans IA ni frais : rotate (degrees), flip (horizontal), resize (width, height), crop (x, y, width, height), upscale (factor), adjust (brightness, contrast, hue de -100 à 100), blur (sigma). Crée une nouvelle version.",
    params: {
      operation: { type: "string", enum: [...TRANSFORMS], description: "Transformation.", required: true },
      degrees: { type: "number" },
      horizontal: { type: "boolean" },
      width: { type: "number" },
      height: { type: "number" },
      x: { type: "number" },
      y: { type: "number" },
      factor: { type: "number" },
      brightness: { type: "number" },
      contrast: { type: "number" },
      hue: { type: "number" },
      sigma: { type: "number" },
      project: projectParam,
      image: imageParam,
    },
    risk: "write",
    run: async (args) => {
      const problem = await project(args.project);
      if (problem) return problem;
      const node = image(args.image);
      if (!node) return noImage(args.image);
      const operation = localOperation(args, node);
      if (typeof operation === "string") return { ok: false, message: operation };
      const done = await store().local(operation, node.id);
      return done ? { ok: true, message: "Nouvelle version créée.", open: { module: "image-maker" } } : { ok: false, message: store().notice?.text ?? "Transformation impossible." };
    },
  },
  {
    name: "list_models",
    description: "Modèles d'images disponibles par fournisseur connecté (gratuit ou non), et le modèle choisi.",
    params: { provider: { type: "string", enum: PROVIDERS, description: "Un seul fournisseur." } },
    risk: "read",
    run: async (args) => {
      await ready();
      const providers = PROVIDERS.filter((p) => !args.provider || p === args.provider);
      for (const provider of providers) if (!store().models[provider] && store().statuses[provider]) await store().loadModels(provider);
      const list = providers.flatMap((provider) =>
        (store().models[provider]?.models ?? []).map((m) => ({ provider, id: m.id, name: m.name, free: m.free })),
      );
      return {
        ok: true,
        message: `${list.length} modèle${s(list.length)}. Choisi : ${store().auto ? "Auto" : `${store().model ?? "aucun"} (${PROVIDER_NAMES[store().provider as ProviderId]})`}.`,
        data: { models: list.slice(0, 200), chosen: { provider: store().provider, model: store().model, auto: store().auto } },
      };
    },
  },
  {
    name: "choose_model",
    description: "Choisit le fournisseur et le modèle d'images du studio.",
    params: { provider: modelParams.provider, model: { ...modelParams.model, required: true } },
    risk: "write",
    run: async (args) => {
      await ready();
      const problem = await chooseModel(args);
      return problem ?? { ok: true, message: `Modèle ${store().model} choisi (${PROVIDER_NAMES[store().provider]}).` };
    },
  },
  {
    name: "list_jobs",
    description: "File des demandes à l'IA : en attente, en cours, terminées ou en échec (avec la raison).",
    risk: "read",
    run: async () => {
      await ready();
      const jobs = store().jobs.slice(-30);
      const running = jobs.filter((j) => j.status === "waiting" || j.status === "running").length;
      return {
        ok: true,
        message: jobs.length === 0 ? "File vide." : `${jobs.length} demande${s(jobs.length)}, ${running} en cours.`,
        data: { jobs: jobs.map((j) => ({ id: j.id, label: j.label, status: j.status, model: j.model, error: j.error, results: j.results })) },
      };
    },
  },
  {
    name: "manage_job",
    description: "Annule (cancel) ou relance (retry) une demande de la file ; clear vide la file du projet.",
    params: {
      action: { type: "string", enum: ["cancel", "retry", "clear"], description: "Action.", required: true },
      job: { type: "string", description: "Identifiant de la demande (list_jobs), sauf pour clear." },
    },
    risk: "write",
    run: async (args) => {
      await ready();
      if (args.action === "clear") {
        await store().clearJobs();
        return { ok: true, message: "File vidée." };
      }
      const id = String(args.job ?? "");
      if (!store().jobs.some((j) => j.id === id)) return { ok: false, message: "Demande introuvable (list_jobs)." };
      if (args.action === "cancel") await store().cancelJob(id);
      else await store().retryJob(id);
      return { ok: true, message: args.action === "cancel" ? "Demande annulée." : "Demande relancée." };
    },
  },
]);
