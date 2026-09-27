import { invokeModule } from "@/core/ipc";

export type SkillSource = "library" | "external";

export type Skill = {
  id: string;
  name: string;
  description: string;
  path: string;
  source: SkillSource;
  enabled: boolean;
  targets: string[];
};

export type DraftKind = "new" | "edit";

export type DraftInfo = {
  id: string;
  /** Nom lu dans l'en-tête du SKILL.md du brouillon (vide tant qu'il n'est pas écrit). */
  name: string;
  description: string;
  /** Dossier du brouillon : dossier de travail de l'IA. */
  path: string;
  /** Dossier du skill dans le brouillon. */
  skillPath: string;
  kind: DraftKind;
  sourceId: string | null;
  createdAt: number;
  updatedAt: number;
  savedAs: string | null;
  savedAt: number | null;
  files: number;
};

export type DraftFile = { path: string; size: number };

export type CheckLevel = "error" | "warning" | "info";
export type CheckIssue = { level: CheckLevel; code: string; message: string; file: string | null; line: number | null };

export type DraftReport = {
  name: string | null;
  description: string | null;
  bodyLines: number;
  files: number;
  bytes: number;
  scripts: string[];
  issues: CheckIssue[];
  /** Aucune erreur : le skill peut entrer dans la bibliothèque. */
  ready: boolean;
  /** Un skill de ce nom existe déjà (il sera remplacé, avec sauvegarde). */
  targetExists: boolean;
};

export type DraftChange = {
  path: string;
  kind: "created" | "modified" | "deleted";
  before: string | null;
  after: string | null;
  binary: boolean;
};

export const skillsApi = {
  list: () => invokeModule<Skill[]>("skills", "list"),
  setEnabled: (id: string, enabled: boolean) =>
    invokeModule<void>("skills", "set_enabled", { id, enabled }),
  openFolder: () => invokeModule<void>("skills", "open_folder"),
  importFromPath: (path: string) => invokeModule<Skill>("skills", "import_from_path", { path }),
  libraryPath: () => invokeModule<string>("skills", "library_path"),

  // Atelier (Skill Maker)
  /** Nouveau brouillon ; `sourceId` : skill à améliorer (copié dans le brouillon). */
  draftCreate: (sourceId: string | null = null) => invokeModule<DraftInfo>("skills", "draft_create", { sourceId }),
  draftList: () => invokeModule<DraftInfo[]>("skills", "draft_list"),
  draftInfo: (id: string) => invokeModule<DraftInfo>("skills", "draft_info", { id }),
  /** Brouillon à la Corbeille. */
  draftDelete: (id: string) => invokeModule<void>("skills", "draft_delete", { id }),
  draftFiles: (id: string) => invokeModule<DraftFile[]>("skills", "draft_files", { id }),
  /** `path` : `skill/…`, `tests.json` ou `source/…` ; `null` si le fichier n'existe pas. */
  draftRead: (id: string, path: string) => invokeModule<string | null>("skills", "draft_read", { id, path }),
  draftWrite: (id: string, path: string, content: string) =>
    invokeModule<void>("skills", "draft_write", { id, path, content }),
  draftCheck: (id: string) => invokeModule<DraftReport>("skills", "draft_check", { id }),
  draftChanges: (id: string) => invokeModule<DraftChange[]>("skills", "draft_changes", { id }),
  draftPrepareRun: (id: string) => invokeModule<string>("skills", "draft_prepare_run", { id }),
  /** Enregistre dans la bibliothèque (`replace` : remplace un skill du même nom, sauvegardé). */
  draftSave: (id: string, replace: boolean, enable: boolean) =>
    invokeModule<Skill>("skills", "draft_save", { id, replace, enable }),
};

export function errorText(error: unknown): string {
  return (error as { message?: string })?.message ?? String(error);
}
