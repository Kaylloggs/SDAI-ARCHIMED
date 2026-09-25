import { convertFileSrc } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { AccountSite } from "@/core/ipc/bindings/AccountSite";
import type { BrowserEvent } from "@/core/ipc/bindings/BrowserEvent";
import type { ImageAiOperation } from "@/core/ipc/bindings/ImageAiOperation";
import type { ImageAiSettings } from "@/core/ipc/bindings/ImageAiSettings";
import type { ImageBackgroundAction } from "@/core/ipc/bindings/ImageBackgroundAction";
import type { ImageInpaintMode } from "@/core/ipc/bindings/ImageInpaintMode";
import type { ImageJob } from "@/core/ipc/bindings/ImageJob";
import type { ImageLocalOperation } from "@/core/ipc/bindings/ImageLocalOperation";
import type { ImageMakerSettings } from "@/core/ipc/bindings/ImageMakerSettings";
import type { ImageNode } from "@/core/ipc/bindings/ImageNode";
import type { ImageProject } from "@/core/ipc/bindings/ImageProject";
import type { ImageProjectSummary } from "@/core/ipc/bindings/ImageProjectSummary";
import type { ImageReferenceRole } from "@/core/ipc/bindings/ImageReferenceRole";
import type { ModelList } from "@/core/ipc/bindings/ModelList";
import type { ProviderId } from "@/core/ipc/bindings/ProviderId";
import type { ProviderModel } from "@/core/ipc/bindings/ProviderModel";
import type { ProviderStatus } from "@/core/ipc/bindings/ProviderStatus";
import { errorText, imageMakerApi as api } from "./api";
import { autoPick, blockers, needsOf, shortfalls, usable, type AiTask, type Candidate } from "./lib/capabilities";
import { PROVIDER_NAMES, PROVIDERS, SITE_INFO } from "./lib/format";
import { latestChild, parentOf } from "./lib/history";
import { MaskLayer } from "./lib/mask-layer";
import { PaintLayer } from "./lib/paint-layer";
import { composePrompt, type Structure } from "./lib/prompt";
import { CENTER, type Anchor, type Rect } from "./lib/ratio";

export type Tool = "hand" | "zoom" | "rect" | "ellipse" | "lasso" | "brush" | "eraser" | "move" | "crop";
export type Panel = "create" | "edit" | "image";
export type EditTask = Exclude<AiTask, "generate">;
export type Dock = "history" | "generations" | "queue";
export type CompareMode = "off" | "slider" | "side";

/** Ce que la personne prépare dans le panneau IA (gardé par projet). */
export type Draft = {
  prompt: string;
  negative: string;
  structured: boolean;
  structure: Structure;
  ratio: string | null;
  resolution: string | null;
  count: number;
  seed: number | null;
  quality: string | null;
  transparent: boolean;
  references: ImageReferenceRole[];
  task: EditTask;
  instruction: string;
  editCount: number;
  inpaintMode: ImageInpaintMode;
  extendRatio: string;
  anchor: Anchor;
  keep: string;
  style: string;
  backgroundAction: ImageBackgroundAction;
};

export const EMPTY_DRAFT: Draft = {
  prompt: "",
  negative: "",
  structured: false,
  structure: {},
  ratio: "1:1",
  resolution: null,
  count: 1,
  seed: null,
  quality: null,
  transparent: false,
  references: [],
  task: "inpaint",
  instruction: "",
  editCount: 1,
  inpaintMode: "replace",
  extendRatio: "16:9",
  anchor: CENTER,
  keep: "",
  style: "",
  backgroundAction: "remove",
};

export type Notice = { tone: "success" | "info" | "warning" | "danger"; text: string };

/** Vue du canevas : pixels d'écran par pixel d'image, et décalage. */
export type View = { scale: number; x: number; y: number };

