import { Channel, invokeModule } from "@/core/ipc";
import type { BlockRequest } from "@/core/ipc/bindings/BlockRequest";
import type { BuildEvent } from "@/core/ipc/bindings/BuildEvent";
import type { BuildRecord } from "@/core/ipc/bindings/BuildRecord";
import type { BuildTask } from "@/core/ipc/bindings/BuildTask";
import type { ContentResult } from "@/core/ipc/bindings/ContentResult";
import type { CreateProjectRequest } from "@/core/ipc/bindings/CreateProjectRequest";
import type { EnvironmentReport } from "@/core/ipc/bindings/EnvironmentReport";
import type { InstallEvent } from "@/core/ipc/bindings/InstallEvent";
import type { JdkOffer } from "@/core/ipc/bindings/JdkOffer";
import type { VersionOptions } from "@/core/ipc/bindings/VersionOptions";
import type { VersionSelection } from "@/core/ipc/bindings/VersionSelection";
import type { ItemRequest } from "@/core/ipc/bindings/ItemRequest";
import type { JavaInstall } from "@/core/ipc/bindings/JavaInstall";
import type { JavaStatus } from "@/core/ipc/bindings/JavaStatus";
import type { ProjectStats } from "@/core/ipc/bindings/ProjectStats";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import type { RecipeRequest } from "@/core/ipc/bindings/RecipeRequest";
import type { ResolvedVersions } from "@/core/ipc/bindings/ResolvedVersions";
import type { VersionCatalog } from "@/core/ipc/bindings/VersionCatalog";
import type { ImageModelList } from "@/core/ipc/bindings/ImageModelList";
import type { OpenRouterStatus } from "@/core/ipc/bindings/OpenRouterStatus";
import type { PixelOptions } from "@/core/ipc/bindings/PixelOptions";
import type { TextureDraft } from "@/core/ipc/bindings/TextureDraft";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import type { TextureRequest } from "@/core/ipc/bindings/TextureRequest";
import type { TextureTarget } from "@/core/ipc/bindings/TextureTarget";
import type { ProjectEntry } from "@/core/ipc/bindings/ProjectEntry";
import type { ProjectFile } from "@/core/ipc/bindings/ProjectFile";
import type { ValidationReport } from "@/core/ipc/bindings/ValidationReport";
import type { Snapshot } from "@/core/ipc/bindings/Snapshot";
import type { ApplyOutcome } from "@/core/ipc/bindings/ApplyOutcome";
import type { WorkChange } from "@/core/ipc/bindings/WorkChange";
import type { WorkInfo } from "@/core/ipc/bindings/WorkInfo";

const PLUGIN = "mcstudio";

