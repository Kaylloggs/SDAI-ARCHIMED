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

export const codeApi = {
  listDir: (path: string) => invokeModule<FileEntry[]>("code", "list_dir", { path }),
  readFile: (path: string) => invokeModule<FileContent>("code", "read_file", { path }),
  writeFile: (path: string, content: string) =>
    invokeModule<FileContent>("code", "write_file", { path, content }),
  projectInfo: (path: string) => invokeModule<ProjectInfo>("code", "project_info", { path }),
  searchFiles: (root: string, query: string, limit = 50) =>
    invokeModule<FileEntry[]>("code", "search_files", { root, query, limit }),
};