export type State = {
  ready: boolean;
  projects: ImageProjectSummary[];
  projectsLoaded: boolean;
  project: ImageProject | null;
  jobs: ImageJob[];
  statuses: Partial<Record<ProviderId, ProviderStatus>>;
  models: Partial<Record<ProviderId, ModelList>>;
  modelErrors: Partial<Record<ProviderId, string>>;
  settings: ImageMakerSettings | null;
  provider: ProviderId;
  model: string | null;
  auto: boolean;
  /** Dernier choix du mode Auto, expliqué. */
  autoNote: string | null;
  draft: Draft;
  panel: Panel;
  tool: Tool;
  brushSize: number;
  paintTarget: "mask" | "image";
  paintColor: string;
  mask: MaskLayer | null;
  maskRevision: number;
  maskVisible: boolean;
  /** Retouche au pinceau en cours sur l'image affichée. */
  paint: PaintLayer | null;
  paintRevision: number;
  /** Recadrage en préparation (pixels d'image) et format imposé (« 16:9 », « free », « original »). */
  cropRect: Rect | null;
  cropRatio: string;
  view: View;
  /** Incrémenté pour demander « Ajuster » (0) ou « 100 % » (1) au canevas. */
  viewRequest: { kind: "fit" | "actual" | "in" | "out"; at: number };
  compare: { mode: CompareMode; other: string | null };
  selected: string[];
  dock: Dock;
  dockOpen: boolean;
  dialog: null | "connections" | "export" | "account";
  /** Site choisi dans « Créer avec votre compte ». */
  accountSite: AccountSite;
  /** Site affiché dans le studio, à la place de l'image (vue navigateur). */
  browser: AccountSite | null;
  /** Page affichée par la vue navigateur (adresse, titre, chargement). */
  browserPage: { url: string; title: string; loading: boolean } | null;
  /** Fichiers téléchargés depuis la vue navigateur, les plus récents d'abord. */
  received: Received[];
  exportNodes: string[];
  busy: string | null;
  notice: Notice | null;
  /** Incrémenté pour demander le focus du champ de consigne. */
  focusPrompt: number;
};

type Actions = {
  init: () => Promise<() => void>;
  refreshStatuses: (check?: boolean) => Promise<void>;
  loadModels: (provider: ProviderId, refresh?: boolean) => Promise<void>;
  refreshProjects: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  closeProject: () => void;
  createProject: (name: string) => Promise<ImageProject | null>;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (name: string) => Promise<void>;
  applyProject: (project: ImageProject) => void;
  upsertJob: (job: ImageJob) => void;
  selectNode: (id: string) => Promise<void>;
  stepBack: () => void;
  stepForward: () => void;
  setDraft: (patch: Partial<Draft>) => void;
  setPanel: (panel: Panel) => void;
  setTool: (tool: Tool) => void;
  set: (patch: Partial<State>) => void;
  chooseModel: (provider: ProviderId, model: string) => void;
  toggleReference: (node: string) => void;
  setReferenceRole: (node: string, role: string) => void;
  importPaths: (paths: string[], parent?: string | null, source?: string | null) => Promise<void>;
  importData: (data: string, name?: string) => Promise<void>;
  /** Images collées dans une consigne : versions du projet ajoutées en référence, l'image affichée reste. */
  addReferenceImages: (input: { paths?: string[]; images?: { data: string; name: string }[] }) => Promise<void>;
  local: (operation: ImageLocalOperation, node?: string) => Promise<boolean>;
  localBatch: (nodes: string[], operation: ImageLocalOperation) => Promise<void>;
  savePaint: (data: string, parent: string) => Promise<void>;
  startPaint: () => Promise<void>;
  endPaint: (save: boolean) => Promise<void>;
  submit: (operation: ImageAiOperation, task: AiTask) => Promise<ImageJob[] | null>;
  cancelJob: (id: string) => Promise<void>;
  retryJob: (id: string) => Promise<void>;
  restoreJob: (job: ImageJob) => void;
  clearJobs: () => Promise<void>;
  deleteNode: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  notify: (tone: Notice["tone"], text: string) => void;
  /** Ouvre un site officiel dans le studio (un projet est créé s'il n'y en a pas). */
  openBrowser: (site: AccountSite) => Promise<void>;
  closeBrowser: () => void;
  onBrowser: (event: BrowserEvent) => void;
  /** Importe un fichier reçu : nouvelle version de l'image affichée, ou nouvelle image. */
  importReceived: (path: string, attach: boolean) => Promise<void>;
  saveSettings: (settings: ImageMakerSettings) => Promise<boolean>;
};

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let listening: Promise<() => void> | null = null;

export type Received = { path: string; name: string; image: boolean; at: number; imported: boolean };

export function currentNode(state: Pick<State, "project">): ImageNode | null {
  const project = state.project;
  if (!project) return null;
  return project.nodes.find((n) => n.id === project.current) ?? project.nodes.at(-1) ?? null;
}

