import { defineActions, type ActionContext } from "@/core/modules";
import { codeApi } from "./api";

/** Dossier visé : celui demandé, sinon le projet ouvert dans Code (contexte publié). */
function rootOf(args: Record<string, unknown>, ctx: ActionContext): string | null {
  if (typeof args.root === "string" && args.root.trim()) return args.root.trim();
  return ctx.context.modules["code"]?.project?.path ?? null;
}

const NO_ROOT = { ok: false, message: "Aucun projet ouvert dans Code : indique le dossier (paramètre root)." };

/** Actions du module Code pour les agents (voix, MCP). Lecture seule : les modifications passent par l'agent et ses permissions. */
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
]);
