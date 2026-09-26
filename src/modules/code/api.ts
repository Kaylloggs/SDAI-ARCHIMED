import { listen } from "@tauri-apps/api/event";
import { Channel, invokeModule } from "@/core/ipc";

export type FileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  ignored: boolean;
};

export type FileContent = {
  path: string;
  content: string;
  language: string;
  lines: number;
  truncated: boolean;
  binary: boolean;
};

export type ProjectInfo = {
  root: string;
  name: string;
  markers: string[];
  kinds: string[];
  isProject: boolean;
};

export type SearchOptions = { caseSensitive: boolean; wholeWord: boolean; regex: boolean };

/** Morceau d'extrait : texte ordinaire ou occurrence (déjà découpé par le backend). */
export type SearchSegment = { text: string; hit: boolean };
export type SearchLine = { line: number; segments: SearchSegment[] };
export type SearchFile = {
  path: string;
  /** Chemin relatif à la racine, séparateurs `/`. */
  relative: string;
  matches: number;
  /** Lignes concernées mais non listées (au-delà de 100 par fichier). */
  hiddenLines: number;
  lines: SearchLine[];
};
export type SearchOutcome = {
  files: SearchFile[];
  totalMatches: number;
  filesSearched: number;
  /** Arrêtée avant la fin : trop de résultats ou trop longue. */
  truncated: boolean;
  /** Remplacée par une recherche plus récente. */
  cancelled: boolean;
  durationMs: number;
};

export type TerminalEvent = { type: "output"; data: string } | { type: "exit"; code: number | null };
export type TerminalInfo = { id: string; shell: string; cwd: string };

/** Changements sur disque dans le projet surveillé (regroupés sur 250 ms). */
export type FsChange = { root: string; dirs: string[]; files: string[] };

/** Comparaison de chemins Windows : casse et séparateurs ignorés. */
export const samePath = (a: string, b: string) =>
  a.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase() === b.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();

export const codeApi = {
  watchRoot: (root: string) => invokeModule<void>("code", "watch_root", { root }),
  unwatchRoot: () => invokeModule<void>("code", "unwatch_root"),
  /** Abonnement à `code:fs-changed` ; renvoie la fonction de désabonnement (inerte hors Tauri). */
  onFsChanged: async (handler: (change: FsChange) => void): Promise<() => void> => {
    try {
      return await listen<FsChange>("code:fs-changed", (event) => handler(event.payload));
    } catch {
      return () => undefined;
    }
  },
  listDir: (path: string) => invokeModule<FileEntry[]>("code", "list_dir", { path }),
  readFile: (path: string) => invokeModule<FileContent>("code", "read_file", { path }),
  writeFile: (path: string, content: string) =>
    invokeModule<FileContent>("code", "write_file", { path, content }),
  projectInfo: (path: string) => invokeModule<ProjectInfo>("code", "project_info", { path }),
  searchFiles: (root: string, query: string, limit = 50) =>
    invokeModule<FileEntry[]>("code", "search_files", { root, query, limit }),
  /** Texte dans tout le projet ; une nouvelle recherche interrompt la précédente. */
  searchText: (root: string, query: string, options: SearchOptions, include: string, exclude: string) =>
    invokeModule<SearchOutcome>("code", "search_text", { root, query, options, include, exclude }),
  /** Ouvre un terminal (PowerShell) dans `cwd` ; sa sortie arrive sur `onEvent`. */
  terminalOpen: (cwd: string, cols: number, rows: number, onEvent: (event: TerminalEvent) => void) => {
    const channel = new Channel<TerminalEvent>();
    channel.onmessage = onEvent;
    return invokeModule<TerminalInfo>("code", "terminal_open", { cwd, cols, rows, onEvent: channel });
  },
  terminalWrite: (id: string, data: string) => invokeModule<void>("code", "terminal_write", { id, data }),
  terminalResize: (id: string, cols: number, rows: number) =>
    invokeModule<void>("code", "terminal_resize", { id, cols, rows }),
  terminalClose: (id: string) => invokeModule<void>("code", "terminal_close", { id }),
};
