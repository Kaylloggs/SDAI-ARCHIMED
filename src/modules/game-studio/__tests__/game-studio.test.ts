import { describe, expect, it } from "vitest";
import { layoutGraph, neighbourhood, NODE_W } from "../lib/graph-layout";
import { consumers, impact, systemId } from "../lib/graph";
import { availability } from "../lib/actions";
import { bytes, duration, shortVersion, splitCommand, topicLabel } from "../lib/labels";
import { adoptOps } from "../lib/map";
import { folderName, joinPath } from "../lib/naming";
import { neededBy, prune, withDependencies } from "../lib/selection";
import { blankTask, readyTasks, waitingOn } from "../lib/tasks";
import type { GameFoundSystem } from "@/core/ipc/bindings/GameFoundSystem";
import type { GameProjectState } from "@/core/ipc/bindings/GameProjectState";
import type { GameSystem } from "@/core/ipc/bindings/GameSystem";
import type { GameTask } from "@/core/ipc/bindings/GameTask";

function system(id: string, dependencies: string[] = []): GameSystem {
  return {
    id,
    name: id.replace(/_/g, " "),
    category: "gameplay",
    role: "",
    origin: "detected",
    dependencies,
    produces: [],
    files: [],
    assets: [],
    interfaces: [],
    data: [],
    constraints: [],
    tests: [],
    status: "planned",
    network: "local",
    risk: null,
    notes: null,
  };
}

function task(id: string, status: GameTask["status"], dependsOn: string[] = [], order = 0): GameTask {
  return { ...blankTask(order), id, title: id, status, dependsOn };
}

// input ← player ← combat ← loot ; input ← ui
const SYSTEMS = [system("input"), system("player", ["input"]), system("combat", ["player"]), system("loot", ["combat"]), system("ui", ["input"])];

describe("disposition du graphe", () => {
  it("place chaque système à droite de ses dépendances", () => {
    const layout = layoutGraph(SYSTEMS);
    const layer = Object.fromEntries(layout.nodes.map((n) => [n.id, n.layer]));
    expect(layer).toEqual({ input: 0, player: 1, ui: 1, combat: 2, loot: 3 });
    expect(layout.edges).toContainEqual({ from: "player", to: "combat" });
    expect(layout.width).toBeGreaterThanOrEqual(4 * NODE_W);
  });

  it("ignore les dépendances inconnues et survit à un cycle", () => {
    const layout = layoutGraph([system("a", ["b", "absent"]), system("b", ["a"])]);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges.every((e) => e.from !== "absent")).toBe(true);
  });

  it("allume le voisinage : dépendances et utilisateurs, directs et indirects", () => {
    expect([...neighbourhood(SYSTEMS, "player")].sort()).toEqual(["combat", "input", "loot", "player"]);
    expect(neighbourhood(SYSTEMS, "ui").has("combat")).toBe(false);
  });
});

describe("impact d'un système", () => {
  it("liste qui l'utilise directement, puis tout ce qui en dépend", () => {
    expect(consumers(SYSTEMS, "input").map((s) => s.id).sort()).toEqual(["player", "ui"]);
    expect(impact(SYSTEMS, "player").map((s) => s.id).sort()).toEqual(["combat", "loot"]);
    expect(impact(SYSTEMS, "loot")).toEqual([]);
  });

  it("tire un identifiant snake_case d'un nom", () => {
    expect(systemId("Pêche au harpon")).toBe("peche_au_harpon");
    expect(systemId("  Météo dynamique ! ")).toBe("meteo_dynamique");
    expect(systemId("3D voxels")).toBe("system_3d_voxels");
  });
});

describe("sélection des systèmes dans l'assistant", () => {
  const byId = new Map(SYSTEMS.map((s) => [s.id, s]));

  it("n'autorise pas à retirer un système dont un autre a besoin", () => {
    const kept = new Set(SYSTEMS.map((s) => s.id));
    expect(neededBy("player", kept, byId).map((s) => s.id)).toEqual(["combat"]);
    kept.delete("combat");
    expect(neededBy("player", kept, byId)).toEqual([]);
  });

  it("ajoute un système avec ses dépendances, dépendances d'abord", () => {
    expect(withDependencies("loot", byId)).toEqual(["input", "player", "combat", "loot"]);
    expect(withDependencies("inconnu", byId)).toEqual([]);
  });

  it("retire les liens vers les systèmes écartés", () => {
    const kept = prune(SYSTEMS, new Set(["combat", "loot"]));
    expect(kept.map((s) => s.id)).toEqual(["combat", "loot"]);
    expect(kept.find((s) => s.id === "combat")?.dependencies).toEqual([]);
  });
});

