import { invokeModule } from "@/core/ipc";

/** Miroir de `Note` (src-tauri/src/modules/memory/service.rs). */
export type Note = {
  id: string;
  text: string;
  /** Dossier de projet, ou `null` pour une note globale. */
  project: string | null;
  /** `user` | `ai` | `message` */
  source: string;
  /** Secondes Unix. */
  createdAt: number;
};

export type JournalEntry = {
  /** Secondes Unix. */
  at: number;
  conversationId: string;
  origin: string;
  adapter: string;
  project: string | null;
  title: string;
  request: string;
  outcome: string;
  files: string[];
  commands: string[];
};

export type MemorySettings = { inject: boolean; capture: boolean };

export const memoryApi = {
  listNotes: () => invokeModule<Note[]>("memory", "list_notes"),
  addNote: (text: string, project: string | null, source: "user" | "ai" | "message") =>
    invokeModule<Note>("memory", "add_note", { text, project, source }),
  updateNote: (id: string, text: string) => invokeModule<void>("memory", "update_note", { id, text }),
  deleteNote: (id: string) => invokeModule<void>("memory", "delete_note", { id }),
  journal: (project: string | null, limit = 100) =>
    invokeModule<JournalEntry[]>("memory", "journal", { project, limit }),
  recordTurn: (entry: JournalEntry) => invokeModule<void>("memory", "record_turn", { entry }),
  clearJournal: () => invokeModule<void>("memory", "clear_journal"),
  getSettings: () => invokeModule<MemorySettings>("memory", "get_settings"),
  setSettings: (settings: MemorySettings) => invokeModule<void>("memory", "set_settings", { settings }),
  buildContext: (cwd: string | null) => invokeModule<string | null>("memory", "build_context", { cwd }),
  previewContext: (cwd: string | null) => invokeModule<string | null>("memory", "preview_context", { cwd }),
};
