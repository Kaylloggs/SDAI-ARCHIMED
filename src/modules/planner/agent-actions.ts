import { defineActions, findByName } from "@/core/modules";
import { progress } from "./lib/board";
import { usePlannerStore } from "./store";
import type { Board } from "./types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function boards(): Promise<Board[]> {
  const store = usePlannerStore.getState();
  if (!store.loaded) await store.load();
  return usePlannerStore.getState().boards;
}

async function board(ref: unknown): Promise<Board | null> {
  return findByName(await boards(), String(ref ?? ""), (b) => b.name, (b) => b.id);
}

const titles = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [])
    .map((item) => (typeof item === "string" ? item : typeof item === "object" && item ? String((item as { title?: unknown }).title ?? "") : ""))
    .map((title) => title.trim())
    .filter(Boolean)
    .slice(0, 50);

const notFound = (ref: unknown) => ({ ok: false, message: `Aucun tableau ne correspond à « ${String(ref)} ». Appelle list_boards.` });

/** Actions du Planner pour les agents (voix, MCP). */
export default defineActions([
  {
    name: "list_boards",
    description: "Liste les tableaux avec leur avancement et les tâches à échéance proche.",
    risk: "read",
    run: async () => {
      const list = await boards();
      const today = new Date().toISOString().slice(0, 10);
      const data = list.map((b) => {
        const { done, total } = progress(b);
        const dueSoon = b.cards
          .filter((c) => !c.done && c.due && c.due <= addDays(today, 7))
          .map((c) => ({ title: c.title, due: c.due }));
        return { id: b.id, name: b.name, done, total, dueSoon, roadmap: b.roadmapPath };
      });
      const message =
        list.length === 0 ? "Aucun tableau." : `${list.length} tableau${list.length > 1 ? "x" : ""} : ${list.map((b) => b.name).join(", ")}.`;
      return { ok: true, message, data: { boards: data } };
    },
  },
  {
    name: "create_board",
    description: "Crée un tableau, avec ses premières tâches si besoin, et l'affiche.",
    params: {
      name: { type: "string", description: "Nom du tableau.", required: true },
      tasks: { type: "array", description: "Titres des premières tâches (texte)." },
    },
    risk: "write",
    run: async (args) => {
      const name = String(args.name).trim();
      const id = await usePlannerStore.getState().createBoard({ name });
      const tasks = titles(args.tasks);
      if (tasks.length > 0) await usePlannerStore.getState().addTasks(id, tasks.map((title) => ({ title })));
      return {
        ok: true,
        message: tasks.length > 0 ? `Tableau ${name} créé avec ${tasks.length} tâche${tasks.length > 1 ? "s" : ""}.` : `Tableau ${name} créé.`,
        data: { boardId: id },
        open: { module: "planner", params: { boardId: id } },
      };
    },
  },
  {
    name: "add_tasks",
    description: "Ajoute des tâches à un tableau (au roadmap.md s'il est lié).",
    params: {
      board: { type: "string", description: "Nom ou identifiant du tableau.", required: true },
      tasks: { type: "array", description: "Titres des tâches (texte).", required: true },
      due: { type: "string", description: "Échéance commune, AAAA-MM-JJ." },
    },
    risk: "write",
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return notFound(args.board);
      const due = typeof args.due === "string" && DATE.test(args.due) ? args.due : null;
      const tasks = titles(args.tasks);
      if (tasks.length === 0) return { ok: false, message: "Aucune tâche à ajouter." };
      await usePlannerStore.getState().addTasks(target.id, tasks.map((title) => ({ title, due })));
      const error = usePlannerStore.getState().error;
      if (error) return { ok: false, message: error };
      return {
        ok: true,
        message: `${tasks.length} tâche${tasks.length > 1 ? "s" : ""} ajoutée${tasks.length > 1 ? "s" : ""} à ${target.name}.`,
        open: { module: "planner", params: { boardId: target.id } },
      };
    },
  },
  {
    name: "complete_task",
    description: "Coche (ou décoche) une tâche d'un tableau.",
    params: {
      board: { type: "string", description: "Nom ou identifiant du tableau.", required: true },
      task: { type: "string", description: "Titre de la tâche.", required: true },
      done: { type: "boolean", description: "false pour la décocher (true par défaut)." },
    },
    risk: "write",
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return notFound(args.board);
      const card = findByName(target.cards, String(args.task), (c) => c.title, (c) => c.id);
      if (!card) return { ok: false, message: `Tâche introuvable ou ambiguë dans ${target.name} : « ${String(args.task)} ».` };
      const done = args.done !== false;
      await usePlannerStore.getState().setCardDone(target.id, card, done);
      return { ok: true, message: `« ${card.title} » ${done ? "cochée" : "décochée"}.` };
    },
  },
  {
    name: "delete_board",
    description: "Supprime un tableau et toutes ses cartes (le roadmap.md lié n'est pas touché).",
    params: { board: { type: "string", description: "Nom ou identifiant du tableau.", required: true } },
    risk: "destructive",
    confirm: (args) => `Supprimer le tableau « ${String(args.board)} » et toutes ses cartes ?`,
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return notFound(args.board);
      usePlannerStore.getState().deleteBoard(target.id);
      return { ok: true, message: `Tableau ${target.name} supprimé (${target.cards.length} cartes).` };
    },
  },
]);

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