export function findModel(state: Pick<State, "models">, provider: ProviderId, id: string | null): ProviderModel | undefined {
  return state.models[provider]?.models.find((m) => m.id === id);
}

function candidates(state: State): Candidate[] {
  return PROVIDERS.map((provider) => ({
    provider,
    state: state.statuses[provider]?.state,
    models: state.models[provider]?.models ?? [],
  }));
}

/** Réglages du panneau gardés dans le projet (rendus à la réouverture). */
function persisted(state: State): Record<string, unknown> {
  const { references: _references, ...draft } = state.draft;
  return { provider: state.provider, model: state.model, auto: state.auto, draft };
}

function restore(project: ImageProject): Partial<State> {
  const saved = project.aiSettings as { provider?: ProviderId; model?: string | null; auto?: boolean; draft?: Partial<Draft> };
  return {
    ...(saved.provider && PROVIDERS.includes(saved.provider) ? { provider: saved.provider } : {}),
    ...(saved.model !== undefined ? { model: saved.model } : {}),
    ...(saved.auto !== undefined ? { auto: saved.auto } : {}),
    draft: {
      ...EMPTY_DRAFT,
      ...saved.draft,
      references: project.references.map((node) => ({ node, role: "" })),
    },
  };
}

export type Resolved =
  | { provider: ProviderId; model: ProviderModel; note: string | null; reasons: string[]; shortfalls: string[] }
  | { error: string };

/**
 * Modèle qui fera l'opération : celui de la personne, ou le choix du mode Auto (expliqué).
 * Le panneau l'affiche avant l'envoi (fournisseur qui recevra les images).
 */
export function resolveModel(state: State, task: AiTask, references: number): Resolved {
  const draft = state.draft;
  const creating = task === "generate";
  const needs = needsOf(task, {
    references,
    ratio: creating ? draft.ratio : null,
    transparent: creating && draft.transparent,
  });
  if (state.auto) {
    const choice = autoPick(candidates(state), needs, state.model ? { provider: state.provider, model: state.model } : null);
    if (!choice) {
      const connected = PROVIDERS.some((p) => usable(state.statuses[p]?.state));
      return {
        error: connected
          ? "Aucun modèle de vos connexions ne sait faire cela (il faut un modèle qui reçoit des images)."
          : "Aucune connexion : ajoutez une clé dans Connexions.",
      };
    }
    const note = `Auto : ${choice.model.name} (${PROVIDER_NAMES[choice.provider]}), car il ${choice.reasons.join(", ")}.${
      choice.shortfalls.length ? ` À noter : ${choice.shortfalls.join(", ")}.` : ""
    }`;
    return { provider: choice.provider, model: choice.model, note, reasons: choice.reasons, shortfalls: choice.shortfalls };
  }
  const model = findModel(state, state.provider, state.model);
  if (!model) return { error: "Choisissez un modèle, ou activez Auto." };
  const blocked = blockers(model.capabilities, needs);
  if (blocked.length > 0) {
    return { error: `${model.name} ne convient pas : ${blocked.join(", ")}. Activez Auto ou changez de modèle.` };
  }
  return { provider: state.provider, model, note: null, reasons: [], shortfalls: shortfalls(model.capabilities, needs) };
}

