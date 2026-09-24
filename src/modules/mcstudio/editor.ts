import { create } from "zustand";
import type { ProjectFile } from "@/core/ipc/bindings/ProjectFile";
import type { ValidationReport } from "@/core/ipc/bindings/ValidationReport";
import { errorText, mcstudioApi } from "./api";
import { isUnder, renamed } from "./lib/paths";

/** Fichier ouvert : contenu lu sur disque et brouillon (`null` tant que rien n'a changé). */
export type OpenFile = { file: ProjectFile; draft: string | null };

export type EditorState = { tabs: OpenFile[]; active: string | null };

const EMPTY: EditorState = { tabs: [], active: null };

type Store = {
  /** Onglets par projet : ils survivent au changement d'onglet du workspace. */
  editors: Record<string, EditorState>;
  /** Dernière vérification de chaque projet. */
  reports: Record<string, ValidationReport>;
  /** Panneau « Problèmes » ouvert. */
  problemsOpen: Record<string, boolean>;
  /** Ligne à montrer dans l'éditeur (clic sur un problème). */
  reveal: Record<string, { path: string; line: number; nonce: number } | null>;
  validate: (projectId: string) => Promise<void>;
  showProblems: (projectId: string, open: boolean) => void;
  /** Ouvre un fichier et amène l'éditeur sur une ligne. */
  goTo: (projectId: string, path: string, line: number | null) => Promise<void>;
  open: (projectId: string, path: string) => Promise<void>;
  activate: (projectId: string, path: string) => void;
  close: (projectId: string, path: string) => void;
  edit: (projectId: string, path: string, content: string) => void;
  /** Enregistre le brouillon ; `overwrite` ignore un changement fait ailleurs. */
  save: (projectId: string, path: string, overwrite?: boolean) => Promise<void>;
  /** Relit le fichier et abandonne le brouillon. */
  reload: (projectId: string, path: string) => Promise<void>;
  /** Relit les onglets sans brouillon (après une génération, une IA…) ; ferme ceux supprimés. */
  refreshClean: (projectId: string) => Promise<void>;
  moved: (projectId: string, from: string, to: string) => void;
  removed: (projectId: string, path: string) => void;
};

function update(
  set: (fn: (state: Store) => Partial<Store>) => void,
  projectId: string,
  change: (editor: EditorState) => EditorState,
) {
  set((state) => ({ editors: { ...state.editors, [projectId]: change(state.editors[projectId] ?? EMPTY) } }));
}

function replaceFile(editor: EditorState, file: ProjectFile, draft: string | null): EditorState {
  return { ...editor, tabs: editor.tabs.map((tab) => (tab.file.path === file.path ? { file, draft } : tab)) };
}

export const useEditorStore = create<Store>()((set, get) => ({
  editors: {},
  reports: {},
  problemsOpen: {},
  reveal: {},

  validate: async (projectId) => {
    const report = await mcstudioApi.validate(projectId);
    set((state) => ({ reports: { ...state.reports, [projectId]: report } }));
  },

  showProblems: (projectId, open) =>
    set((state) => ({ problemsOpen: { ...state.problemsOpen, [projectId]: open } })),

  goTo: async (projectId, path, line) => {
    await get().open(projectId, path);
    if (line !== null) {
      set((state) => ({ reveal: { ...state.reveal, [projectId]: { path, line, nonce: Date.now() } } }));
    }
  },

  open: async (projectId, path) => {
    const editor = get().editors[projectId] ?? EMPTY;
    if (editor.tabs.some((tab) => tab.file.path === path)) {
      update(set, projectId, (e) => ({ ...e, active: path }));
      return;
    }
    const file = await mcstudioApi.readFile(projectId, path);
    update(set, projectId, (e) => ({
      tabs: e.tabs.some((tab) => tab.file.path === path) ? e.tabs : [...e.tabs, { file, draft: null }],
      active: path,
    }));
  },

  activate: (projectId, path) => update(set, projectId, (e) => ({ ...e, active: path })),

  close: (projectId, path) =>
    update(set, projectId, (e) => {
      const index = e.tabs.findIndex((tab) => tab.file.path === path);
      const tabs = e.tabs.filter((tab) => tab.file.path !== path);
      const active = e.active === path ? (tabs[Math.min(index, tabs.length - 1)]?.file.path ?? null) : e.active;
      return { tabs, active };
    }),

  edit: (projectId, path, content) =>
    update(set, projectId, (e) => ({
      ...e,
      tabs: e.tabs.map((tab) =>
        tab.file.path === path ? { ...tab, draft: content === tab.file.content ? null : content } : tab,
      ),
    })),

  save: async (projectId, path, overwrite = false) => {
    const tab = get().editors[projectId]?.tabs.find((t) => t.file.path === path);
    if (!tab || tab.draft === null) return;
    const content = tab.draft;
    const saved = await mcstudioApi.writeFile(projectId, path, content, overwrite ? null : tab.file.modified);
    // Saisie pendant l'enregistrement : le brouillon plus récent est gardé.
    update(set, projectId, (e) => {
      const current = e.tabs.find((t) => t.file.path === path);
      const draft = current?.draft !== undefined && current.draft !== content ? current.draft : null;
      return replaceFile(e, saved, draft);
    });
  },

  reload: async (projectId, path) => {
    const file = await mcstudioApi.readFile(projectId, path);
    update(set, projectId, (e) => replaceFile(e, file, null));
  },

  refreshClean: async (projectId) => {
    const editor = get().editors[projectId];
    if (!editor) return;
    const clean = editor.tabs.filter((tab) => tab.draft === null).map((tab) => tab.file.path);
    const results = await Promise.all(
      clean.map((path) =>
        mcstudioApi
          .readFile(projectId, path)
          .then((file) => ({ path, file }))
          .catch((error: unknown) => ({ path, file: null, error: errorText(error) })),
      ),
    );
    update(set, projectId, (e) => {
      let next = e;
      for (const { path, file } of results) {
        const tab = next.tabs.find((t) => t.file.path === path);
        if (!tab || tab.draft !== null) continue;
        if (file) {
          if (file.modified !== tab.file.modified) next = replaceFile(next, file, null);
        } else {
          next = { ...next, tabs: next.tabs.filter((t) => t.file.path !== path) };
        }
      }
      const active = next.tabs.some((t) => t.file.path === next.active) ? next.active : (next.tabs[0]?.file.path ?? null);
      return { ...next, active };
    });
  },

  moved: (projectId, from, to) =>
    update(set, projectId, (e) => ({
      tabs: e.tabs.map((tab) => ({ ...tab, file: { ...tab.file, path: renamed(tab.file.path, from, to) } })),
      active: e.active ? renamed(e.active, from, to) : null,
    })),

  removed: (projectId, path) =>
    update(set, projectId, (e) => {
      const tabs = e.tabs.filter((tab) => !isUnder(tab.file.path, path));
      const active = e.active && !isUnder(e.active, path) ? e.active : (tabs[0]?.file.path ?? null);
      return { tabs, active };
    }),
}));

/** Nombre de fichiers modifiés et pas encore enregistrés dans un projet. */
export function unsavedCount(editor: EditorState | undefined): number {
  return editor?.tabs.filter((tab) => tab.draft !== null).length ?? 0;
}
