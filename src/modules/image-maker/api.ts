import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeModule } from "@/core/ipc";
import type { CliInfo } from "@/core/ipc/bindings/CliInfo";
import type { DownloadedImage } from "@/core/ipc/bindings/DownloadedImage";
import type { ImageAiOperation } from "@/core/ipc/bindings/ImageAiOperation";
import type { ImageAiSettings } from "@/core/ipc/bindings/ImageAiSettings";
import type { ImageBatchOutcome } from "@/core/ipc/bindings/ImageBatchOutcome";
import type { ImageExportRequest } from "@/core/ipc/bindings/ImageExportRequest";
import type { ImageExportResult } from "@/core/ipc/bindings/ImageExportResult";
import type { ImageJob } from "@/core/ipc/bindings/ImageJob";
import type { ImageLocalOperation } from "@/core/ipc/bindings/ImageLocalOperation";
import type { ImageMakerSettings } from "@/core/ipc/bindings/ImageMakerSettings";
import type { ImageProject } from "@/core/ipc/bindings/ImageProject";
import type { ImageProjectSummary } from "@/core/ipc/bindings/ImageProjectSummary";
import type { ModelList } from "@/core/ipc/bindings/ModelList";
import type { PriceLine } from "@/core/ipc/bindings/PriceLine";
import type { PromptSuggestion } from "@/core/ipc/bindings/PromptSuggestion";
import type { ProviderId } from "@/core/ipc/bindings/ProviderId";
import type { ProviderStatus } from "@/core/ipc/bindings/ProviderStatus";

const PLUGIN = "image-maker";

/** Événements émis par le backend (voir `src-tauri/src/modules/image_maker/mod.rs`). */
export const JOB_EVENT = "image-maker:job";
export const PROJECT_EVENT = "image-maker:project";