export const useImageMaker = create<State & Actions>()((set, get) => {
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const state = get();
      if (state.project) void api.saveAiSettings(state.project.id, persisted(state)).catch(() => undefined);
    }, 800);
  };

  /** Masque aux dimensions de la version affichée (gardé si les dimensions ne changent pas). */
  const syncMask = () => {
    const node = currentNode(get());
    const mask = get().mask;
    if (!node) {
      if (mask) set({ mask: null });
      return;
    }
    if (mask && mask.width === node.width && mask.height === node.height) return;
    const layer = new MaskLayer(node.width, node.height);
    layer.subscribe(() => set((s) => ({ maskRevision: s.maskRevision + 1 })));
    set({ mask: layer, maskRevision: get().maskRevision + 1 });
  };

  const fail = (error: unknown) => get().notify("danger", errorText(error));

  return {
    ready: false,
    projects: [],
    projectsLoaded: false,
    project: null,
    jobs: [],
    statuses: {},
    models: {},
    modelErrors: {},
    settings: null,
    provider: "openrouter",
    model: null,
    auto: true,
    autoNote: null,
    draft: EMPTY_DRAFT,
    panel: "create",
    tool: "hand",
    brushSize: 48,
    paintTarget: "mask",
    paintColor: "#1f1f1f",
    mask: null,
    maskRevision: 0,
    maskVisible: true,
    paint: null,
    paintRevision: 0,
    cropRect: null,
    cropRatio: "free",
    view: { scale: 1, x: 0, y: 0 },
    viewRequest: { kind: "fit", at: 0 },
    compare: { mode: "off", other: null },
    selected: [],
    dock: "history",
    dockOpen: true,
    dialog: null,
    accountSite: "gemini",
    browser: null,
    browserPage: null,
    received: [],
    exportNodes: [],
    busy: null,
    notice: null,
    focusPrompt: 0,

    init: async () => {
      if (!listening) {
        listening = api
          .listen(
            (job) => get().upsertJob(job),
            (project) => get().applyProject(project),
            (event) => get().onBrowser(event),
          )
          .catch(() => () => undefined);
      }
      await Promise.all([
        api.settings().then((settings) => set({ settings })).catch(fail),
        get().refreshProjects(),
        get().refreshStatuses(false),
        api.jobs(null).then((jobs) => set({ jobs })).catch(() => undefined),
      ]);
      set({ ready: true });
      return () => undefined;
    },

    refreshStatuses: async (check = false) => {
      try {
        const list = await api.statuses(check);
        const statuses = Object.fromEntries(list.map((s) => [s.provider, s])) as Partial<Record<ProviderId, ProviderStatus>>;
        set({ statuses });
        // Listes des fournisseurs utilisables : le mode Auto et le sélecteur en ont besoin.
        await Promise.all(
          PROVIDERS.filter((p) => usable(statuses[p]?.state) && !get().models[p]).map((p) => get().loadModels(p)),
        );
        const state = get();
        if (!usable(statuses[state.provider]?.state)) {
          const first = PROVIDERS.find((p) => usable(statuses[p]?.state));
          if (first) set({ provider: first, model: null });
        }
      } catch (error) {
        fail(error);
      }
    },

    loadModels: async (provider, refresh = false) => {
      try {
        const list = await api.models(provider, refresh);
        set((s) => ({ models: { ...s.models, [provider]: list }, modelErrors: { ...s.modelErrors, [provider]: undefined } }));
        const state = get();
        if (state.provider === provider && !findModel(state, provider, state.model)) {
          set({ model: list.models[0]?.id ?? null });
        }
      } catch (error) {
        set((s) => ({ modelErrors: { ...s.modelErrors, [provider]: errorText(error) } }));
      }
    },

    refreshProjects: async () => {
      try {
        set({ projects: await api.listProjects(), projectsLoaded: true });
      } catch (error) {
        set({ projectsLoaded: true });
        fail(error);
      }
    },

    openProject: async (id) => {
      try {
        const project = await api.project(id);
        set({
          project,
          selected: [],
          compare: { mode: "off", other: null },
          panel: project.nodes.length === 0 ? "create" : get().panel,
          ...restore(project),
        });
        syncMask();
        get().mask?.history.reset();
        get().mask?.render();
      } catch (error) {
        fail(error);
      }
    },

    closeProject: () => {
      set({ project: null, mask: null, selected: [], compare: { mode: "off", other: null }, browser: null });
      void get().refreshProjects();
    },

    createProject: async (name) => {
      try {
        const project = await api.createProject(name);
        set({ project, selected: [], panel: "create", draft: { ...EMPTY_DRAFT } });
        syncMask();
        void get().refreshProjects();
        return project;
      } catch (error) {
        fail(error);
        return null;
      }
    },

    deleteProject: async (id) => {
      try {
        await api.deleteProject(id);
        if (get().project?.id === id) set({ project: null, mask: null });
        await get().refreshProjects();
        get().notify("info", "Projet mis à la Corbeille.");
      } catch (error) {
        fail(error);
      }
    },

    renameProject: async (name) => {
      const project = get().project;
      if (!project || !name.trim() || name.trim() === project.name) return;
      try {
        get().applyProject(await api.renameProject(project.id, name));
      } catch (error) {
        fail(error);
      }
    },

    applyProject: (project) => {
      set((s) => ({
        projects: s.projects.map((p) =>
          p.id === project.id ? { ...p, name: project.name, images: project.nodes.length, updatedAt: project.updatedAt } : p,
        ),
      }));
      if (get().project?.id !== project.id) return;
      const known = new Set(project.nodes.map((n) => n.id));
      set((s) => ({
        project,
        selected: s.selected.filter((id) => known.has(id)),
        compare: s.compare.other && !known.has(s.compare.other) ? { mode: "off", other: null } : s.compare,
      }));
      syncMask();
    },

    upsertJob: (job) =>
      set((s) => {
        const index = s.jobs.findIndex((j) => j.id === job.id);
        if (index === -1) return { jobs: [...s.jobs, job] };
        const jobs = s.jobs.slice();
        jobs[index] = job;
        return { jobs };
      }),

    selectNode: async (id) => {
      const project = get().project;
      if (!project || project.current === id) return;
      if (get().paint?.dirty) {
        get().notify("warning", "Enregistrez ou annulez d'abord la retouche au pinceau.");
        return;
      }
      set({ project: { ...project, current: id }, paint: null, cropRect: null });
      syncMask();
      try {
        await api.setCurrent(project.id, id);
      } catch (error) {
        fail(error);
      }
    },

    stepBack: () => {
      const state = get();
      const parent = parentOf(state.project?.nodes ?? [], state.project?.current ?? null);
      if (parent) void state.selectNode(parent.id);
    },

    stepForward: () => {
      const state = get();
      const child = latestChild(state.project?.nodes ?? [], state.project?.current ?? null);
      if (child) void state.selectNode(child.id);
    },

    setDraft: (patch) => {
      set((s) => ({ draft: { ...s.draft, ...patch } }));
      scheduleSave();
    },

    setPanel: (panel) => set({ panel }),
    setTool: (tool) => set({ tool }),
    set: (patch) => set(patch),

    chooseModel: (provider, model) => {
      set({ provider, model, auto: false, autoNote: null });
      scheduleSave();
    },

    toggleReference: (node) => {
      const state = get();
      const has = state.draft.references.some((r) => r.node === node);
      const references = has
        ? state.draft.references.filter((r) => r.node !== node)
        : [...state.draft.references, { node, role: "" }];
      state.setDraft({ references });
      if (state.project) {
        void api
          .setReferences(state.project.id, references.map((r) => r.node))
          .then((project) => get().applyProject(project))
          .catch(fail);
      }
    },

    setReferenceRole: (node, role) =>
      get().setDraft({ references: get().draft.references.map((r) => (r.node === node ? { ...r, role } : r)) }),

    importPaths: async (paths, parent = null, source = null) => {
      let project = get().project;
      if (!project) project = await get().createProject(nameFromPath(paths[0] ?? ""));
      if (!project) return;
      set({ busy: paths.length > 1 ? `Import de ${paths.length} images…` : "Import de l'image…" });
      try {
        const outcome = await api.importFiles(project.id, paths, parent, source);
        if (outcome.project) get().applyProject(outcome.project);
        if (outcome.skipped.length > 0) get().notify("warning", `Non importé : ${outcome.skipped.join(" · ")}`);
      } catch (error) {
        fail(error);
      } finally {
        set({ busy: null });
      }
    },

    importData: async (data, name = "") => {
      let project = get().project;
      if (!project) project = await get().createProject(name || "Image collée");
      if (!project) return;
      set({ busy: "Import de l'image…" });
      try {
        get().applyProject(await api.importData(project.id, data, name));
      } catch (error) {
        fail(error);
      } finally {
        set({ busy: null });
      }
    },

    addReferenceImages: async ({ paths = [], images = [] }) => {
      const project = get().project;
      if (!project || (paths.length === 0 && images.length === 0)) return;
      const before = new Set(project.nodes.map((n) => n.id));
      const shown = project.current;
      set({ busy: "Ajout des images de référence…" });
      try {
        let latest: ImageProject | null = null;
        if (paths.length > 0) {
          const outcome = await api.importFiles(project.id, paths, null, null);
          latest = outcome.project;
          if (outcome.skipped.length > 0) get().notify("warning", `Non importé : ${outcome.skipped.join(" · ")}`);
        }
        for (const image of images) latest = await api.importData(project.id, image.data, image.name);
        if (!latest) return;
        // Un import devient l'image affichée : on revient à celle que la personne regardait.
        if (shown && latest.current !== shown) latest = await api.setCurrent(project.id, shown);
        const added = latest.nodes.filter((n) => !before.has(n.id)).map((n) => n.id);
        const references = [...get().draft.references, ...added.map((node) => ({ node, role: "" }))];
        get().applyProject(latest);
        get().setDraft({ references });
        if (added.length > 0) {
          get().applyProject(await api.setReferences(project.id, references.map((r) => r.node)));
          get().notify("success", added.length > 1 ? `${added.length} images ajoutées en référence.` : "Image ajoutée en référence.");
        }
      } catch (error) {
        fail(error);
      } finally {
        set({ busy: null });
      }
    },

    local: async (operation, node) => {
      const state = get();
      const source = node ?? currentNode(state)?.id;
      if (!state.project || !source) return false;
      set({ busy: "Traitement sur cet ordinateur…" });
      try {
        get().applyProject(await api.applyLocal(state.project.id, source, operation));
        return true;
      } catch (error) {
        fail(error);
        return false;
      } finally {
        set({ busy: null });
      }
    },

    localBatch: async (nodes, operation) => {
      const project = get().project;
      if (!project || nodes.length === 0) return;
      set({ busy: `Traitement de ${nodes.length} images…` });
      try {
        const outcome = await api.applyLocalBatch(project.id, nodes, operation);
        if (outcome.project) get().applyProject(outcome.project);
        get().notify(
          outcome.skipped.length ? "warning" : "success",
          outcome.skipped.length
            ? `${outcome.created.length} faite(s), ${outcome.skipped.length} ignorée(s) : ${outcome.skipped.join(" · ")}`
            : `${outcome.created.length} version(s) créée(s).`,
        );
      } catch (error) {
        fail(error);
      } finally {
        set({ busy: null });
      }
    },

    savePaint: async (data, parent) => {
      const state = get();
      if (!state.project) return;
      set({ busy: "Enregistrement de la retouche…" });
      try {
        get().applyProject(await api.savePaint(state.project.id, parent, data));
      } catch (error) {
        fail(error);
      } finally {
        set({ busy: null });
      }
    },

    startPaint: async () => {
      const node = currentNode(get());
      if (!node) return;
      if (get().paint?.nodeId === node.id) return;
      const layer = new PaintLayer(node.id, node.width, node.height);
      try {
        await layer.load(`${convertFileSrc(node.file)}?paint`);
        set({ paint: layer, paintRevision: get().paintRevision + 1 });
        if (layer.reduced) {
          get().notify("info", "Image très grande : la retouche au pinceau se fait sur une copie de 4096 px de côté.");
        }
      } catch (error) {
        fail(error);
      }
    },

    endPaint: async (save) => {
      const layer = get().paint;
      set({ paint: null });
      if (save && layer?.dirty) await get().savePaint(layer.toDataUrl(), layer.nodeId);
    },

    submit: async (operation, task) => {
      const state = get();
      if (!state.project) return null;
      const references = "references" in operation ? operation.references.length : 0;
      const resolved = resolveModel(state, task, references);
      if ("error" in resolved) {
        state.notify("warning", resolved.error);
        return null;
      }
      const { provider, model, note } = resolved;
      const draft = state.draft;
      const creating = task === "generate";
      const caps = model.capabilities;
      const prompt = creating ? (draft.structured ? composePrompt(draft.structure) : draft.prompt) : draft.instruction;
      const settings: ImageAiSettings = {
        provider,
        model: model.id,
        prompt: prompt.trim(),
        negativePrompt: caps.negativePrompt && draft.negative.trim() ? draft.negative.trim() : null,
        aspectRatio: creating ? draft.ratio : null,
        resolution: draft.resolution && caps.resolutions.includes(draft.resolution) ? draft.resolution : null,
        count: creating ? draft.count : draft.editCount,
        seed: caps.seed ? draft.seed : null,
        quality: draft.quality && caps.qualities.includes(draft.quality) ? draft.quality : null,
        transparentBackground: creating && draft.transparent && caps.transparentBackground,
      };
      try {
        const jobs = await api.submit(state.project.id, operation, settings);
        jobs.forEach((job) => get().upsertJob(job));
        set({ autoNote: note });
        return jobs;
      } catch (error) {
        fail(error);
        return null;
      }
    },

    cancelJob: async (id) => {
      try {
        await api.cancelJob(id);
      } catch (error) {
        fail(error);
      }
    },

    retryJob: async (id) => {
      try {
        const jobs = await api.retryJob(id);
        jobs.forEach((job) => get().upsertJob(job));
      } catch (error) {
        fail(error);
      }
    },

    /** Remet la demande d'une tâche dans le panneau (consigne, modèle, réglages). */
    restoreJob: (job) => {
      const op = job.operation;
      const s = job.settings;
      const patch: Partial<Draft> =
        op.type === "generate"
          ? { prompt: s.prompt, structured: false, count: s.count, ratio: s.aspectRatio, references: op.references }
          : { instruction: s.prompt, task: op.type, editCount: s.count };
      if (op.type === "inpaint") patch.inpaintMode = op.mode;
      if (op.type === "restyle") patch.style = op.style;
      if (op.type === "variation") patch.keep = op.keep.join(", ");
      if (op.type === "background") patch.backgroundAction = op.action;
      set({ provider: s.provider, model: s.model, auto: false, panel: op.type === "generate" ? "create" : "edit" });
      get().setDraft({ ...patch, negative: s.negativePrompt ?? "", seed: s.seed, resolution: s.resolution });
      set((state) => ({ focusPrompt: state.focusPrompt + 1 }));
    },

    clearJobs: async () => {
      const project = get().project;
      if (!project) return;
      await api.clearJobs(project.id).catch(fail);
      set((s) => ({
        jobs: s.jobs.filter((j) => j.projectId !== project.id || j.status === "waiting" || j.status === "running"),
      }));
    },

    deleteNode: async (id) => {
      const project = get().project;
      if (!project) return;
      try {
        get().applyProject(await api.deleteNode(project.id, id));
        get().notify("info", "Version mise à la Corbeille.");
      } catch (error) {
        fail(error);
      }
    },

    toggleFavorite: async (id) => {
      const project = get().project;
      const node = project?.nodes.find((n) => n.id === id);
      if (!project || !node) return;
      try {
        get().applyProject(await api.setFavorite(project.id, id, !node.favorite));
      } catch (error) {
        fail(error);
      }
    },

    openBrowser: async (site) => {
      if (!get().project && !(await get().createProject(`Depuis ${SITE_INFO[site].name}`))) return;
      // Place au site : l'historique se replie (il se rouvre en bas à tout moment).
      set({ browser: site, accountSite: site, dialog: null, tool: "hand", dockOpen: false });
    },

    closeBrowser: () => {
      set({ browser: null });
      void api.browserHide().catch(() => undefined);
    },

    onBrowser: (event) => {
      if (event.type === "page") {
        set((s) => ({ browserPage: { url: event.url, title: s.browserPage?.title ?? "", loading: event.loading } }));
      } else if (event.type === "title") {
        set((s) => ({ browserPage: { url: s.browserPage?.url ?? "", loading: s.browserPage?.loading ?? false, title: event.title } }));
      } else if (event.success) {
        const item: Received = { path: event.path, name: event.name, image: event.image, at: Date.now(), imported: false };
        set((s) => ({ received: [item, ...s.received.filter((r) => r.path !== item.path)].slice(0, 20) }));
        get().notify(
          event.image ? "info" : "warning",
          event.image ? `Image reçue : ${event.name}. Importez-la depuis le panneau de droite.` : `${event.name} n'est pas une image.`,
        );
      }
    },

    importReceived: async (path, attach) => {
      const state = get();
      const node = currentNode(state);
      const site = SITE_INFO[state.browser ?? state.accountSite];
      await state.importPaths([path], attach && node ? node.id : null, site.host);
      set((s) => ({ received: s.received.map((r) => (r.path === path ? { ...r, imported: true } : r)) }));
    },

    notify: (tone, text) => {
      clearTimeout(noticeTimer);
      set({ notice: { tone, text } });
      noticeTimer = setTimeout(() => set({ notice: null }), tone === "danger" || tone === "warning" ? 9000 : 4000);
    },

    saveSettings: async (settings) => {
      try {
        set({ settings: await api.saveSettings(settings) });
        await get().loadModels("higgsfield", true);
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },
  };
});

function nameFromPath(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? "";
  return file.replace(/\.[^.]+$/, "") || "Sans titre";
}
