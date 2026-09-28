import { describe, expect, it, vi } from "vitest";
import { AudioLines } from "lucide-react";

const invokeCore = vi.fn(async (..._args: unknown[]) => 2);
vi.mock("@/core/ipc", () => ({ invokeCore: (...args: unknown[]) => invokeCore(...args) }));

import { defineActions, type ModuleAction } from "../actions";
import { catalogOf, loadCommands, searchCommands, syncCommandCatalogs } from "../commands";
import type { LoadedModule } from "../types";

const act = (name: string, description: string, params: ModuleAction["params"] = {}): ModuleAction => ({
  name,
  description,
  params,
  risk: "write",
  run: async () => ({ ok: true, message: name }),
});

const planner = defineActions([
  act("create_board", "Crée un tableau avec ses colonnes."),
  act("rename_board", "Renomme un tableau."),
  act("add_card", "Ajoute une carte à une colonne d'un tableau.", { board: { type: "string", required: true } }),
  act("update_card", "Modifie une carte : titre, description, échéance, priorité, étiquettes."),
  act("move_card", "Déplace une carte vers une autre colonne."),
  act("delete_card", "Supprime une carte."),
  act("add_subtask", "Ajoute une sous-tâche à une carte."),
]);

const module = (id: string, extra: Partial<LoadedModule> = {}): LoadedModule =>
  ({
    id,
    name: id === "planner" ? "Planner" : id,
    description: `Module ${id}`,
    version: "1.0.0",
    icon: AudioLines,
    category: "productivity",
    order: 1,
    enabledByDefault: true,
    page: (() => null) as unknown as LoadedModule["page"],
    path: `/m/${id}`,
    ...extra,
  }) as LoadedModule;

const modules = () => [
  module("planner", { actions: async () => ({ default: planner }) }),
  module("memory", {
    actions: async () => ({ default: defineActions([act("remember", "Retient une note."), act("forget", "Oublie une note.")]) }),
  }),
  // Sans actions déclarées : ouverture et palette seulement.
  module("usage", {
    commands: [
      { id: "usage.open", title: "Voir les crédits", run: "navigate" },
      { id: "usage.refresh-all", title: "Actualiser les crédits", run: () => undefined },
    ],
  }),
];

describe("base de commandes des modules", () => {
  it("donne à chaque module ses actions, l'ouverture et les commandes de la palette", async () => {
    const entries = await loadCommands(modules());
    expect(entries.map((e) => e.module.id)).toEqual(["planner", "memory", "usage"]);
    const usage = entries.find((e) => e.module.id === "usage")!;
    expect(usage.actions.map((a) => a.name)).toEqual(["open", "ui_refresh_all"]);
    expect(entries[0]!.actions.at(-1)!.name).toBe("open");

    const opened: string[] = [];
    const result = await usage.actions[0]!.run({}, { context: {} as never, openModule: (id) => opened.push(id) });
    expect(result.ok).toBe(true);
    expect(opened).toEqual(["usage"]);
  });

  it("n'expose que les modules actifs : un module désactivé disparaît de la base", async () => {
    const all = await loadCommands(modules());
    const withoutMemory = await loadCommands(modules().filter((m) => m.id !== "memory"));
    expect(all.some((e) => e.module.id === "memory")).toBe(true);
    expect(withoutMemory.some((e) => e.module.id === "memory")).toBe(false);
    expect(searchCommands(withoutMemory, { query: "retenir une note" }).some((m) => m.module.id === "memory")).toBe(false);
  });

  it("trouve la commande décrite en français ou en anglais", async () => {
    const entries = await loadCommands(modules());
    const first = (query: string, module?: string) => searchCommands(entries, { query, module })[0]?.action.name;
    expect(first("modifier une carte", "planner")).toBe("update_card");
    expect(first("edit card")).toBe("update_card");
    expect(first("changer l'échéance d'une tâche")).toBe("update_card");
    expect(first("déplacer la carte dans Terminé")).toBe("move_card");
    expect(first("renommer le tableau")).toBe("rename_board");
    expect(first("supprime cette tâche")).toBe("delete_card");
    expect(first("ajouter une sous-tâche")).toBe("add_subtask");
    expect(first("nouveau tableau")).toBe("create_board");
    expect(first("oublie ça", "memory")).toBe("forget");
    expect(searchCommands(entries, { query: "xylophone" })).toEqual([]);
    // Sans requête : toutes les commandes du module.
    expect(searchCommands(entries, { module: "planner" }).length).toBe(planner.length + 1);
  });

  it("écrit une base par module sur le disque, sans le code", async () => {
    const entries = await loadCommands(modules());
    const catalog = catalogOf(entries[0]!);
    expect(catalog.module).toMatchObject({ id: "planner", name: "Planner", version: "1.0.0" });
    expect(catalog.commands.find((c) => c.name === "add_card")).toMatchObject({ module: "planner", params: { board: { required: true } } });
    expect(JSON.stringify(catalog)).not.toContain("run");

    expect(await syncCommandCatalogs(entries)).toBe(2);
    const [command, args] = invokeCore.mock.calls[0]! as [string, { catalogs: Array<{ module: { id: string } }> }];
    expect(command).toBe("commands_sync");
    expect(args.catalogs.map((c) => c.module.id)).toEqual(["planner", "memory", "usage"]);
  });
});
