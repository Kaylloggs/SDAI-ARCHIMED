import { invokeModule } from "@/core/ipc";

/** Miroir de `Note` (src-tauri/src/modules/memory/service.rs). */
export type Note = {
  id: string;
  text: string;
  /** Dossier de projet, ou `null` pour une information valable partout. */
  project: string | null;
  /** Transmise aux IA. */
  enabled: boolean;
  /** Secondes Unix. */
  createdAt: number;
  updatedAt: number;
};

/** `project: null` rend la note globale ; un champ absent n'est pas modifié. */
export type NotePatch = { text?: string; enabled?: boolean; project?: string | null };

export type MemorySettings = { inject: boolean };

export const memoryApi = {
  listNotes: () => invokeModule<Note[]>("memory", "list_notes"),
  addNote: (text: string, project: string | null) => invokeModule<Note>("memory", "add_note", { text, project }),
  /** Informations lues dans un fichier .txt, .md ou .json (rien n'est enregistré). */
  readImport: (path: string) => invokeModule<string[]>("memory", "read_import", { path }),
  /** Ajout groupé ; retourne le nombre d'informations réellement ajoutées (doublons ignorés). */
  addNotes: (texts: string[], project: string | null) =>
    invokeModule<number>("memory", "add_notes", { texts, project }),
  updateNote: (id: string, patch: NotePatch) => invokeModule<Note>("memory", "update_note", { id, patch }),
  deleteNote: (id: string) => invokeModule<void>("memory", "delete_note", { id }),
  getSettings: () => invokeModule<MemorySettings>("memory", "get_settings"),
  setSettings: (settings: MemorySettings) => invokeModule<void>("memory", "set_settings", { settings }),
  buildContext: (cwd: string | null) => invokeModule<string | null>("memory", "build_context", { cwd }),
  previewContext: (cwd: string | null) => invokeModule<string | null>("memory", "preview_context", { cwd }),
};
