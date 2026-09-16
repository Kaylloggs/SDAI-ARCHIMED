import type { Board, Card, Column, PlannerTaskInput, RoadmapDoc } from "../types";

export const uid = (): string => crypto.randomUUID();

/** Même normalisation que `task_key` côté Rust : identifie une tâche d'une lecture à l'autre. */
export function taskKey(title: string): string {
  return title
    .replace(/\s*@\d{4}-\d{2}-\d{2}\b/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function createBoard(init: {
  name: string;
  roadmapPath?: string | null;
  projectRoot?: string | null;
}): Board {
  const now = Date.now();
  const columns: Column[] = init.roadmapPath
    ? []
    : [
        { id: uid(), title: "À faire" },
        { id: uid(), title: "En cours" },
        { id: uid(), title: "Terminé" },
      ];
  return {
    id: uid(),
    name: init.name.trim() || "Nouveau tableau",
    createdAt: now,
    updatedAt: now,
    columns,
    cards: [],
    roadmapPath: init.roadmapPath ?? null,
    projectRoot: init.projectRoot ?? null,
    lastSync: null,
  };
}

/**
 * Applique le contenu d'un roadmap.md à un tableau.
 * - une section = une colonne (id conservé si la section existe déjà) ;
 * - une tâche = une carte (id, notes et étiquettes conservés si la tâche existe déjà) ;
 * - les cartes issues du roadmap et absentes du fichier disparaissent ;
 * - les cartes créées à la main sont conservées.
 */
export function syncBoardWithRoadmap(board: Board, doc: RoadmapDoc): Board {
  const columns: Column[] = doc.sections.map((section) => {
    const existing = board.columns.find(
      (column) => column.roadmapSection?.toLowerCase() === section.title.toLowerCase(),
    );
    return existing
      ? { ...existing, title: section.title, roadmapSection: section.title }
      : { id: uid(), title: section.title, roadmapSection: section.title };
  });

  // Colonnes créées à la main (hors roadmap) conservées après les sections.
  for (const column of board.columns) {
    if (!column.roadmapSection) columns.push(column);
  }

  const previous = new Map(
    board.cards.filter((card) => card.roadmapKey).map((card) => [card.roadmapKey!, card]),
  );

  const roadmapCards: Card[] = doc.sections.flatMap((section, index) => {
    const column = columns[index]!;
    return section.tasks.map((task) => {
      const key = taskKey(task.title);
      const before = previous.get(key);
      return {
        id: before?.id ?? uid(),
        columnId: column.id,
        title: task.title,
        notes: before?.notes ?? "",
        due: task.due,
        labels: before?.labels ?? [],
        done: task.done,
        createdAt: before?.createdAt ?? Date.now(),
        roadmapKey: key,
        subtasks: task.subtasks,
      };
    });
  });

  const fallbackColumn = columns[0]?.id;
  const manualCards = board.cards
    .filter((card) => !card.roadmapKey)
    .map((card) =>
      columns.some((column) => column.id === card.columnId) || !fallbackColumn
        ? card
        : { ...card, columnId: fallbackColumn },
    );

  return {
    ...board,
    columns,
    cards: [...roadmapCards, ...manualCards],
    lastSync: Date.now(),
    updatedAt: Date.now(),
  };
}

export function addCards(board: Board, tasks: PlannerTaskInput[], columnId?: string): Board {
  const target = columnId ?? board.columns[0]?.id;
  if (!target) return board;
  const now = Date.now();
  const cards: Card[] = tasks.map((task) => ({
    id: uid(),
    columnId: target,
    title: task.title,
    notes: "",
    due: task.due ?? null,
    labels: [],
    done: false,
    createdAt: now,
  }));
  return { ...board, cards: [...board.cards, ...cards], updatedAt: now };
}

export function progress(board: Board): { done: number; total: number } {
  return {
    done: board.cards.filter((card) => card.done).length,
    total: board.cards.length,
  };
}