/** Seul point d'appel du backend Mod Studio (guidelines.md, règle d'or n°5). */
export const mcstudioApi = {
  listProjects: () => invokeModule<ProjectSummary[]>(PLUGIN, "list_projects"),
  getProject: (id: string) => invokeModule<ProjectSummary>(PLUGIN, "get_project", { id }),
  createProject: (request: CreateProjectRequest) =>
    invokeModule<ProjectSummary>(PLUGIN, "create_project", { request }),
  openProject: (path: string) => invokeModule<ProjectSummary>(PLUGIN, "open_project", { path }),
  duplicateProject: (id: string) => invokeModule<ProjectSummary>(PLUGIN, "duplicate_project", { id }),
  /** `deleteFiles` : le dossier part à la Corbeille, sinon il est seulement retiré de la liste. */
  removeProject: (id: string, deleteFiles: boolean) =>
    invokeModule<void>(PLUGIN, "remove_project", { id, deleteFiles }),

  versionCatalog: () => invokeModule<VersionCatalog>(PLUGIN, "version_catalog"),
  /** Versions exactes ; `selection` = choix de la personne (sinon versions recommandées). */
  resolveVersions: (profileId: string, minecraft: string, selection: VersionSelection | null = null) =>
    invokeModule<ResolvedVersions>(PLUGIN, "resolve_versions", { profileId, minecraft, selection }),
  /** Toutes les versions du loader, de Yarn et de Fabric API publiées pour ce Minecraft. */
  versionOptions: (profileId: string, minecraft: string) =>
    invokeModule<VersionOptions>(PLUGIN, "version_options", { profileId, minecraft }),
  updateProjectVersions: (id: string, selection: VersionSelection) =>
    invokeModule<ProjectSummary>(PLUGIN, "update_project_versions", { id, selection }),

  detectJava: () => invokeModule<JavaInstall[]>(PLUGIN, "detect_java"),
  /** `null` si le dossier n'est pas un JDK. */
  inspectJava: (path: string) => invokeModule<JavaInstall | null>(PLUGIN, "inspect_java", { path }),
  /** Java demandé par les profils et JDK déjà présents. */
  environment: () => invokeModule<EnvironmentReport>(PLUGIN, "environment"),
  /** Ce qui serait téléchargé (source, taille, dossier) : rien n'est encore installé. */
  jdkOffer: (major: number) => invokeModule<JdkOffer>(PLUGIN, "jdk_offer", { major }),
  /** Installe l'offre confirmée ; l'avancement et le résultat arrivent par `onEvent`. */
  installJdk: (offer: JdkOffer, onEvent: Channel<InstallEvent>) =>
    invokeModule<void>(PLUGIN, "install_jdk", { offer, onEvent }),
  cancelJdkInstall: (major: number) => invokeModule<void>(PLUGIN, "cancel_jdk_install", { major }),
  projectJava: (id: string) => invokeModule<JavaStatus>(PLUGIN, "project_java", { id }),
  setProjectJava: (id: string, javaHome: string | null) =>
    invokeModule<JavaStatus>(PLUGIN, "set_project_java", { id, javaHome }),

  projectStats: (id: string) => invokeModule<ProjectStats>(PLUGIN, "project_stats", { id }),
  defaultParentDir: () => invokeModule<string>(PLUGIN, "default_parent_dir"),

  addItem: (id: string, request: ItemRequest) => invokeModule<ContentResult>(PLUGIN, "add_item", { id, request }),
  addBlock: (id: string, request: BlockRequest) => invokeModule<ContentResult>(PLUGIN, "add_block", { id, request }),
  addRecipe: (id: string, request: RecipeRequest) =>
    invokeModule<ContentResult>(PLUGIN, "add_recipe", { id, request }),

  /** Lance Gradle ; les lignes et le résultat arrivent par `onEvent`. Renvoie l'id du build. */
  build: (id: string, task: BuildTask, offline: boolean, onEvent: Channel<BuildEvent>) =>
    invokeModule<string>(PLUGIN, "build_project", { id, task, offline, onEvent }),
  cancelBuild: (id: string) => invokeModule<void>(PLUGIN, "cancel_build", { id }),
  listBuilds: (id: string) => invokeModule<BuildRecord[]>(PLUGIN, "list_builds", { id }),
  readBuildLog: (id: string, buildId: string) =>
    invokeModule<string>(PLUGIN, "read_build_log", { id, buildId }),

  /** `check` : interroge OpenRouter (compte gratuit, crédit). La clé ne revient jamais. */
  openrouterStatus: (check: boolean) => invokeModule<OpenRouterStatus>(PLUGIN, "openrouter_status", { check }),
  /** Vérifiée auprès d'OpenRouter avant d'être rangée dans le Gestionnaire d'identifiants. */
  setOpenrouterKey: (key: string) => invokeModule<OpenRouterStatus>(PLUGIN, "set_openrouter_key", { key }),
  clearOpenrouterKey: () => invokeModule<void>(PLUGIN, "clear_openrouter_key"),
  imageModels: () => invokeModule<ImageModelList>(PLUGIN, "image_models"),
  /** Texte exact envoyé au modèle pour cette description. */
  texturePrompt: (target: TextureTarget, description: string) =>
    invokeModule<string>(PLUGIN, "texture_prompt", { target, description }),
  listTextures: (id: string) => invokeModule<TextureInfo[]>(PLUGIN, "list_textures", { id }),
  generateTexture: (id: string, request: TextureRequest) =>
    invokeModule<TextureDraft>(PLUGIN, "generate_texture", { id, request }),
  importTexture: (id: string, target: TextureTarget, path: string, options: PixelOptions) =>
    invokeModule<TextureDraft>(PLUGIN, "import_texture", { id, target, path, options }),
  reprocessTexture: (draftId: string, options: PixelOptions) =>
    invokeModule<TextureDraft>(PLUGIN, "reprocess_texture", { draftId, options }),
  /** Écrit le brouillon dans le projet ; l'ancienne texture part dans `.mcstudio/history/`. */
  applyTexture: (id: string, draftId: string) =>
    invokeModule<TextureInfo>(PLUGIN, "apply_texture", { id, draftId }),

  /** Chemins relatifs au projet, avec des `/` ; `dir` = "" pour la racine. */
  listFiles: (id: string, dir: string) => invokeModule<ProjectEntry[]>(PLUGIN, "list_files", { id, dir }),
  readFile: (id: string, path: string) => invokeModule<ProjectFile>(PLUGIN, "read_project_file", { id, path }),
  /** `expectedModified` : date lue à l'ouverture (conflit refusé) ; `null` pour écraser. */
  writeFile: (id: string, path: string, content: string, expectedModified: number | null) =>
    invokeModule<ProjectFile>(PLUGIN, "write_project_file", { id, path, content, expectedModified }),
  createFile: (id: string, path: string, directory: boolean) =>
    invokeModule<ProjectEntry>(PLUGIN, "create_project_file", { id, path, directory }),
  renameFile: (id: string, from: string, to: string) =>
    invokeModule<void>(PLUGIN, "rename_project_file", { id, from, to }),
  /** Corbeille (récupérable). */
  trashFile: (id: string, path: string) => invokeModule<void>(PLUGIN, "trash_project_file", { id, path }),
  /** Problèmes visibles sans compiler : syntaxe, références, format de la version. */
  validate: (id: string) => invokeModule<ValidationReport>(PLUGIN, "validate_project", { id }),

  listSnapshots: (id: string) => invokeModule<Snapshot[]>(PLUGIN, "list_snapshots", { id }),
  /** Copie de tous les fichiers du projet (hors builds et caches). */
  createSnapshot: (id: string, label: string) => invokeModule<Snapshot>(PLUGIN, "create_snapshot", { id, label }),
  /** Renvoie l'instantané pris juste avant : la restauration s'annule. */
  restoreSnapshot: (id: string, snapshotId: string) =>
    invokeModule<Snapshot>(PLUGIN, "restore_snapshot", { id, snapshotId }),
  deleteSnapshot: (id: string, snapshotId: string) =>
    invokeModule<void>(PLUGIN, "delete_snapshot", { id, snapshotId }),

  /** Copie de travail de l'agent (créée ou mise à jour) : son `path` est le `cwd` de la conversation. */
  agentPrepare: (id: string) => invokeModule<WorkInfo>(PLUGIN, "agent_prepare", { id }),
  /** Consignes de l'agent pour ce projet (version, loader, règles d'API et de données). */
  agentInstructions: (id: string) => invokeModule<string>(PLUGIN, "agent_instructions", { id }),
  agentChanges: (id: string) => invokeModule<WorkChange[]>(PLUGIN, "agent_changes", { id }),
  /** Applique au projet, après un point de restauration. */
  agentApply: (id: string, paths: string[]) => invokeModule<ApplyOutcome>(PLUGIN, "agent_apply", { id, paths }),
  agentDiscard: (id: string, paths: string[]) => invokeModule<void>(PLUGIN, "agent_discard", { id, paths }),
  agentReset: (id: string) => invokeModule<WorkInfo>(PLUGIN, "agent_reset", { id }),
};

/** Message lisible d'une erreur renvoyée par le backend. */
export function errorText(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
