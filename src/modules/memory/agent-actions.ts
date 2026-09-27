import { defineActions } from "@/core/modules";
import { memoryApi } from "./api";

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Actions de la Mémoire pour les agents (voix, MCP). */
export default defineActions([
  {
    name: "search_notes",
    description: "Cherche dans les informations mémorisées (préférences, faits sur la personne ou un projet).",
    params: { query: { type: "string", description: "Mots à chercher ; vide : les plus récentes." } },
    risk: "read",
    run: async (args) => {
      const words = fold(String(args.query ?? "")).split(/\s+/).filter(Boolean);
      const notes = (await memoryApi.listNotes())
        .filter((note) => words.every((word) => fold(note.text).includes(word)))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 12);
      return {
        ok: true,
        message: notes.length === 0 ? "Rien de mémorisé sur ce sujet." : `${notes.length} information${notes.length > 1 ? "s" : ""} trouvée${notes.length > 1 ? "s" : ""}.`,
        data: { notes: notes.map((n) => ({ id: n.id, text: n.text, project: n.project, enabled: n.enabled })) },
      };
    },
  },
  {
    name: "remember",
    description: "Mémorise une information durable (transmise ensuite aux IA). Pour un projet précis, indiquer son dossier.",
    params: {
      text: { type: "string", description: "Information, en une phrase.", required: true },
      project: { type: "string", description: "Dossier du projet concerné ; absent : valable partout." },
    },
    risk: "write",
    run: async (args) => {
      const text = String(args.text).trim();
      const project = typeof args.project === "string" && args.project.trim() ? args.project.trim() : null;
      const note = await memoryApi.addNote(text, project);
      return { ok: true, message: "C'est mémorisé.", data: { id: note.id } };
    },
  },
  {
    name: "forget",
    description: "Supprime une information mémorisée (identifiant donné par search_notes).",
    params: { id: { type: "string", description: "Identifiant de l'information.", required: true } },
    risk: "destructive",
    confirm: () => "Supprimer cette information de la mémoire ?",
    run: async (args) => {
      const id = String(args.id);
      const note = (await memoryApi.listNotes()).find((n) => n.id === id);
      if (!note) return { ok: false, message: "Information introuvable." };
      await memoryApi.deleteNote(id);
      return { ok: true, message: `Oublié : « ${note.text.slice(0, 80)} ».` };
    },
  },
]);
