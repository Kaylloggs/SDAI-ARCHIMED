import { listen } from "@tauri-apps/api/event";
import { invokeModule } from "@/core/ipc";

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
};