describe("tâches", () => {
  const tasks = [task("start", "done", [], 0), task("move", "todo", ["start"], 2), task("jump", "todo", ["move"], 3), task("menu", "todo", [], 1)];

  it("n'est prête que si ses tâches préalables sont terminées", () => {
    expect(readyTasks(tasks).map((t) => t.id)).toEqual(["menu", "move"]);
    expect(waitingOn(tasks, "move").map((t) => t.id)).toEqual(["jump"]);
  });

  it("crée une tâche vide à faire", () => {
    const blank = blankTask(4);
    expect(blank).toMatchObject({ id: "", status: "todo", order: 4, dependsOn: [] });
  });
});

describe("dossier du projet", () => {
  it("suit les règles du backend", () => {
    expect(folderName("Marée basse !")).toBe("Maree-basse");
    expect(folderName("   ")).toBe("Nouveau-jeu");
    expect(folderName("cœur de pierre")).toBe("Coeur-de-pierre");
  });

  it("garde le séparateur du dossier parent", () => {
    expect(joinPath("C:\\Users\\Moi\\Documents\\Game Studio\\", "Maree-basse")).toBe("C:\\Users\\Moi\\Documents\\Game Studio\\Maree-basse");
    expect(joinPath("/home/moi/jeux", "Maree-basse")).toBe("/home/moi/jeux/Maree-basse");
  });
});

describe("version d'un moteur", () => {
  it("garde la partie lisible", () => {
    expect(shortVersion("4.4.1.stable.official.49a5bc7b6")).toBe("4.4.1");
    expect(shortVersion("2022.3.10f1")).toBe("2022.3.10f1");
    expect(shortVersion("5.4.4-35576357+++UE5+Release-5.4")).toBe("5.4.4");
    expect(shortVersion(null)).toBe("");
    expect(shortVersion("inconnue")).toBe("inconnue");
  });
});

describe("sujet d'une hypothèse", () => {
  it("se lit en français", () => {
    expect(topicLabel("targets")).toBe("Plateformes");
    expect(topicLabel("camera")).toBe("Caméra");
    expect(topicLabel("save_slots")).toBe("Save slots");
  });
});

describe("actions du moteur proposées", () => {
  const base = {
    project: { engine: "godot" },
    install: { engine: "godot", version: "4.4.1", editor: "godot", console: null, root: "/", source: "test" },
    capabilities: [
      { id: "check", label: "Vérifier", via: "cli", requires: "Godot 4 installé", available: true, detail: null },
      { id: "build", label: "Exporter un build", via: "cli", requires: "Modèles d'export", available: false, detail: null },
    ],
  } as unknown as GameProjectState;

  it("disent pourquoi elles sont indisponibles", () => {
    expect(availability(base, "check")).toEqual({ available: true, reason: null });
    expect(availability(base, "setup").available).toBe(true);
    expect(availability(base, "build")).toEqual({ available: false, reason: "Il faut : Modèles d'export." });
    expect(availability({ ...base, install: null }, "check").reason).toMatch(/pas installé/);
    expect(availability({ ...base, project: { ...base.project, engine: null } }, "run").reason).toMatch(/moteur/);
  });
});

describe("système repéré dans le code", () => {
  const found = { id: "inventory", name: "Inventaire", category: "items", inGraph: false, files: ["scripts/inventory.gd"], fileCount: 1, evidence: ["inventory"] } as GameFoundSystem;

  it("entre dans le graphe avec ses fichiers, en cours", () => {
    expect(adoptOps(found).map((o) => o.op)).toEqual(["addCatalogSystem", "linkFiles", "setSystemStatus"]);
    expect(adoptOps({ ...found, inGraph: true }).map((o) => o.op)).toEqual(["linkFiles"]);
  });
});

describe("mesures lisibles", () => {
  it("formate tailles et durées", () => {
    expect(bytes(512)).toBe("512 o");
    expect(bytes(1536)).toBe("1,5 Ko");
    expect(bytes(25 * 1024 * 1024)).toBe("25 Mo");
    expect(duration(4200)).toBe("4 s");
    expect(duration(65_000)).toBe("1 min 05 s");
    expect(duration(120_000)).toBe("2 min");
  });
});

describe("ligne de commande d'un serveur MCP", () => {
  it("garde les chemins entre guillemets", () => {
    expect(splitCommand('node "C:\\Mes outils\\serveur.js" --port 3000')).toEqual(["node", "C:\\Mes outils\\serveur.js", "--port", "3000"]);
    expect(splitCommand("  npx -y godot-mcp  ")).toEqual(["npx", "-y", "godot-mcp"]);
    expect(splitCommand("uvx 'blender mcp' ''")).toEqual(["uvx", "blender mcp", ""]);
  });
});
