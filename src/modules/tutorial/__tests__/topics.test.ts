import { describe, expect, it } from "vitest";
import { Compass, Blocks, Sparkles } from "lucide-react";
import { allModules, manifestIssues, type LoadedModule } from "@/core/modules";
import { tutorialSchema } from "@/core/modules/manifest.schema";
import createModule from "../content/create-module";
import start from "../content/start";
import { buildGroups, nextTopic, normalize, resolveTopic, searchGroups, type Topic } from "../lib/topics";

const guides: { start: Topic; createModule: Topic } = {
  start: { id: "start", title: "Premiers pas", icon: Compass, tutorial: start, enabled: true },
  createModule: { id: "create-module", title: "Créer un module", icon: Blocks, tutorial: createModule, enabled: true },
};

const module = (id: string, over: Partial<LoadedModule> = {}): LoadedModule => ({
  id,
  name: id.toUpperCase(),
  description: "d",
  version: "0.1.0",
  icon: Sparkles,
  category: "ai",
  order: 0,
  enabledByDefault: true,
  page: {} as LoadedModule["page"],
  path: `/m/${id}`,
  tutorial: { summary: `Résumé de ${id}`, steps: [{ icon: Sparkles, title: "Étape", text: "Échéance du tableau." }] },
  ...over,
});

describe("liste des tutoriels", () => {
  const modules = [
    module("home", { required: true, tutorial: undefined }),
    module("settings", { required: true }),
    module("tutorial", { required: true, tutorial: undefined }),
    module("chat"),
    module("planner"),
    module("old"),
    module("perso", { tutorial: undefined }),
  ];
  const groups = buildGroups(
    modules,
    { selfId: "tutorial", removed: ["old"], isEnabled: (m) => m.id !== "planner" },
    guides,
  );

  it("range la visite et le socle, les modules, puis la création d'un module", () => {
    expect(groups.map((g) => [g.id, g.topics.map((t) => t.id)])).toEqual([
      ["start", ["start", "settings"]],
      ["modules", ["chat", "planner", "perso"]],
      ["more", ["create-module"]],
    ]);
    expect(groups[1]!.topics.find((t) => t.id === "planner")?.enabled).toBe(false);
  });

  it("cherche sans tenir compte des accents ni de la casse, dans les étapes aussi", () => {
    expect(normalize("Échéance")).toBe("echeance");
    const found = searchGroups(groups, "ECHEANCE tableau");
    expect(found.flatMap((g) => g.topics.map((t) => t.id))).toEqual(["settings", "chat", "planner"]);
    expect(searchGroups(groups, "   ")).toHaveLength(groups.length);
    expect(searchGroups(groups, "introuvable")).toEqual([]);
  });

  it("un module sans tutoriel mène à la visite, et « Terminer » propose le suivant", () => {
    expect(resolveTopic(groups, "chat", "start")).toBe("chat");
    expect(resolveTopic(groups, "home", "start")).toBe("start");
    expect(resolveTopic(groups, "perso", "start")).toBe("start");
    expect(nextTopic(groups, "planner")?.id).toBe("create-module");
    expect(nextTopic(groups, "create-module")).toBeUndefined();
  });
});

describe("tous les modules ont un tutoriel", () => {
  it("chaque module non requis déclare un tutoriel valide, et aucun n'est écarté", () => {
    const missing = allModules.filter((m) => !m.required && !m.tutorial).map((m) => m.id);
    expect(missing).toEqual([]);
    expect(manifestIssues.filter((i) => i.message.startsWith("tutoriel ignoré"))).toEqual([]);
  });

  it("la visite et la création d'un module respectent le format", () => {
    expect(tutorialSchema.safeParse(start).success).toBe(true);
    expect(tutorialSchema.safeParse(createModule).success).toBe(true);
  });

  it("aucun tiret cadratin dans les textes montrés", () => {
    const texts = [start, createModule, ...allModules.map((m) => m.tutorial)].flatMap((t) =>
      t ? [t.summary, ...(t.tips ?? []), ...t.steps.flatMap((s) => [s.title, s.text])] : [],
    );
    expect(texts.filter((text) => text.includes("—"))).toEqual([]);
  });
});
