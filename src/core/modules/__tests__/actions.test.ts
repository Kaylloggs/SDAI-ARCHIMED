import { describe, expect, it } from "vitest";
import { AudioLines } from "lucide-react";
import { checkArgs, defineActions, describeModule, findByName, loadActions, type ModuleAction } from "../actions";
import type { LoadedModule } from "../types";

const action: ModuleAction = {
  name: "add_tasks",
  description: "Ajoute des tâches.",
  params: {
    board: { type: "string", required: true },
    tasks: { type: "array", required: true },
    due: { type: "string" },
    mode: { type: "string", enum: ["fast", "slow"] },
  },
  risk: "write",
  run: async () => ({ ok: true, message: "ok" }),
};

const module = (id: string, actions?: LoadedModule["actions"]): LoadedModule =>
  ({
    id,
    name: id,
    description: `Module ${id}`,
    version: "0.1.0",
    icon: AudioLines,
    category: "ai",
    order: 1,
    enabledByDefault: true,
    page: (() => null) as unknown as LoadedModule["page"],
    path: `/m/${id}`,
    capabilities: ["speak"],
    actions,
  }) as LoadedModule;

describe("actions des modules", () => {
  it("vérifie les arguments en clair", () => {
    expect(checkArgs(action, { board: "Roadmap", tasks: ["a"] })).toBeNull();
    expect(checkArgs(action, { tasks: ["a"] })).toBe("Paramètre manquant : board.");
    expect(checkArgs(action, { board: "R", tasks: "a" })).toBe("Paramètre tasks : array attendu.");
    expect(checkArgs(action, { board: "R", tasks: [], mode: "turbo" })).toBe("Paramètre mode : fast, slow attendu.");
    expect(checkArgs(action, { board: "R", tasks: [], due: "" })).toBeNull();
  });

  it("retrouve un élément nommé à la voix", () => {
    const boards = [
      { id: "b1", name: "Roadmap produit" },
      { id: "b2", name: "Courses" },
      { id: "b3", name: "Roadmap équipe" },
    ];
    const name = (b: { name: string }) => b.name;
    const id = (b: { id: string }) => b.id;
    expect(findByName(boards, "b2", name, id)?.name).toBe("Courses");
    expect(findByName(boards, "courses", name, id)?.id).toBe("b2");
    expect(findByName(boards, "roadmap EQUIPE", name, id)?.id).toBe("b3");
    expect(findByName(boards, "Roadmap", name, id)).toBeNull();
    expect(findByName(boards, "produit", name, id)?.id).toBe("b1");
    expect(findByName(boards, "", name, id)).toBeNull();
  });

  it("charge les actions sans être bloqué par un module défaillant", async () => {
    const modules = [
      module("ok", async () => ({ default: defineActions([action]) })),
      module("broken", async () => {
        throw new Error("boom");
      }),
      module("none"),
    ];
    const original = console.error;
    console.error = () => undefined;
    const loaded = await loadActions(modules);
    console.error = original;
    expect(loaded.map((e) => e.module.id)).toEqual(["ok"]);
    const described = describeModule(loaded[0]!);
    expect(described).toMatchObject({ id: "ok", capabilities: ["speak"], actions: [{ name: "add_tasks", risk: "write" }] });
    expect("run" in described.actions[0]!).toBe(false);
  });
});
