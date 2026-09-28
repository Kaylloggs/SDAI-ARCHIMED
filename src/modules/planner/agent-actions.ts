import { openUrl } from "@tauri-apps/plugin-opener";
import { defineActions, findByName, type ActionResult } from "@/core/modules";
import { plannerApi } from "./api";
import { addCards, addColumn, deleteCard, moveCard, patchCard, progress, removeColumn, renameColumn, type CardPatch } from "./lib/board";
import { googleCalendarUrl } from "./lib/calendar";
import { usePlannerStore } from "./store";
import type { Board, Card, Column } from "./types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function boards(): Promise<Board[]> {
  const store = usePlannerStore.getState();
  if (!store.loaded) await store.load();
  return usePlannerStore.getState().boards;
}

/** Tableau désigné par son nom ou son identifiant ; sans précision, le tableau affiché. */
async function board(ref: unknown): Promise<Board | null> {
  const list = await boards();
  const wanted = typeof ref === "string" ? ref.trim() : "";
  if (!wanted) return list.find((b) => b.id === usePlannerStore.getState().activeBoardId) ?? (list.length === 1 ? list[0]! : null);
  return findByName(list, wanted, (b) => b.name, (b) => b.id);
}

const latest = (id: string) => usePlannerStore.getState().boards.find((b) => b.id === id) ?? null;

function column(target: Board, ref: unknown): Column | null {
  return findByName(target.columns, String(ref ?? ""), (c) => c.title, (c) => c.id);
}

function card(target: Board, ref: unknown): Card | null {
  return findByName(target.cards, String(ref ?? ""), (c) => c.title, (c) => c.id);
}

const titles = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [])
    .map((item) => (typeof item === "string" ? item : typeof item === "object" && item ? String((item as { title?: unknown }).title ?? "") : ""))
    .map((title) => title.trim())
    .filter(Boolean)
    .slice(0, 50);

const labelsOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [])
    .map((label) => String(label).trim())
    .filter(Boolean);

const noBoard = (ref: unknown): ActionResult => ({
  ok: false,
  message: ref ? `Aucun tableau ne correspond à « ${String(ref)} » (ou plusieurs). Appelle list_boards.` : "Précise le tableau (list_boards).",
});
const noCard = (target: Board, ref: unknown): ActionResult => ({
  ok: false,
  message: `Carte introuvable ou ambiguë dans ${target.name} : « ${String(ref)} ». Appelle get_board pour voir les cartes.`,
});
const noColumn = (target: Board, ref: unknown): ActionResult => ({
  ok: false,
  message: `Colonne introuvable dans ${target.name} : « ${String(ref)} ». Colonnes : ${target.columns.map((c) => c.title).join(", ") || "aucune"}.`,
});

const shown = (target: Board) => ({ module: "planner", params: { boardId: target.id } });
const s = (n: number) => (n > 1 ? "s" : "");

function describeCard(c: Card, target: Board) {
  return {
    id: c.id,
    title: c.title,
    column: target.columns.find((col) => col.id === c.columnId)?.title ?? null,
    done: c.done,
    due: c.due,
    labels: c.labels,
    notes: c.notes.slice(0, 400),
    subtasks: c.subtasks ?? [],
    fromRoadmap: Boolean(c.roadmapKey),
  };
}

const board_param = { type: "string" as const, description: "Nom ou identifiant du tableau (sinon le tableau affiché)." };
const card_param = { type: "string" as const, description: "Titre (ou identifiant) de la carte.", required: true };