/** Seul point d'appel du backend Image Maker (guidelines.md, règle d'or n°5). */
export const imageMakerApi = {
  // Connexions
  statuses: (check: boolean) => invokeModule<ProviderStatus[]>(PLUGIN, "provider_statuses", { check }),
  /** La clé est vérifiée par le fournisseur puis rangée ; elle ne revient jamais. */
  setKey: (provider: ProviderId, key: string) =>
    invokeModule<ProviderStatus>(PLUGIN, "set_provider_key", { provider, key }),
  clearKey: (provider: ProviderId) => invokeModule<ProviderStatus>(PLUGIN, "clear_provider_key", { provider }),
  /** Connexion au compte : la page officielle s'ouvre dans le navigateur (aucun mot de passe ici). */
  login: (provider: ProviderId) => invokeModule<ProviderStatus>(PLUGIN, "provider_login", { provider }),
  cliInfo: () => invokeModule<CliInfo>(PLUGIN, "higgsfield_cli_info"),
  /** `npm install -g @higgsfield/cli`, seulement après confirmation explicite. */
  installCli: () => invokeModule<string>(PLUGIN, "install_higgsfield_cli"),
  models: (provider: ProviderId, refresh = false) =>
    invokeModule<ModelList>(PLUGIN, "provider_models", { provider, refresh }),
  pricing: (provider: ProviderId, model: string) =>
    invokeModule<PriceLine[]>(PLUGIN, "model_pricing", { provider, model }),
  /** Le texte (jamais d'image) part chez le fournisseur choisi. */
  improvePrompt: (provider: ProviderId, prompt: string, structured: boolean) =>
    invokeModule<PromptSuggestion>(PLUGIN, "improve_prompt", { provider, prompt, structured }),

  // Réglages
  settings: () => invokeModule<ImageMakerSettings>(PLUGIN, "get_maker_settings"),
  saveSettings: (settings: ImageMakerSettings) =>
    invokeModule<ImageMakerSettings>(PLUGIN, "save_maker_settings", { settings }),

  // Projets
  listProjects: () => invokeModule<ImageProjectSummary[]>(PLUGIN, "list_image_projects"),
  createProject: (name: string) => invokeModule<ImageProject>(PLUGIN, "create_image_project", { name }),
  project: (id: string) => invokeModule<ImageProject>(PLUGIN, "get_image_project", { id }),
  /** Le dossier du projet part à la Corbeille. */
  deleteProject: (id: string) => invokeModule<void>(PLUGIN, "delete_image_project", { id }),
  renameProject: (id: string, name: string) => invokeModule<ImageProject>(PLUGIN, "rename_image_project", { id, name }),
  setCurrent: (projectId: string, nodeId: string) =>
    invokeModule<ImageProject>(PLUGIN, "set_current_node", { projectId, nodeId }),
  setFavorite: (projectId: string, nodeId: string, favorite: boolean) =>
    invokeModule<ImageProject>(PLUGIN, "set_favorite", { projectId, nodeId, favorite }),
  renameNode: (projectId: string, nodeId: string, label: string) =>
    invokeModule<ImageProject>(PLUGIN, "rename_node", { projectId, nodeId, label }),
  setReferences: (projectId: string, nodes: string[]) =>
    invokeModule<ImageProject>(PLUGIN, "set_references", { projectId, nodes }),
  saveAiSettings: (projectId: string, settings: Record<string, unknown>) =>
    invokeModule<ImageProject>(PLUGIN, "save_ai_settings", { projectId, settings }),
  /** La version part à la Corbeille ; ses descendantes se rattachent à son parent. */
  deleteNode: (projectId: string, nodeId: string) =>
    invokeModule<ImageProject>(PLUGIN, "delete_node", { projectId, nodeId }),
  integrationProject: () => invokeModule<ImageProject>(PLUGIN, "integration_project"),

  // Import et opérations locales (rien n'est envoyé)
  /** `parent` : version dont l'image découle ; `source` : site d'où elle vient. */
  importFiles: (projectId: string, paths: string[], parent: string | null = null, source: string | null = null) =>
    invokeModule<ImageBatchOutcome>(PLUGIN, "import_files", { projectId, paths, parent, source }),
  importData: (projectId: string, data: string, name = "") =>
    invokeModule<ImageProject>(PLUGIN, "import_data", { projectId, data, name }),
  applyLocal: (projectId: string, nodeId: string, operation: ImageLocalOperation) =>
    invokeModule<ImageProject>(PLUGIN, "apply_local", { projectId, nodeId, operation }),
  applyLocalBatch: (projectId: string, nodes: string[], operation: ImageLocalOperation) =>
    invokeModule<ImageBatchOutcome>(PLUGIN, "apply_local_batch", { projectId, nodes, operation }),
  savePaint: (projectId: string, parent: string, data: string) =>
    invokeModule<ImageProject>(PLUGIN, "save_paint", { projectId, parent, data }),

  // File IA
  submit: (projectId: string, operation: ImageAiOperation, settings: ImageAiSettings) =>
    invokeModule<ImageJob[]>(PLUGIN, "submit_operation", { projectId, operation, settings }),
  jobs: (projectId: string | null) => invokeModule<ImageJob[]>(PLUGIN, "list_jobs", { projectId }),
  cancelJob: (id: string) => invokeModule<void>(PLUGIN, "cancel_job", { id }),
  retryJob: (id: string) => invokeModule<ImageJob[]>(PLUGIN, "retry_job", { id }),
  clearJobs: (projectId: string) => invokeModule<void>(PLUGIN, "clear_jobs", { projectId }),
  waitJobs: (ids: string[]) => invokeModule<ImageJob[]>(PLUGIN, "wait_jobs", { ids }),

  // Export et mode compte
  exportImages: (request: ImageExportRequest) => invokeModule<ImageExportResult>(PLUGIN, "export_images", { request }),
  recentDownloads: (since: number) => invokeModule<DownloadedImage[]>(PLUGIN, "recent_downloads", { since }),

  /** Suivi des tâches et des projets ; renvoie la fonction qui arrête l'écoute. */
  listen: async (
    onJob: (job: ImageJob) => void,
    onProject: (project: ImageProject) => void,
  ): Promise<UnlistenFn> => {
    const stops = await Promise.all([
      listen<ImageJob>(JOB_EVENT, (event) => onJob(event.payload)),
      listen<ImageProject>(PROJECT_EVENT, (event) => onProject(event.payload)),
    ]);
    return () => stops.forEach((stop) => stop());
  },
};

export function errorText(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
