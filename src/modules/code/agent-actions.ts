import { defineActions, type ActionContext } from "@/core/modules";
import { codeApi } from "./api";

/** Dossier visé : celui demandé, sinon le projet ouvert dans Code (contexte publié). */
function rootOf(args: Record<string, unknown>, ctx: ActionContext): string | null {
  if (typeof args.root === "string" && args.root.trim()) return args.root.trim();
  return ctx.context.modules["code"]?.project?.path ?? null;
}

const NO_ROOT = { ok: false, message: "Aucun projet ouvert dans Code : indique le dossier (paramètre root)." };

const parent = (path: string) => path.replace(/[\\/][^\\/]*$/, "") || path;

/**
 * Commandes du module Code : ouvrir, parcourir, chercher, lire et écrire des fichiers, lancer une
 * commande dans le terminal. Écrire et lancer une commande demandent confirmation.
 */
export default defineActions([
  {
    name: "open_project",
    description: "Ouvre un dossier de projet dans l'éditeur, et éventuellement un fichier.",
    params: {
      path: { type: "string", description: "Dossier du projet.", required: true },
      file: { type: "string", description: "Fichier à ouvrir (chemin complet)." },
    },
    risk: "read",
    run: async (args) => {
      const path = String(args.path).trim();
      const info = await codeApi.projectInfo(path);
      const file = typeof args.file === "string" && args.file.trim() ? args.file.trim() : null;
      return {
        ok: true,
        message: `${info.name} est ouvert dans Code${file ? `, avec ${file.split(/[\\/]/).at(-1)}` : ""}.`,
        data: { root: info.root, kinds: info.kinds },
        open: { module: "code", params: { cwd: info.root, ...(file ? { file } : {}) } },
      };
    },
  },
  {
    name: "search_text",
    description: "Cherche un texte dans les fichiers du projet (hors node_modules, target…).",
    params: {
      query: { type: "string", description: "Texte à chercher.", required: true },
      root: { type: "string", description: "Dossier ; par défaut le projet ouvert dans Code." },
    },
    risk: "read",
    run: async (args, ctx) => {
      const root = rootOf(args, ctx);
      if (!root) return NO_ROOT;
      const outcome = await codeApi.searchText(root, String(args.query), { caseSensitive: false, wholeWord: false, regex: false }, "", "");
      const files = outcome.files.slice(0, 20).map((file) => ({
        path: file.relative,
        matches: file.matches,
        lines: file.lines.slice(0, 5).map((line) => ({ line: line.line, text: line.segments.map((s) => s.text).join("").trim().slice(0, 160) })),
      }));
      return {
        ok: true,
        message:
          outcome.totalMatches === 0
            ? "Aucune occurrence."
            : `${outcome.totalMatches} occurrence${outcome.totalMatches > 1 ? "s" : ""} dans ${outcome.files.length} fichier${outcome.files.length > 1 ? "s" : ""}${outcome.truncated ? " (recherche écourtée)" : ""}.`,
        data: { root, files },
      };
    },
  },
  {
    name: "read_file",
    description: "Lit un fichier texte (tronqué au-delà de 400 lignes).",
    params: { path: { type: "string", description: "Chemin complet du fichier.", required: true } },
    risk: "read",
    run: async (args) => {
      const file = await codeApi.readFile(String(args.path));
      if (file.binary) return { ok: false, message: "Fichier binaire : pas de texte à lire." };
      const lines = file.content.split("\n");
      const content = lines.slice(0, 400).join("\n");
      return {
        ok: true,
        message: `${file.path.split(/[\\/]/).at(-1)} : ${file.lines} lignes.`,
        data: { path: file.path, language: file.language, content, truncated: file.truncated || lines.length > 400 },
      };
    },
  },
  {
    name: "open_file",
    description: "Ouvre un fichier dans l'éditeur de Code (dans son projet, ou le projet ouvert).",
    params: {
      path: { type: "string", description: "Chemin complet du fichier.", required: true },
      root: { type: "string", description: "Dossier du projet (sinon le projet ouvert, ou le dossier du fichier)." },
    },
    risk: "read",
    run: async (args, ctx) => {
      const file = String(args.path).trim();
      const opened = rootOf(args, ctx);
      const root = opened && file.toLowerCase().startsWith(opened.toLowerCase()) ? opened : typeof args.root === "string" && args.root.trim() ? args.root.trim() : parent(file);
      return { ok: true, message: `${file.split(/[\\/]/).at(-1)} est ouvert dans Code.`, open: { module: "code", params: { cwd: root, file } } };
    },
  },
  {
    name: "list_dir",
    description: "Liste le contenu d'un dossier (dossiers d'abord), par défaut la racine du projet ouvert.",
    params: { path: { type: "string", description: "Dossier ; par défaut le projet ouvert dans Code." } },
    risk: "read",
    run: async (args, ctx) => {
      const path = typeof args.path === "string" && args.path.trim() ? args.path.trim() : rootOf(args, ctx);
      if (!path) return NO_ROOT;
      const entries = (await codeApi.listDir(path)).filter((e) => !e.ignored);
      return {
        ok: true,
        message: `${entries.length} élément${entries.length > 1 ? "s" : ""} dans ${path.split(/[\\/]/).at(-1) || path}.`,
        data: { path, entries: entries.slice(0, 300).map((e) => ({ name: e.name, path: e.path, dir: e.isDir, size: e.size })) },
      };
    },
  },
  {
    name: "find_files",
    description: "Trouve des fichiers du projet par leur nom (recherche approchée, comme Ctrl+P).",
    params: {
      query: { type: "string", description: "Nom ou partie du nom.", required: true },
      root: { type: "string", description: "Dossier ; par défaut le projet ouvert dans Code." },
    },
    risk: "read",
    run: async (args, ctx) => {
      const root = rootOf(args, ctx);
      if (!root) return NO_ROOT;
      const files = await codeApi.searchFiles(root, String(args.query), 30);
      return {
        ok: true,
        message: files.length === 0 ? "Aucun fichier ne correspond." : `${files.length} fichier${files.length > 1 ? "s" : ""} : ${files.slice(0, 5).map((f) => f.name).join(", ")}.`,
        data: { root, files: files.map((f) => f.path) },
      };
    },
  },
  {
    name: "write_file",
    description: "Écrit un fichier texte (le crée ou remplace tout son contenu), comme l'enregistrement dans l'éditeur.",
    params: {
      path: { type: "string", description: "Chemin complet du fichier.", required: true },
      content: { type: "string", description: "Contenu complet du fichier.", required: true },
    },
    risk: "destructive",
    confirm: (args) => `Écrire le fichier ${String(args.path).split(/[\\/]/).at(-1)} ?`,
    run: async (args) => {
      const saved = await codeApi.writeFile(String(args.path).trim(), String(args.content));
      return { ok: true, message: `${saved.path.split(/[\\/]/).at(-1)} enregistré (${saved.lines} lignes).`, data: { path: saved.path } };
    },
  },
  {
    name: "run_in_terminal",
    description: "Tape une commande dans le terminal intégré de Code, dans le dossier du projet, et l'affiche (serveur de dev, tests, build…).",
    params: {
      command: { type: "string", description: "Commande à lancer.", required: true },
      root: { type: "string", description: "Dossier ; par défaut le projet ouvert dans Code." },
    },
    risk: "destructive",
    confirm: (args) => `Lancer « ${String(args.command)} » dans le terminal ?`,
    run: async (args, ctx) => {
      const root = rootOf(args, ctx);
      if (!root) return NO_ROOT;
      // Chargé à la demande : le terminal (xterm) n'alourdit pas la base de commandes.
      const { runInTerminal } = await import("./terminal/sessions");
      runInTerminal(root, String(args.command));
      return { ok: true, message: `Commande lancée dans le terminal de ${root.split(/[\\/]/).at(-1)}.`, open: { module: "code", params: { cwd: root, terminal: true } } };
    },
  },
]);
