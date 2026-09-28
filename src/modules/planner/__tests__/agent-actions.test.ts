import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  ROADMAP_CHANGED: "planner:roadmap-changed",
  plannerApi: {
    loadBoards: vi.fn(async () => []),
    saveBoards: vi.fn(async () => undefined),
    exportIcs: vi.fn(async (_path: string, _name: string, events: unknown[]) => events.length),
    watchRoadmap: vi.fn(async () => undefined),
    unwatchRoadmap: vi.fn(async () => undefined),
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
const openUrl = vi.fn(async (_url: string) => undefined);
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrl(url) }));

import actions from "../agent-actions";
import { usePlannerStore } from "../store";

const ctx = { context: {} as never, openModule: () => undefined };
const run = async (name: string, args: Record<string, unknown> = {}) => {
  const action = actions.find((a) => a.name === name);
  if (!action) throw new Error(`commande absente : ${name}`);
  return action.run(args, ctx);
};
const board = () => usePlannerStore.getState().boards[0]!;
const card = (title: string) => board().cards.find((c) => c.title === title)!;

describe("commandes du Planner", () => {
  beforeEach(() => {
    usePlannerStore.setState({ boards: [], activeBoardId: null, loaded: true, error: null });
  });

  it("couvre les tableaux, colonnes et cartes", () => {
    const names = actions.map((a) => a.name);
    for (const name of ["create_board", "rename_board", "delete_board", "add_column", "rename_column", "delete_column", "add_card", "update_card", "move_card", "delete_card", "find_cards", "get_board"]) {
      expect(names).toContain(name);
    }
    expect(actions.filter((a) => a.risk === "destructive").map((a) => a.name).sort()).toEqual(["delete_board", "delete_card", "delete_column"]);
  });

  it("modifie une carte comme on le ferait à la main", async () => {
    await run("create_board", { name: "Lancement", tasks: ["Écrire le communiqué", "Préparer la démo"] });
    expect(board().columns.map((c) => c.title)).toEqual(["À faire", "En cours", "Terminé"]);

    const result = await run("update_card", {
      card: "communiqué",
      title: "Écrire le communiqué de presse",
      due: "2026-10-15",
      add_labels: ["urgent"],
      append_notes: "Relire avec l'équipe.",
    });
    expect(result.ok).toBe(true);
    const edited = card("Écrire le communiqué de presse");
    expect(edited).toMatchObject({ due: "2026-10-15", labels: ["urgent"], notes: "Relire avec l'équipe." });

    await run("update_card", { card: "communiqué", due: "none", remove_labels: ["URGENT"], done: true });
    expect(card("Écrire le communiqué de presse")).toMatchObject({ due: null, labels: [], done: true });

    expect((await run("update_card", { card: "communiqué", due: "demain" })).ok).toBe(false);
    expect((await run("update_card", { card: "inexistante", title: "x" })).ok).toBe(false);
  });

  it("déplace, ajoute et supprime cartes et colonnes", async () => {
    await run("create_board", { name: "Sprint", columns: ["Idées", "Fait"] });
    expect(board().columns.map((c) => c.title)).toEqual(["Idées", "Fait"]);

    await run("add_card", { title: "Mode sombre", column: "Idées", labels: ["ui"], due: "2026-11-01" });
    expect(card("Mode sombre")).toMatchObject({ labels: ["ui"], due: "2026-11-01" });

    await run("move_card", { card: "mode sombre", column: "fait" });
    expect(board().columns.find((c) => c.id === card("Mode sombre").columnId)?.title).toBe("Fait");

    await run("add_column", { title: "Bloqué" });
    await run("rename_column", { column: "Bloqué", title: "En attente" });
    expect(board().columns.map((c) => c.title)).toEqual(["Idées", "Fait", "En attente"]);
    await run("delete_column", { column: "En attente" });
    expect(board().columns.length).toBe(2);

    await run("rename_board", { name: "Sprint 12" });
    expect(board().name).toBe("Sprint 12");

    const found = await run("find_cards", { label: "ui" });
    expect((found.data?.cards as unknown[]).length).toBe(1);

    const exported = await run("export_calendar", { path: "C:/tmp/sprint" });
    expect(exported).toMatchObject({ ok: true, data: { path: "C:/tmp/sprint", count: 1 } });

    await run("add_to_google_calendar", { card: "Mode sombre" });
    expect(openUrl.mock.calls[0]![0]).toContain("calendar.google.com");

    await run("delete_card", { card: "Mode sombre" });
    expect(board().cards).toEqual([]);
  });

  it("refuse de toucher au titre ou à la date d'une carte venue du roadmap.md", async () => {
    await run("create_board", { name: "Projet" });
    usePlannerStore.getState().updateBoard(board().id, (b) => ({
      ...b,
      cards: [{ id: "r1", columnId: b.columns[0]!.id, title: "Publier la v1", notes: "", due: null, labels: [], done: false, createdAt: 0, roadmapKey: "publier la v1" }],
    }));
    const result = await run("update_card", { card: "Publier", title: "Autre", due: "2026-12-01", labels: ["release"] });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("roadmap.md");
    expect(card("Publier la v1")).toMatchObject({ due: null, labels: ["release"] });
    expect((await run("delete_card", { card: "Publier" })).ok).toBe(false);
  });
});