/** Commandes du Planner : tout ce qu'on fait à la main sur les tableaux, colonnes et cartes. */
export default defineActions([
  // ── Tableaux ──
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
        return { id: b.id, name: b.name, done, total, columns: b.columns.map((c) => c.title), dueSoon, roadmap: b.roadmapPath };
      });
      const message =
        list.length === 0 ? "Aucun tableau." : `${list.length} tableau${list.length > 1 ? "x" : ""} : ${list.map((b) => b.name).join(", ")}.`;
      return { ok: true, message, data: { boards: data } };
    },
  },
  {
    name: "get_board",
    description: "Détail d'un tableau : colonnes et cartes (titre, colonne, échéance, étiquettes, notes, fait ou non).",
    params: { board: board_param },
    risk: "read",
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return noBoard(args.board);
      const { done, total } = progress(target);
      return {
        ok: true,
        message: `${target.name} : ${total} carte${s(total)}, ${done} faite${s(done)}, colonnes ${target.columns.map((c) => c.title).join(", ")}.`,
        data: {
          id: target.id,
          name: target.name,
          roadmap: target.roadmapPath,
          projectRoot: target.projectRoot,
          columns: target.columns.map((col) => ({ id: col.id, title: col.title, cards: target.cards.filter((c) => c.columnId === col.id).map((c) => describeCard(c, target)) })),
        },
      };
    },
  },
  {
    name: "create_board",
    description: "Crée un tableau (colonnes À faire, En cours, Terminé, ou celles données), avec ses premières tâches si besoin, et l'affiche. Peut suivre un roadmap.md.",
    params: {
      name: { type: "string", description: "Nom du tableau.", required: true },
      tasks: { type: "array", description: "Titres des premières tâches (texte)." },
      columns: { type: "array", description: "Titres des colonnes, à la place des colonnes par défaut." },
      roadmap: { type: "string", description: "Chemin d'un fichier roadmap.md à suivre (synchronisé dans les deux sens)." },
    },
    risk: "write",
    run: async (args) => {
      const name = String(args.name).trim();
      const roadmapPath = typeof args.roadmap === "string" && args.roadmap.trim() ? args.roadmap.trim() : null;
      const projectRoot = roadmapPath ? roadmapPath.replace(/[\\/](docs[\\/])?[^\\/]+$/i, "") : null;
      const id = await usePlannerStore.getState().createBoard({ name, roadmapPath, projectRoot });
      const columns = titles(args.columns);
      if (columns.length > 0 && !roadmapPath) {
        usePlannerStore.getState().updateBoard(id, (b) => columns.reduce(addColumn, { ...b, columns: [] }));
      }
      const tasks = titles(args.tasks);
      if (tasks.length > 0) await usePlannerStore.getState().addTasks(id, tasks.map((title) => ({ title })));
      return {
        ok: true,
        message: tasks.length > 0 ? `Tableau ${name} créé avec ${tasks.length} tâche${s(tasks.length)}.` : `Tableau ${name} créé.`,
        data: { boardId: id },
        open: { module: "planner", params: { boardId: id } },
      };
    },
  },
  {
    name: "open_board",
    description: "Affiche un tableau, en vue tableau ou calendrier.",
    params: { board: board_param, view: { type: "string", enum: ["board", "calendar"], description: "Vue : colonnes (board) ou calendrier des échéances." } },
    risk: "read",
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return noBoard(args.board);
      usePlannerStore.getState().setActive(target.id);
      const view = args.view === "calendar" || args.view === "board" ? args.view : undefined;
      return { ok: true, message: `${target.name} est affiché${view === "calendar" ? " en calendrier" : ""}.`, open: { module: "planner", params: { boardId: target.id, ...(view ? { view } : {}) } } };
    },
  },
  {
    name: "rename_board",
    description: "Renomme un tableau.",
    params: { board: board_param, name: { type: "string", description: "Nouveau nom.", required: true } },
    risk: "write",
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return noBoard(args.board);
      const name = String(args.name).trim();
      usePlannerStore.getState().renameBoard(target.id, name);
      return { ok: true, message: `Tableau ${target.name} renommé en ${name}.`, open: shown(target) };
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
      if (!target) return noBoard(args.board);
      usePlannerStore.getState().deleteBoard(target.id);
      return { ok: true, message: `Tableau ${target.name} supprimé (${target.cards.length} cartes).` };
    },
  },
  {
    name: "sync_roadmap",
    description: "Relit le roadmap.md lié au tableau et met les cartes à jour.",
    params: { board: board_param },
    risk: "write",
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return noBoard(args.board);
      if (!target.roadmapPath) return { ok: false, message: `${target.name} ne suit aucun roadmap.md.` };
      await usePlannerStore.getState().syncRoadmap(target.id);
      const error = usePlannerStore.getState().error;
      return error ? { ok: false, message: error } : { ok: true, message: `${target.name} synchronisé avec ${target.roadmapPath}.` };
    },
  },
  {
    name: "export_calendar",
    description: "Exporte les échéances des cartes non faites d'un tableau dans un fichier .ics (à importer dans Google Agenda, Outlook…).",
    params: { board: board_param, path: { type: "string", description: "Fichier .ics à écrire (chemin complet).", required: true } },
    risk: "write",
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return noBoard(args.board);
      const events = target.cards
        .filter((c) => c.due && !c.done)
        .map((c) => ({ uid: c.id, title: c.title, date: c.due!, description: c.notes || null }));
      if (events.length === 0) return { ok: false, message: "Aucune carte avec une échéance à exporter." };
      const path = String(args.path).trim();
      const count = await plannerApi.exportIcs(path.endsWith(".ics") ? path : `${path}.ics`, target.name, events);
      return { ok: true, message: `${count} échéance${s(count)} exportée${s(count)} dans ${path}.`, data: { path, count } };
    },
  },

  // ── Colonnes ──
  {
    name: "add_column",
    description: "Ajoute une colonne à un tableau.",
    params: { board: board_param, title: { type: "string", description: "Titre de la colonne.", required: true } },
    risk: "write",
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return noBoard(args.board);
      usePlannerStore.getState().updateBoard(target.id, (b) => addColumn(b, String(args.title)));
      return { ok: true, message: `Colonne ${String(args.title).trim()} ajoutée à ${target.name}.`, open: shown(target) };
    },
  },
  {
    name: "rename_column",
    description: "Renomme une colonne d'un tableau.",
    params: { board: board_param, column: { type: "string", description: "Titre actuel de la colonne.", required: true }, title: { type: "string", description: "Nouveau titre.", required: true } },
    risk: "write",
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return noBoard(args.board);
      const col = column(target, args.column);
      if (!col) return noColumn(target, args.column);
      usePlannerStore.getState().updateBoard(target.id, (b) => renameColumn(b, col.id, String(args.title)));
      return { ok: true, message: `Colonne ${col.title} renommée en ${String(args.title).trim()}.`, open: shown(target) };
    },
  },
  {
    name: "delete_column",
    description: "Supprime une colonne et ses cartes (une colonne issue du roadmap.md revient à la synchronisation).",
    params: { board: board_param, column: { type: "string", description: "Titre de la colonne.", required: true } },
    risk: "destructive",
    confirm: (args) => `Supprimer la colonne « ${String(args.column)} » et ses cartes ?`,
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return noBoard(args.board);
      const col = column(target, args.column);
      if (!col) return noColumn(target, args.column);
      const count = target.cards.filter((c) => c.columnId === col.id).length;
      usePlannerStore.getState().updateBoard(target.id, (b) => removeColumn(b, col.id));
      return { ok: true, message: `Colonne ${col.title} supprimée (${count} carte${s(count)}).`, open: shown(target) };
    },
  },

  // ── Cartes ──
  {
    name: "add_tasks",
    description: "Ajoute des tâches à un tableau, dans sa première colonne (au roadmap.md s'il est lié).",
    params: {
      board: board_param,
      tasks: { type: "array", description: "Titres des tâches (texte).", required: true },
      due: { type: "string", description: "Échéance commune, AAAA-MM-JJ." },
    },
    risk: "write",
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return noBoard(args.board);
      const due = typeof args.due === "string" && DATE.test(args.due) ? args.due : null;
      const tasks = titles(args.tasks);
      if (tasks.length === 0) return { ok: false, message: "Aucune tâche à ajouter." };
      await usePlannerStore.getState().addTasks(target.id, tasks.map((title) => ({ title, due })));
      const error = usePlannerStore.getState().error;
      if (error) return { ok: false, message: error };
      return {
        ok: true,
        message: `${tasks.length} tâche${s(tasks.length)} ajoutée${s(tasks.length)} à ${target.name}.`,
        open: shown(target),
      };
    },
  },
  {
    name: "add_card",
    description: "Ajoute une carte dans une colonne précise, avec échéance, étiquettes et notes si besoin.",
    params: {
      board: board_param,
      title: { type: "string", description: "Titre de la carte.", required: true },
      column: { type: "string", description: "Colonne (sinon la première)." },
      due: { type: "string", description: "Échéance, AAAA-MM-JJ." },
      labels: { type: "array", description: "Étiquettes (texte)." },
      notes: { type: "string", description: "Notes (Markdown)." },
    },
    risk: "write",
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return noBoard(args.board);
      const col = args.column ? column(target, args.column) : target.columns[0];
      if (!col) return args.column ? noColumn(target, args.column) : { ok: false, message: `${target.name} n'a aucune colonne : ajoute-en une (add_column).` };
      const title = String(args.title).trim();
      const due = typeof args.due === "string" && DATE.test(args.due) ? args.due : null;
      const before = new Set(target.cards.map((c) => c.id));
      usePlannerStore.getState().updateBoard(target.id, (b) => addCards(b, [{ title, due }], col.id));
      const created = latest(target.id)?.cards.find((c) => !before.has(c.id));
      const labels = labelsOf(args.labels);
      const notes = typeof args.notes === "string" ? args.notes : "";
      if (created && (labels.length > 0 || notes)) {
        usePlannerStore.getState().updateBoard(target.id, (b) => patchCard(b, created.id, { labels, notes }));
      }
      return { ok: true, message: `Carte « ${title} » ajoutée dans ${col.title}.`, data: { cardId: created?.id ?? null }, open: shown(target) };
    },
  },
  {
    name: "update_card",
    description:
      "Modifie une carte : titre, notes (remplacer ou compléter), échéance (vide pour l'effacer), étiquettes (remplacer, ajouter, retirer), fait ou non. Seuls les champs donnés changent.",
    params: {
      board: board_param,
      card: card_param,
      title: { type: "string", description: "Nouveau titre." },
      notes: { type: "string", description: "Nouvelles notes (Markdown), remplacent les anciennes." },
      append_notes: { type: "string", description: "Texte ajouté à la fin des notes." },
      due: { type: "string", description: "Échéance AAAA-MM-JJ ; chaîne « none » pour l'effacer." },
      labels: { type: "array", description: "Étiquettes, remplacent les anciennes." },
      add_labels: { type: "array", description: "Étiquettes à ajouter." },
      remove_labels: { type: "array", description: "Étiquettes à retirer." },
      done: { type: "boolean", description: "Carte faite (true) ou à faire (false)." },
    },
    risk: "write",
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return noBoard(args.board);
      const found = card(target, args.card);
      if (!found) return noCard(target, args.card);
      const fromRoadmap = Boolean(found.roadmapKey);
      const patch: CardPatch = {};
      const refused: string[] = [];
      const changed: string[] = [];

      if (typeof args.title === "string" && args.title.trim() && args.title.trim() !== found.title) {
        if (fromRoadmap) refused.push("le titre");
        else {
          patch.title = args.title.trim();
          changed.push("titre");
        }
      }
      if (typeof args.due === "string") {
        const clear = ["", "none", "null", "aucune"].includes(args.due.trim().toLowerCase());
        if (!clear && !DATE.test(args.due.trim())) return { ok: false, message: "Échéance attendue au format AAAA-MM-JJ (ou « none » pour l'effacer)." };
        if (fromRoadmap) refused.push("l'échéance");
        else {
          patch.due = clear ? null : args.due.trim();
          changed.push(clear ? "échéance effacée" : `échéance ${args.due.trim()}`);
        }
      }
      if (typeof args.notes === "string") {
        patch.notes = args.notes;
        changed.push("notes");
      }
      if (typeof args.append_notes === "string" && args.append_notes.trim()) {
        const base = patch.notes ?? found.notes;
        patch.notes = base ? `${base.replace(/\s+$/, "")}\n\n${args.append_notes.trim()}` : args.append_notes.trim();
        if (!changed.includes("notes")) changed.push("notes");
      }
      if (args.labels !== undefined || args.add_labels !== undefined || args.remove_labels !== undefined) {
        let labels = args.labels !== undefined ? labelsOf(args.labels) : [...found.labels];
        for (const label of labelsOf(args.add_labels)) if (!labels.some((l) => l.toLowerCase() === label.toLowerCase())) labels.push(label);
        const removed = labelsOf(args.remove_labels).map((l) => l.toLowerCase());
        labels = labels.filter((l) => !removed.includes(l.toLowerCase()));
        patch.labels = labels;
        changed.push("étiquettes");
      }
      if (Object.keys(patch).length > 0) usePlannerStore.getState().updateBoard(target.id, (b) => patchCard(b, found.id, patch));
      if (typeof args.done === "boolean" && args.done !== found.done) {
        await usePlannerStore.getState().setCardDone(target.id, latest(target.id)?.cards.find((c) => c.id === found.id) ?? found, args.done);
        changed.push(args.done ? "faite" : "à faire");
      }
      const note = refused.length > 0 ? ` Carte issue du roadmap.md : ${refused.join(" et ")} se change${refused.length > 1 ? "nt" : ""} dans le fichier (@AAAA-MM-JJ pour une date).` : "";
      if (changed.length === 0) return { ok: refused.length === 0, message: `Rien à changer sur « ${found.title} ».${note}` };
      return { ok: true, message: `« ${patch.title ?? found.title} » modifiée : ${changed.join(", ")}.${note}`, open: shown(target) };
    },
  },
  {
    name: "move_card",
    description: "Déplace une carte vers une autre colonne (ex. En cours, Terminé).",
    params: { board: board_param, card: card_param, column: { type: "string", description: "Colonne d'arrivée.", required: true } },
    risk: "write",
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return noBoard(args.board);
      const found = card(target, args.card);
      if (!found) return noCard(target, args.card);
      const col = column(target, args.column);
      if (!col) return noColumn(target, args.column);
      usePlannerStore.getState().updateBoard(target.id, (b) => moveCard(b, found.id, col.id));
      return { ok: true, message: `« ${found.title} » déplacée dans ${col.title}.`, open: shown(target) };
    },
  },
  {
    name: "complete_task",
    description: "Coche (ou décoche) une tâche d'un tableau.",
    params: {
      board: board_param,
      task: { type: "string", description: "Titre de la tâche.", required: true },
      done: { type: "boolean", description: "false pour la décocher (true par défaut)." },
    },
    risk: "write",
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return noBoard(args.board);
      const found = card(target, args.task);
      if (!found) return noCard(target, args.task);
      const done = args.done !== false;
      await usePlannerStore.getState().setCardDone(target.id, found, done);
      return { ok: true, message: `« ${found.title} » ${done ? "cochée" : "décochée"}.` };
    },
  },
  {
    name: "delete_card",
    description: "Supprime une carte (pas celles issues du roadmap.md : les retirer du fichier).",
    params: { board: board_param, card: card_param },
    risk: "destructive",
    confirm: (args) => `Supprimer la carte « ${String(args.card)} » ?`,
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return noBoard(args.board);
      const found = card(target, args.card);
      if (!found) return noCard(target, args.card);
      if (found.roadmapKey) return { ok: false, message: `« ${found.title} » vient du roadmap.md : retire-la du fichier ${target.roadmapPath}.` };
      usePlannerStore.getState().updateBoard(target.id, (b) => deleteCard(b, found.id));
      return { ok: true, message: `Carte « ${found.title} » supprimée.` };
    },
  },
  {
    name: "find_cards",
    description: "Cherche des cartes dans tous les tableaux : texte, étiquette, échéance avant une date, faites ou non.",
    params: {
      text: { type: "string", description: "Mots du titre ou des notes." },
      label: { type: "string", description: "Étiquette." },
      due_before: { type: "string", description: "Échéance au plus tard ce jour (AAAA-MM-JJ)." },
      done: { type: "boolean", description: "true : faites ; false : à faire." },
    },
    risk: "read",
    run: async (args) => {
      const text = typeof args.text === "string" ? args.text.toLowerCase().trim() : "";
      const label = typeof args.label === "string" ? args.label.toLowerCase().trim() : "";
      const before = typeof args.due_before === "string" && DATE.test(args.due_before) ? args.due_before : null;
      const found = (await boards()).flatMap((b) =>
        b.cards
          .filter((c) => !text || `${c.title} ${c.notes}`.toLowerCase().includes(text))
          .filter((c) => !label || c.labels.some((l) => l.toLowerCase() === label))
          .filter((c) => !before || (c.due !== null && c.due <= before))
          .filter((c) => typeof args.done !== "boolean" || c.done === args.done)
          .map((c) => ({ board: b.name, ...describeCard(c, b) })),
      );
      return {
        ok: true,
        message: found.length === 0 ? "Aucune carte ne correspond." : `${found.length} carte${s(found.length)} : ${found.slice(0, 8).map((c) => c.title).join(", ")}${found.length > 8 ? "…" : ""}.`,
        data: { cards: found.slice(0, 100) },
      };
    },
  },
  {
    name: "add_to_google_calendar",
    description: "Ouvre Google Agenda avec l'échéance d'une carte prête à enregistrer.",
    params: { board: board_param, card: card_param },
    risk: "write",
    run: async (args) => {
      const target = await board(args.board);
      if (!target) return noBoard(args.board);
      const found = card(target, args.card);
      if (!found) return noCard(target, args.card);
      if (!found.due) return { ok: false, message: `« ${found.title} » n'a pas d'échéance.` };
      await openUrl(googleCalendarUrl({ title: found.title, date: found.due, details: `Tableau « ${target.name} »${found.notes ? `\n\n${found.notes}` : ""}` }));
      return { ok: true, message: `Google Agenda est ouvert sur « ${found.title} », le ${found.due}.` };
    },
  },
]);

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
