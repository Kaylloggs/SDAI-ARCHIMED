import { describe, expect, it } from "vitest";
import { addCards, createBoard, removeColumn, renameColumn, syncBoardWithRoadmap, taskKey } from "../lib/board";
import { extractEvents, extractTasks, findDate } from "../lib/extract";
import { dueState, googleCalendarUrl, monthGrid } from "../lib/calendar";
import type { RoadmapDoc } from "../types";

const NOW = new Date(2026, 8, 16); // 16 septembre 2026

const doc = (tasks: Array<[string, boolean]>, section = "Phase 1"): RoadmapDoc => ({
  title: "Roadmap",
  sections: [
    {
      title: section,
      tasks: tasks.map(([title, done]) => ({ title, done, due: null, subtasks: [] })),
    },
  ],
  total: tasks.length,
  done: tasks.filter(([, done]) => done).length,
});

describe("synchronisation roadmap ↔ tableau", () => {
  it("crée colonnes et cartes depuis le fichier", () => {
    const board = syncBoardWithRoadmap(
      createBoard({ name: "Projet", roadmapPath: "F:/p/roadmap.md" }),
      doc([["Écrire le parseur", false], ["Initialiser", true]]),
    );
    expect(board.columns.map((c) => c.title)).toEqual(["Phase 1"]);
    expect(board.cards).toHaveLength(2);
    expect(board.cards.find((c) => c.title === "Initialiser")?.done).toBe(true);
  });

  it("conserve id, notes et étiquettes quand l'IA coche une tâche", () => {
    const first = syncBoardWithRoadmap(
      createBoard({ name: "Projet", roadmapPath: "r.md" }),
      doc([["Écrire le parseur", false]]),
    );
    const annotated = {
      ...first,
      cards: first.cards.map((c) => ({ ...c, notes: "voir PR", labels: ["urgent"] })),
    };
    const second = syncBoardWithRoadmap(annotated, doc([["Écrire  le parseur", true]]));
    expect(second.cards[0]).toMatchObject({
      id: first.cards[0]!.id,
      notes: "voir PR",
      labels: ["urgent"],
      done: true,
    });
  });

  it("retire les tâches supprimées du fichier mais garde les cartes manuelles", () => {
    const synced = syncBoardWithRoadmap(
      createBoard({ name: "P", roadmapPath: "r.md" }),
      doc([["A garder", false], ["A supprimer", false]]),
    );
    const withManual = addCards(synced, [{ title: "Carte manuelle" }]);
    const after = syncBoardWithRoadmap(withManual, doc([["A garder", false]]));
    expect(after.cards.map((c) => c.title).sort()).toEqual(["A garder", "Carte manuelle"]);
  });

  it("normalise les clés comme le backend", () => {
    expect(taskKey("  Écrire   le Parseur @2026-10-01 ")).toBe("écrire le parseur");
  });
});

describe("extraction depuis un message d'assistant", () => {
  const message = [
    "Voici le plan :",
    "- [ ] Créer le module **Planner** @2026-10-01",
    "- [x] Lire la roadmap",
    "TODO : brancher Google Agenda",
    "```",
    "- [ ] ceci est du code, à ignorer",
    "```",
    "Livraison prévue le 12 octobre.",
    "Revue le 03/11/2026 avec l'équipe.",
  ].join("\n");

  it("trouve les cases à cocher et les TODO hors blocs de code", () => {
    const tasks = extractTasks(message, NOW);
    expect(tasks.map((t) => t.title)).toEqual([
      "Créer le module Planner",
      "Lire la roadmap",
      "brancher Google Agenda",
    ]);
    expect(tasks[0]?.due).toBe("2026-10-01");
    expect(tasks[1]?.done).toBe(true);
  });

  it("trouve les dates ISO, françaises et JJ/MM/AAAA", () => {
    const events = extractEvents(message, NOW);
    expect(events.map((e) => e.date)).toEqual(["2026-10-01", "2026-10-12", "2026-11-03"]);
  });

  it("choisit l'année suivante pour une date passée sans année", () => {
    expect(findDate("le 3 janvier", NOW)).toBe("2027-01-03");
    expect(findDate("31/02/2026", NOW)).toBeNull();
  });
});

describe("agenda", () => {
  it("construit un lien Google Agenda journée entière", () => {
    const url = new URL(googleCalendarUrl({ title: "Livraison v1", date: "2026-12-31" }));
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("dates")).toBe("20261231/20270101");
    expect(url.searchParams.get("text")).toBe("Livraison v1");
  });

  it("qualifie les échéances", () => {
    expect(dueState("2026-09-15", NOW)).toBe("late");
    expect(dueState("2026-09-16", NOW)).toBe("today");
    expect(dueState("2026-09-18", NOW)).toBe("soon");
    expect(dueState("2026-10-30", NOW)).toBeNull();
  });
});

describe("colonnes et calendrier", () => {
  it("supprime une colonne avec ses cartes et renomme", () => {
    const board = createBoard({ name: "Perso" });
    const [todo, doing] = board.columns;
    const filled = addCards(addCards(board, [{ title: "A" }], todo!.id), [{ title: "B" }], doing!.id);
    const removed = removeColumn(filled, todo!.id);
    expect(removed.columns).toHaveLength(2);
    expect(removed.cards.map((c) => c.title)).toEqual(["B"]);
    expect(renameColumn(removed, doing!.id, "  Actif ").columns[0]?.title).toBe("Actif");
    expect(renameColumn(removed, doing!.id, "  ").columns[0]?.title).toBe("En cours");
  });

  it("construit la grille du mois du lundi au dimanche", () => {
    const grid = monthGrid(2026, 8); // septembre 2026 : commence un mardi
    expect(grid.length % 7).toBe(0);
    expect(grid[0]).toMatchObject({ date: "2026-08-31", inMonth: false });
    expect(grid[1]).toMatchObject({ date: "2026-09-01", day: 1, inMonth: true });
    expect(grid.filter((d) => d.inMonth)).toHaveLength(30);
  });
});
