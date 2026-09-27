import { invokeCore } from "@/core/ipc";
import type { FileDiff } from "@/core/ipc/bindings/FileDiff";
import type { GitStatus } from "@/core/ipc/bindings/GitStatus";

export type { FileDiff, GitStatus };
export type { GitFile } from "@/core/ipc/bindings/GitFile";

/** Dossier de travail d'une conversation : git (lecture seule) et fichiers (core/workspace.rs). */
export const workspaceApi = {
  /** `null` : pas un dépôt git (ou git absent). */
  gitStatus: (cwd: string) => invokeCore<GitStatus | null>("workspace_git_status", { cwd }),
  fileDiff: (root: string, path: string) => invokeCore<FileDiff>("workspace_file_diff", { root, path }),
  /** Chemins relatifs (`/`), dépendances et builds exclus ; gardés 20 s côté Rust. */
  files: (cwd: string) => invokeCore<string[]>("workspace_files", { cwd }),
};
