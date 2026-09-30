import { defineActions, findByName, type ActionResult } from "@/core/modules";
import type { GameAction } from "@/core/ipc/bindings/GameAction";
import type { GameAgentRole } from "@/core/ipc/bindings/GameAgentRole";
import type { GameBuildRecord } from "@/core/ipc/bindings/GameBuildRecord";
import type { GameAssumptionStatus } from "@/core/ipc/bindings/GameAssumptionStatus";
import type { GameAutonomy } from "@/core/ipc/bindings/GameAutonomy";
import type { GameDimension } from "@/core/ipc/bindings/GameDimension";
import type { GameEngine } from "@/core/ipc/bindings/GameEngine";
import type { GameGraphOp } from "@/core/ipc/bindings/GameGraphOp";
import type { GameLogCategory } from "@/core/ipc/bindings/GameLogCategory";
import type { GameMode } from "@/core/ipc/bindings/GameMode";
import type { GamePhaseStatus } from "@/core/ipc/bindings/GamePhaseStatus";
import type { GamePlatform } from "@/core/ipc/bindings/GamePlatform";
import type { GameProjectPatch } from "@/core/ipc/bindings/GameProjectPatch";
import type { GameProjectState } from "@/core/ipc/bindings/GameProjectState";
import type { GameStyleGuide } from "@/core/ipc/bindings/GameStyleGuide";
import type { GameSystemCategory } from "@/core/ipc/bindings/GameSystemCategory";
import type { GameSystemStatus } from "@/core/ipc/bindings/GameSystemStatus";
import type { GameTask } from "@/core/ipc/bindings/GameTask";
import type { GameTaskStatus } from "@/core/ipc/bindings/GameTaskStatus";
import { errorText, gameStudioApi } from "./api";
import { consumers, impact, systemId } from "./lib/graph";
import { adoptOps } from "./lib/map";
import { ACTION, CATEGORY_LABEL, ENGINE_LABEL, LOG_CATEGORY, PLATFORMS, ROLE, RUN_STATUS, SYSTEM_STATUS, TASK_STATUS } from "./lib/labels";
import { blankTask, readyTasks } from "./lib/tasks";
import { useGameStudioStore } from "./store";

const SELF = "game-studio";
const project_param = { type: "string" as const, description: "Nom, identifiant ou dossier du jeu (sinon le jeu ouvert)." };

/** Jeu désigné, ou celui ouvert dans Game Studio. */
async function target(ref: unknown): Promise<{ id: string } | ActionResult> {
  const store = useGameStudioStore.getState();
  if (!store.loaded) await store.refresh();
  const projects = useGameStudioStore.getState().projects;
  const wanted = typeof ref === "string" ? ref.trim() : "";
  if (!wanted) {
    const open = useGameStudioStore.getState().openId;
    if (open) return { id: open };
    if (projects.length === 1) return { id: projects[0]!.id };
    return { ok: false, message: projects.length ? "Précise le jeu (list_games)." : "Aucun jeu dans Game Studio : crée-en un avec create_game." };
  }
  const found = findByName(projects, wanted, (p) => p.name, (p) => p.id) ?? projects.find((p) => p.root === wanted);
  return found ? { id: found.id } : { ok: false, message: `Aucun jeu ne correspond à « ${wanted} » (ou plusieurs). Appelle list_games.` };
}

const isError = (value: { id: string } | ActionResult): value is ActionResult => "ok" in value;

async function state(ref: unknown): Promise<GameProjectState | ActionResult> {
  const t = await target(ref);
  if (isError(t)) return t;
  try {
    return await gameStudioApi.state(t.id);
  } catch (e) {
    return { ok: false, message: errorText(e) };
  }
}

const isState = (value: GameProjectState | ActionResult): value is GameProjectState => "project" in value;

/** Applique une modification du graphe et rafraîchit la page si elle est ouverte. */
async function graphOp(ref: unknown, op: GameGraphOp, done: string): Promise<ActionResult> {
  const t = await target(ref);
  if (isError(t)) return t;
  try {
    await gameStudioApi.graphOp(t.id, op);
    return { ok: true, message: done, open: { module: SELF, params: { projectId: t.id } } };
  } catch (e) {
    return { ok: false, message: errorText(e) };
  }
}

async function patch(ref: unknown, value: GameProjectPatch, done: string): Promise<ActionResult> {
  const t = await target(ref);
  if (isError(t)) return t;
  try {
    await gameStudioApi.update(t.id, value);
    return { ok: true, message: done };
  } catch (e) {
    return { ok: false, message: errorText(e) };
  }
}

function system(s: GameProjectState, ref: unknown) {
  return findByName(s.graph.systems, String(ref ?? ""), (x) => x.name, (x) => x.id);
}

function task(s: GameProjectState, ref: unknown) {
  return findByName(s.graph.tasks, String(ref ?? ""), (x) => x.title, (x) => x.id);
}

const list = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []).map((v) => String(v).trim()).filter(Boolean);

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null => (allowed.includes(value as T) ? (value as T) : null);

const ENGINE_IDS = ["godot", "unity", "unreal"] as const;
const MODES = ["prototype", "standard", "advanced", "production", "existing"] as const;
const AUTONOMIES = ["manual", "assisted", "autonomous"] as const;
const DIMENSIONS = ["2d", "2.5d", "3d"] as const;
const SYSTEM_STATUSES = Object.keys(SYSTEM_STATUS) as GameSystemStatus[];
const TASK_STATUSES = Object.keys(TASK_STATUS) as GameTaskStatus[];
const ROLES = Object.keys(ROLE) as GameAgentRole[];
const CATEGORIES = Object.keys(CATEGORY_LABEL) as GameSystemCategory[];
const LOG_CATEGORIES = Object.keys(LOG_CATEGORY) as GameLogCategory[];

/** Exécution résumée pour un agent : verdict, erreurs expliquées, build produit. */
function runData(record: GameBuildRecord) {
  return {
    id: record.id,
    action: record.action,
    status: record.status,
    summary: record.summary,
    output: record.output,
    durationMs: record.durationMs,
    diagnostics: record.diagnostics.slice(0, 20).map((d) => ({
      severity: d.severity,
      message: d.message,
      file: d.file,
      line: d.line,
      source: d.source,
      code: d.code,
      likelyCause: d.likelyCause,
      suggestion: d.suggestion,
      systems: d.systems,
    })),
  };
}

function runResult(record: GameBuildRecord, projectId: string): ActionResult {
  if (!record.id) return { ok: false, message: record.summary };
  return {
    ok: true,
    message: `${RUN_STATUS[record.status].label} : ${record.summary}`,
    data: { run: runData(record) },
    open: { module: SELF, params: { projectId, section: "build" } },
  };
}

/**
 * Lance une action du moteur. `wait` : attendre la fin (vérification, tests) ; sinon la commande
 * rend la main dès le lancement (build long, partie) et engine_action_result donne le résultat.
 */
async function runEngine(ref: unknown, action: GameAction, wait: boolean, platform: GamePlatform | null = null, development = false): Promise<ActionResult> {
  const t = await target(ref);
  if (isError(t)) return t;
  const pending = useGameStudioStore.getState().runAction(t.id, action, platform, development);
  if (wait) return runResult(await pending, t.id);
  // Un refus (moteur absent, préréglage manquant) arrive tout de suite : on l'attend un instant.
  const early = await Promise.race([pending, new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))]);
  if (early) return runResult(early, t.id);
  return {
    ok: true,
    message: `${ACTION[action].label} lancée. Résultat avec engine_action_result, arrêt avec stop_engine_action.`,
    open: { module: SELF, params: { projectId: t.id, section: "build" } },
  };
}

/**
 * Commandes de Game Studio : tout ce que la personne fait dans le module (projets, conception,
 * systèmes, tâches, historique, outils), un agent ou la voix peut le faire.
 */
export default defineActions([
  // ── Projets ─────────────────────────────────────────────────────────────────────────
  {
    name: "list_games",
    description: "Liste les jeux de Game Studio : nom, moteur, systèmes, tâches ouvertes, dernier build.",
    risk: "read",
    run: async () => {
      await useGameStudioStore.getState().refresh();
      const projects = useGameStudioStore.getState().projects;
      return {
        ok: true,
        message: projects.length ? `${projects.length} jeu(x) : ${projects.map((p) => p.name).join(", ")}.` : "Aucun jeu dans Game Studio.",
        data: { games: projects.map((p) => ({ id: p.id, name: p.name, engine: p.engine, root: p.root, systems: p.systems, openTasks: p.openTasks, lastBuild: p.lastBuild })) },
      };
    },
  },
  {
    name: "open_game",
    description: "Ouvre un jeu dans Game Studio, sur une section (dashboard, design, systems, tasks, history, journal, tools, settings).",
    params: { project: project_param, section: { type: "string", enum: ["dashboard", "design", "systems", "tasks", "history", "journal", "tools", "settings"] } },
    risk: "read",
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      return { ok: true, message: "Jeu ouvert.", open: { module: SELF, params: { projectId: t.id, section: args["section"] ?? "dashboard" } } };
    },
  },
  {
    name: "get_game",
    description: "Décrit un jeu : idée, moteur, monde, réseau, systèmes par état, tâches prêtes, hypothèses à confirmer, capacités réelles du moteur.",
    params: { project: project_param },
    risk: "read",
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const { project, graph } = s;
      const ready = readyTasks(graph.tasks);
      return {
        ok: true,
        message: `${project.name} : ${project.engine ? ENGINE_LABEL[project.engine] : "sans moteur"}, ${graph.systems.length} systèmes, ${ready.length} tâche(s) prête(s).`,
        data: {
          id: project.id,
          root: project.root,
          idea: project.idea,
          engine: project.engine,
          engineVersion: project.engineVersion,
          dimension: project.dimension,
          mode: project.mode,
          autonomy: project.autonomy,
          targets: project.targets,
          world: graph.world,
          network: graph.network,
          systems: graph.systems.map((x) => ({ id: x.id, name: x.name, status: x.status, dependencies: x.dependencies })),
          readyTasks: ready.map((t) => ({ id: t.id, title: t.title, role: t.role })),
          assumptions: graph.assumptions.filter((a) => a.status === "editable").map((a) => ({ id: a.id, topic: a.topic, value: a.value })),
          capabilities: s.capabilities.map((c) => ({ id: c.id, label: c.label, via: c.via, available: c.available, requires: c.requires })),
          style: project.style,
        },
      };
    },
  },
  {
    name: "analyze_game_idea",
    description: "Analyse une idée de jeu : systèmes nécessaires, dépendances, monde, réseau, hypothèses, choix du moteur, risques, sans rien créer.",
    params: { idea: { type: "string", required: true, description: "L'idée, en langage naturel." } },
    risk: "read",
    run: async (args) => {
      try {
        const a = await gameStudioApi.analyze(String(args["idea"]));
        return {
          ok: true,
          message: `${a.systems.length} systèmes trouvés ; moteur conseillé : ${a.engines[0] ? ENGINE_LABEL[a.engines[0].engine] : "aucun"}.`,
          data: {
            genres: a.genres,
            dimension: a.dimension,
            perspective: a.perspective,
            systems: a.systems.map((d) => ({ id: d.system.id, name: d.system.name, evidence: d.evidence, requiredBy: d.requiredBy })),
            world: a.world,
            network: a.network,
            assumptions: a.assumptions,
            decisions: a.decisions,
            engines: a.engines,
            risks: a.risks,
            questions: a.questions,
          },
        };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },
  {
    name: "create_game",
    description: "Crée un nouveau jeu vidéo à partir d'une idée : analyse, choix du moteur (sinon le conseillé), projet écrit sur le disque avec son graphe et son plan.",
    params: {
      idea: { type: "string", required: true },
      name: { type: "string", description: "Nom du jeu (sinon celui tiré de l'idée)." },
      engine: { type: "string", enum: [...ENGINE_IDS, "none"], description: "Moteur ; « none » pour choisir plus tard." },
      folder: { type: "string", description: "Dossier parent (sinon Documents\\Game Studio)." },
      mode: { type: "string", enum: ["prototype", "standard", "advanced", "production"] },
      autonomy: { type: "string", enum: [...AUTONOMIES] },
      cpp: { type: "boolean", description: "Unreal : module C++." },
    },
    risk: "write",
    run: async (args) => {
      try {
        const a = await gameStudioApi.analyze(String(args["idea"]));
        const env = useGameStudioStore.getState().environment ?? (await gameStudioApi.environment(false));
        const engineArg = args["engine"];
        const engine: GameEngine | null = engineArg === "none" ? null : oneOf(engineArg, ENGINE_IDS) ?? a.engines[0]?.engine ?? null;
        const parent = typeof args["folder"] === "string" && args["folder"] ? String(args["folder"]) : await gameStudioApi.defaultParent();
        const outcome = await gameStudioApi.create({
          name: typeof args["name"] === "string" && args["name"].trim() ? args["name"].trim() : a.name,
          parent,
          engine,
          engineEditor: null,
          mode: oneOf(args["mode"], MODES) ?? (a.mode === "existing" ? "standard" : a.mode),
          autonomy: oneOf(args["autonomy"], AUTONOMIES) ?? "assisted",
          idea: a.idea,
          genres: a.genres,
          dimension: a.dimension,
          targets: a.targets,
          systems: a.systems.map((d) => d.system),
          assumptions: a.assumptions,
          decisions: a.decisions,
          world: a.world,
          network: a.network,
          roadmap: a.roadmap,
          cpp: args["cpp"] === true,
          git: env.tools.some((t) => t.id === "git" && t.state === "ready"),
        });
        await useGameStudioStore.getState().refresh();
        return {
          ok: true,
          message: `Jeu « ${outcome.project.name} » créé avec ${a.systems.length} systèmes.`,
          data: { id: outcome.project.id, root: outcome.project.root, notes: outcome.notes },
          open: { module: SELF, params: { projectId: outcome.project.id } },
        };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },
  {
    name: "import_game",
    description: "Ajoute à Game Studio un projet existant (dossier Godot, Unity ou Unreal) sans rien modifier dans ses fichiers de jeu.",
    params: { folder: { type: "string", required: true } },
    risk: "write",
    run: async (args) => {
      try {
        const project = await gameStudioApi.importProject(String(args["folder"]));
        await useGameStudioStore.getState().refresh();
        return { ok: true, message: `Projet « ${project.name} » ajouté.`, data: { id: project.id }, open: { module: SELF, params: { projectId: project.id } } };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },
  {
    name: "remove_game_from_list",
    description: "Retire un jeu de la liste de Game Studio ; ses fichiers restent sur le disque.",
    params: { project: { ...project_param, required: true } },
    risk: "write",
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      try {
        await gameStudioApi.forget(t.id);
        const store = useGameStudioStore.getState();
        if (store.openId === t.id) await store.open(null);
        await store.refresh();
        return { ok: true, message: "Jeu retiré de la liste ; ses fichiers sont intacts." };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },
  {
    name: "set_game_settings",
    description: "Change les réglages d'un jeu : nom, ambition (mode), liberté des agents (autonomy), dimension, plateformes, idée, version.",
    params: {
      project: project_param,
      name: { type: "string" },
      mode: { type: "string", enum: [...MODES] },
      autonomy: { type: "string", enum: [...AUTONOMIES] },
      dimension: { type: "string", enum: [...DIMENSIONS] },
      targets: { type: "array", description: `Plateformes : ${PLATFORMS.join(", ")}.` },
      idea: { type: "string" },
      version: { type: "string" },
    },
    risk: "write",
    run: async (args) => {
      const value: GameProjectPatch = {
        name: typeof args["name"] === "string" ? args["name"] : null,
        engine: null,
        engineVersion: null,
        mode: oneOf<GameMode>(args["mode"], MODES),
        autonomy: oneOf<GameAutonomy>(args["autonomy"], AUTONOMIES),
        idea: typeof args["idea"] === "string" ? args["idea"] : null,
        genres: null,
        dimension: oneOf<GameDimension>(args["dimension"], DIMENSIONS),
        targets: args["targets"] ? (list(args["targets"]).filter((t) => (PLATFORMS as string[]).includes(t)) as GamePlatform[]) : null,
        budget: null,
        style: null,
        version: typeof args["version"] === "string" ? args["version"] : null,
      };
      return patch(args["project"], value, "Réglages du jeu enregistrés.");
    },
  },
  {
    name: "set_performance_budget",
    description: "Fixe le budget de performance d'un jeu : images par seconde, résolution, mémoire, temps processeur et carte graphique, bande passante.",
    params: {
      project: project_param,
      targetFps: { type: "number" },
      resolution: { type: "string" },
      memoryMb: { type: "number" },
      cpuMs: { type: "number" },
      gpuMs: { type: "number" },
      networkKbps: { type: "number" },
    },
    risk: "write",
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const num = (k: string) => (typeof args[k] === "number" ? (args[k] as number) : undefined);
      const b = s.project.budget;
      const budget = {
        targetFps: num("targetFps") ?? b.targetFps,
        resolution: typeof args["resolution"] === "string" ? args["resolution"] : b.resolution,
        memoryMb: num("memoryMb") ?? b.memoryMb,
        cpuMs: num("cpuMs") ?? b.cpuMs,
        gpuMs: num("gpuMs") ?? b.gpuMs,
        networkKbps: num("networkKbps") ?? b.networkKbps,
      };
      return patch(s.project.id, { name: null, engine: null, engineVersion: null, mode: null, autonomy: null, idea: null, genres: null, dimension: null, targets: null, budget, style: null, version: null }, "Budget de performance enregistré.");
    },
  },
  {
    name: "set_style_guide",
    description: "Complète le guide de style du jeu (style visuel, palette, matériaux, typographie, interface, personnages, décors, effets, son, références).",
    params: {
      project: project_param,
      visualStyle: { type: "string" },
      palette: { type: "array" },
      materials: { type: "string" },
      typography: { type: "string" },
      uiStyle: { type: "string" },
      characterStyle: { type: "string" },
      environmentStyle: { type: "string" },
      vfxStyle: { type: "string" },
      audioStyle: { type: "string" },
      references: { type: "array" },
    },
    risk: "write",
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const style: GameStyleGuide = { ...s.project.style };
      for (const key of ["visualStyle", "materials", "typography", "uiStyle", "characterStyle", "environmentStyle", "vfxStyle", "audioStyle"] as const) {
        if (typeof args[key] === "string") style[key] = args[key] as string;
      }
      if (args["palette"]) style.palette = list(args["palette"]);
      if (args["references"]) style.references = list(args["references"]);
      return patch(s.project.id, { name: null, engine: null, engineVersion: null, mode: null, autonomy: null, idea: null, genres: null, dimension: null, targets: null, budget: null, style, version: null }, "Guide de style mis à jour.");
    },
  },
  {
    name: "set_game_engine",
    description: "Choisit le moteur d'un jeu créé sans moteur (godot, unity, unreal) et écrit ses fichiers dans le projet.",
    params: { project: project_param, engine: { type: "string", enum: [...ENGINE_IDS], required: true }, cpp: { type: "boolean" } },
    risk: "write",
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      const engine = oneOf(args["engine"], ENGINE_IDS);
      if (!engine) return { ok: false, message: "Moteur attendu : godot, unity ou unreal." };
      try {
        const notes = await gameStudioApi.setEngine(t.id, engine, null, args["cpp"] === true);
        return { ok: true, message: `Projet ${ENGINE_LABEL[engine]} écrit.`, data: { notes } };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },

  // ── Systèmes ────────────────────────────────────────────────────────────────────────
  {
    name: "list_systems",
    description: "Liste les systèmes d'un jeu avec leur état, leurs dépendances et ce qui les utilise.",
    params: { project: project_param },
    risk: "read",
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      return {
        ok: true,
        message: `${s.graph.systems.length} systèmes.`,
        data: { systems: s.graph.systems.map((x) => ({ id: x.id, name: x.name, category: x.category, status: x.status, network: x.network, dependencies: x.dependencies, usedBy: consumers(s.graph.systems, x.id).map((c) => c.id), files: x.files })) },
      };
    },
  },
  {
    name: "describe_system",
    description: "Fiche d'un système du jeu (combat, météo, inventaire…), pour l'expliquer : rôle, dépendances, utilisateurs, événements, données, fichiers, vérifications et systèmes à retester s'il change.",
    params: { project: project_param, system: { type: "string", required: true } },
    risk: "read",
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const x = system(s, args["system"]);
      if (!x) return { ok: false, message: `Système introuvable : « ${String(args["system"])} ». Appelle list_systems.` };
      return {
        ok: true,
        message: `${x.name} : ${x.role}`,
        data: { ...x, usedBy: consumers(s.graph.systems, x.id).map((c) => c.id), retestIfChanged: impact(s.graph.systems, x.id).map((c) => c.id) },
        open: { module: SELF, params: { projectId: s.project.id, section: "systems" } },
      };
    },
  },
  {
    name: "add_system",
    description: "Ajoute un système au jeu (météo, combat, pêche, inventaire…) : depuis le catalogue (catalog_id, avec ses dépendances) ou propre au jeu (name, role, category, dependencies).",
    params: {
      project: project_param,
      catalog_id: { type: "string", description: "Identifiant du catalogue (ex. weather, fishing, vehicles)." },
      name: { type: "string" },
      role: { type: "string" },
      category: { type: "string", enum: CATEGORIES },
      dependencies: { type: "array" },
    },
    risk: "write",
    run: async (args) => {
      if (typeof args["catalog_id"] === "string" && args["catalog_id"]) {
        return graphOp(args["project"], { op: "addCatalogSystem", id: String(args["catalog_id"]) }, "Système ajouté avec ses dépendances.");
      }
      const name = typeof args["name"] === "string" ? args["name"].trim() : "";
      if (!name) return { ok: false, message: "Donne catalog_id, ou name (et role) pour un système propre au jeu." };
      return graphOp(
        args["project"],
        {
          op: "upsertSystem",
          system: {
            id: systemId(name),
            name,
            category: oneOf(args["category"], CATEGORIES) ?? "gameplay",
            role: typeof args["role"] === "string" ? args["role"] : name,
            origin: "custom",
            dependencies: list(args["dependencies"]),
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
          },
        },
        `Système « ${name} » ajouté.`,
      );
    },
  },
  {
    name: "set_system_status",
    description: "Change l'état d'un système : planned, inProgress, implemented, validated, broken, deprecated.",
    params: { project: project_param, system: { type: "string", required: true }, status: { type: "string", enum: SYSTEM_STATUSES, required: true } },
    risk: "write",
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const x = system(s, args["system"]);
      if (!x) return { ok: false, message: "Système introuvable (list_systems)." };
      return graphOp(s.project.id, { op: "setSystemStatus", id: x.id, status: args["status"] as GameSystemStatus }, `${x.name} : ${SYSTEM_STATUS[args["status"] as GameSystemStatus].label.toLowerCase()}.`);
    },
  },
  {
    name: "link_system_files",
    description: "Rattache des fichiers (ou motifs) du projet à un système, pour relier le code au graphe.",
    params: { project: project_param, system: { type: "string", required: true }, files: { type: "array", required: true } },
    risk: "write",
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const x = system(s, args["system"]);
      if (!x) return { ok: false, message: "Système introuvable (list_systems)." };
      return graphOp(s.project.id, { op: "linkFiles", id: x.id, files: list(args["files"]) }, `Fichiers rattachés à ${x.name}.`);
    },
  },
  {
    name: "remove_system",
    description: "Retire un système du graphe (s'il n'est utilisé par aucun autre) ; les fichiers du jeu ne sont pas touchés.",
    params: { project: project_param, system: { type: "string", required: true } },
    risk: "destructive",
    confirm: (args) => `Retirer le système « ${String(args["system"])} » du graphe ?`,
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const x = system(s, args["system"]);
      if (!x) return { ok: false, message: "Système introuvable (list_systems)." };
      return graphOp(s.project.id, { op: "removeSystem", id: x.id }, `${x.name} retiré du graphe.`);
    },
  },

  // ── Conception ──────────────────────────────────────────────────────────────────────
  {
    name: "add_decision",
    description: "Note une décision d'architecture : sujet, décision, raison, alternatives, contrepartie.",
    params: { project: project_param, title: { type: "string", required: true }, decision: { type: "string", required: true }, reason: { type: "string", required: true }, alternatives: { type: "array" }, tradeoffs: { type: "string" } },
    risk: "write",
    run: async (args) =>
      graphOp(
        args["project"],
        { op: "addDecision", title: String(args["title"]), decision: String(args["decision"]), reason: String(args["reason"]), alternatives: list(args["alternatives"]), tradeoffs: typeof args["tradeoffs"] === "string" ? args["tradeoffs"] : null },
        "Décision notée.",
      ),
  },
  {
    name: "remove_decision",
    description: "Retire une décision d'architecture notée par erreur.",
    params: { project: project_param, decision: { type: "string", required: true, description: "Titre ou identifiant." } },
    risk: "destructive",
    confirm: (args) => `Retirer la décision « ${String(args["decision"])} » ?`,
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const d = findByName(s.graph.decisions, String(args["decision"]), (x) => x.title, (x) => x.id);
      if (!d) return { ok: false, message: "Décision introuvable." };
      return graphOp(s.project.id, { op: "removeDecision", id: d.id }, "Décision retirée.");
    },
  },
  {
    name: "add_assumption",
    description: "Note une hypothèse prise faute d'information (sujet, valeur, raison), modifiable ensuite.",
    params: { project: project_param, topic: { type: "string", required: true }, value: { type: "string", required: true }, reason: { type: "string", required: true } },
    risk: "write",
    run: async (args) => graphOp(args["project"], { op: "addAssumption", topic: String(args["topic"]), value: String(args["value"]), reason: String(args["reason"]) }, "Hypothèse notée."),
  },
  {
    name: "set_assumption",
    description: "Change la valeur d'une hypothèse (l'ancienne reste dans l'historique) ou la confirme.",
    params: { project: project_param, assumption: { type: "string", required: true, description: "Sujet ou identifiant (camera, players…)." }, value: { type: "string" }, confirm: { type: "boolean" } },
    risk: "write",
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const active = s.graph.assumptions.filter((a) => a.status !== "replaced");
      const a = findByName(active, String(args["assumption"]), (x) => x.topic, (x) => x.id);
      if (!a) return { ok: false, message: "Hypothèse introuvable (get_game les liste)." };
      const status: GameAssumptionStatus = args["confirm"] === false ? "editable" : "confirmed";
      return graphOp(s.project.id, { op: "setAssumption", id: a.id, value: typeof args["value"] === "string" ? args["value"] : null, status }, "Hypothèse mise à jour.");
    },
  },
  {
    name: "set_phase_status",
    description: "Change l'état d'une phase de la feuille de route : planned, active, done.",
    params: { project: project_param, phase: { type: "string", required: true }, status: { type: "string", enum: ["planned", "active", "done"], required: true } },
    risk: "write",
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const p = findByName(s.graph.roadmap, String(args["phase"]), (x) => x.title, (x) => x.id);
      if (!p) return { ok: false, message: "Phase introuvable." };
      return graphOp(s.project.id, { op: "upsertPhase", phase: { ...p, status: args["status"] as GamePhaseStatus } }, `Phase « ${p.title} » mise à jour.`);
    },
  },

  // ── Tâches ──────────────────────────────────────────────────────────────────────────
  {
    name: "list_tasks",
    description: "Liste les tâches d'un jeu (toutes, ou seulement les prêtes) : état, spécialité, dépendances, vérification.",
    params: { project: project_param, ready_only: { type: "boolean" } },
    risk: "read",
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const tasks = args["ready_only"] === true ? readyTasks(s.graph.tasks) : s.graph.tasks;
      return { ok: true, message: `${tasks.length} tâche(s).`, data: { tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, role: t.role, dependsOn: t.dependsOn, systems: t.systems, expected: t.expected, validation: t.validation })) } };
    },
  },
  {
    name: "add_task",
    description: "Ajoute une tâche au plan : titre, description, spécialité (role), systèmes, tâches préalables, résultat attendu, vérification.",
    params: {
      project: project_param,
      title: { type: "string", required: true },
      description: { type: "string" },
      role: { type: "string", enum: ROLES },
      systems: { type: "array" },
      depends_on: { type: "array", description: "Titres ou identifiants des tâches préalables." },
      expected: { type: "string" },
      validation: { type: "string" },
    },
    risk: "write",
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const deps = list(args["depends_on"]).map((ref) => task(s, ref)?.id).filter((id): id is string => Boolean(id));
      const draft: GameTask = {
        ...blankTask(0),
        title: String(args["title"]),
        description: typeof args["description"] === "string" ? args["description"] : "",
        role: oneOf(args["role"], ROLES) ?? "programming",
        systems: list(args["systems"]).map((ref) => system(s, ref)?.id).filter((id): id is string => Boolean(id)),
        dependsOn: deps,
        expected: typeof args["expected"] === "string" ? args["expected"] : "",
        validation: typeof args["validation"] === "string" ? args["validation"] : "",
      };
      return graphOp(s.project.id, { op: "upsertTask", task: draft }, `Tâche « ${draft.title} » ajoutée.`);
    },
  },
  {
    name: "update_task",
    description: "Modifie une tâche : titre, description, spécialité, résultat attendu, vérification.",
    params: { project: project_param, task: { type: "string", required: true }, title: { type: "string" }, description: { type: "string" }, role: { type: "string", enum: ROLES }, expected: { type: "string" }, validation: { type: "string" } },
    risk: "write",
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const t = task(s, args["task"]);
      if (!t) return { ok: false, message: "Tâche introuvable (list_tasks)." };
      const str = (k: string, fallback: string) => (typeof args[k] === "string" ? (args[k] as string) : fallback);
      return graphOp(
        s.project.id,
        { op: "upsertTask", task: { ...t, title: str("title", t.title), description: str("description", t.description), role: oneOf(args["role"], ROLES) ?? t.role, expected: str("expected", t.expected), validation: str("validation", t.validation) } },
        "Tâche modifiée.",
      );
    },
  },
  {
    name: "set_task_status",
    description: "Change l'état d'une tâche (todo, running, blocked, review, done, failed, cancelled), avec un compte rendu facultatif.",
    params: { project: project_param, task: { type: "string", required: true }, status: { type: "string", enum: TASK_STATUSES, required: true }, result: { type: "string" } },
    risk: "write",
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const t = task(s, args["task"]);
      if (!t) return { ok: false, message: "Tâche introuvable (list_tasks)." };
      return graphOp(
        s.project.id,
        { op: "setTaskStatus", id: t.id, status: args["status"] as GameTaskStatus, result: typeof args["result"] === "string" ? args["result"] : null, conversationId: null },
        `Tâche « ${t.title} » : ${TASK_STATUS[args["status"] as GameTaskStatus].label.toLowerCase()}.`,
      );
    },
  },
  {
    name: "remove_task",
    description: "Supprime une tâche du plan (si aucune autre ne l'attend).",
    params: { project: project_param, task: { type: "string", required: true } },
    risk: "destructive",
    confirm: (args) => `Supprimer la tâche « ${String(args["task"])} » ?`,
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const t = task(s, args["task"]);
      if (!t) return { ok: false, message: "Tâche introuvable (list_tasks)." };
      return graphOp(s.project.id, { op: "removeTask", id: t.id }, "Tâche supprimée.");
    },
  },

  // ── Moteur : vérifier, tester, jouer, exporter ─────────────────────────────────────────
  {
    name: "check_game_code",
    description: "Vérifie le code du jeu vidéo dans son moteur (scripts GDScript, compilation C# ou C++, Blueprints) et rend les erreurs expliquées : fichier, ligne, cause probable, piste de correction.",
    params: { project: project_param },
    risk: "write",
    run: (args) => runEngine(args["project"], "check", true),
  },
  {
    name: "run_tests",
    description: "Lance les tests automatisés du jeu vidéo (test de démarrage Godot, tests EditMode Unity, Automation Unreal) et rend les échecs expliqués.",
    params: { project: project_param },
    risk: "write",
    run: (args) => runEngine(args["project"], "test", true),
  },
  {
    name: "prepare_game_project",
    description: "Prépare le projet dans son moteur : import des ressources (Godot), scène de démarrage (Unity), compilation de l'éditeur C++ (Unreal).",
    params: { project: project_param },
    risk: "write",
    run: (args) => runEngine(args["project"], "setup", true),
  },
  {
    name: "play_in_engine",
    description: "Lance le jeu vidéo en cours de création dans son moteur (Godot, Unity, Unreal) pour y jouer ; sa sortie et ses erreurs sont suivies jusqu'à sa fermeture.",
    params: { project: project_param },
    risk: "write",
    run: (args) => runEngine(args["project"], "run", false),
  },
  {
    name: "export_build",
    description: "Exporte un build jouable du jeu vidéo pour une plateforme (Windows, Linux, macOS, Android, iOS, Web), en publication ou en développement. Refusé avec la marche à suivre si la machine ne le permet pas (modèles d'export, modules de build).",
    params: {
      project: project_param,
      platform: { type: "string", enum: PLATFORMS.filter((p) => p !== "console"), description: "Par défaut, la première plateforme visée." },
      development: { type: "boolean", description: "Build de développement (outils de débogage)." },
      wait: { type: "boolean", description: "Attendre la fin (peut être long)." },
    },
    risk: "write",
    run: (args) => runEngine(args["project"], "build", args["wait"] === true, oneOf(args["platform"], PLATFORMS), args["development"] === true),
  },
  {
    name: "stop_engine_action",
    description: "Arrête la vérification, les tests, le build ou la partie en cours du jeu vidéo (et les programmes qu'ils ont lancés).",
    params: { project: project_param },
    risk: "write",
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      const failure = await useGameStudioStore.getState().cancelAction(t.id);
      return failure ? { ok: false, message: failure } : { ok: true, message: "Arrêt demandé." };
    },
  },
  {
    name: "open_game_editor",
    description: "Ouvre l'éditeur du moteur (Godot, Unity, Unreal) sur le projet du jeu.",
    params: { project: project_param },
    risk: "write",
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      try {
        return { ok: true, message: await gameStudioApi.openEditor(t.id) };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },
  {
    name: "list_engine_actions",
    description: "Liste les dernières vérifications, tests, parties et builds du jeu, du plus récent au plus ancien, avec leur verdict.",
    params: { project: project_param },
    risk: "read",
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      try {
        const runs = await gameStudioApi.runs(t.id);
        const running = await gameStudioApi.currentAction(t.id);
        return {
          ok: true,
          message: `${running ? `En cours : ${ACTION[running.action].label}. ` : ""}${runs.length} exécution(s).`,
          data: { running, runs: runs.slice(0, 20).map((r) => ({ id: r.id, action: r.action, status: r.status, summary: r.summary, startedAt: r.startedAt, errors: r.diagnostics.filter((d) => d.severity === "error").length })) },
        };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },
  {
    name: "engine_action_result",
    description: "Erreurs du jeu lors de la dernière vérification, des derniers tests ou du dernier build (ou d'une exécution précise) : verdict, fichier, ligne, cause probable, piste de correction, systèmes concernés.",
    params: { project: project_param, run: { type: "string", description: "Identifiant (list_engine_actions) ; sinon la dernière." } },
    risk: "read",
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      try {
        const runs = await gameStudioApi.runs(t.id);
        const wanted = typeof args["run"] === "string" && args["run"] ? runs.find((r) => r.id === args["run"]) : runs[0];
        if (!wanted) return { ok: false, message: runs.length ? "Exécution introuvable : appelle list_engine_actions." : "Aucune exécution encore : lance check_game_code." };
        return runResult(wanted, t.id);
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },
  {
    name: "engine_action_log",
    description: "Journal complet d'une exécution (sortie brute de l'outil), la fin seulement si demandé.",
    params: { project: project_param, run: { type: "string", required: true }, last_lines: { type: "number", description: "Nombre de lignes de fin (200 par défaut)." } },
    risk: "read",
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      try {
        const text = await gameStudioApi.runLog(t.id, String(args["run"]));
        const count = typeof args["last_lines"] === "number" && args["last_lines"] > 0 ? Math.min(args["last_lines"], 2000) : 200;
        const lines = text.split("\n");
        return { ok: true, message: `${lines.length} ligne(s).`, data: { log: lines.slice(-count).join("\n") } };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },

  // ── Carte du projet et problèmes ─────────────────────────────────────────────────────
  {
    name: "scan_game_project",
    description: "Analyse le dossier d'un projet de jeu existant (sans rien modifier) : fichiers par nature et langage, systèmes déjà codés reconnus dans les noms, risques (Git, gros fichiers, version du moteur). Incrémental.",
    params: { project: project_param },
    risk: "write",
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      const map = await useGameStudioStore.getState().scan(t.id);
      if (typeof map === "string") return { ok: false, message: map };
      return {
        ok: true,
        message: `${map.files} fichiers, ${map.systems.length} système(s) repéré(s), ${map.risks.length} risque(s).`,
        data: { map: { files: map.files, languages: map.languages, systems: map.systems.map((f) => ({ id: f.id, name: f.name, inGraph: f.inGraph, files: f.fileCount, evidence: f.evidence })), risks: map.risks } },
        open: { module: SELF, params: { projectId: t.id, section: "map" } },
      };
    },
  },
  {
    name: "add_found_system",
    description: "Ajoute au graphe un système repéré dans le code par scan_game_project, avec ses fichiers rattachés (statut « en cours »).",
    params: { project: project_param, system: { type: "string", required: true, description: "Nom ou identifiant du système repéré." } },
    risk: "write",
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      try {
        const map = await gameStudioApi.map(t.id);
        if (!map) return { ok: false, message: "Projet pas encore analysé : appelle scan_game_project." };
        const found = findByName(map.systems, String(args["system"] ?? ""), (f) => f.name, (f) => f.id);
        if (!found) return { ok: false, message: "Système non repéré dans le code : voir scan_game_project." };
        for (const op of adoptOps(found)) await gameStudioApi.graphOp(t.id, op);
        await useGameStudioStore.getState().loadMap(t.id);
        return { ok: true, message: `« ${found.name} » ajouté au graphe avec ${found.files.length} fichier(s).`, open: { module: SELF, params: { projectId: t.id, section: "systems" } } };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },
  {
    name: "list_game_issues",
    description: "Problèmes ouverts du jeu (échecs de vérification, de tests ou de build notés automatiquement, ou ajoutés à la main), avec les systèmes concernés.",
    params: { project: project_param, include_closed: { type: "boolean" } },
    risk: "read",
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const issues = s.graph.issues.filter((i) => i.open || args["include_closed"] === true);
      return { ok: true, message: issues.length ? `${issues.length} problème(s).` : "Aucun problème ouvert.", data: { issues } };
    },
  },
  {
    name: "resolve_game_issue",
    description: "Marque un problème du jeu comme résolu (ou le rouvre).",
    params: { project: project_param, issue: { type: "string", required: true, description: "Identifiant ou titre." }, open: { type: "boolean", description: "true pour rouvrir." } },
    risk: "write",
    run: async (args) => {
      const s = await state(args["project"]);
      if (!isState(s)) return s;
      const issue = findByName(s.graph.issues, String(args["issue"] ?? ""), (i) => i.title, (i) => i.id);
      if (!issue) return { ok: false, message: "Problème introuvable : appelle list_game_issues." };
      const open = args["open"] === true;
      return graphOp(s.project.id, { op: "setIssueOpen", id: issue.id, open }, open ? "Problème rouvert." : "Problème marqué résolu.");
    },
  },
  // ── Historique ──────────────────────────────────────────────────────────────────────
  {
    name: "history_status",
    description: "État de l'historique d'un jeu : Git, branche, fichiers modifiés, points de restauration.",
    params: { project: project_param },
    risk: "read",
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      try {
        const vcs = await gameStudioApi.vcsState(t.id);
        return { ok: true, message: vcs.repository ? `${vcs.checkpoints.length} point(s) de restauration.` : "Pas encore de dépôt Git.", data: { ...vcs } };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },
  {
    name: "init_git",
    description: "Initialise le suivi Git du jeu (avec le .gitignore du moteur, Git LFS pour Unreal) et fait un premier commit.",
    params: { project: project_param },
    risk: "write",
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      try {
        return { ok: true, message: await gameStudioApi.vcsInit(t.id) };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },
  {
    name: "create_checkpoint",
    description: "Prend un point de restauration de tout le jeu (sans toucher aux branches), avant une modification importante.",
    params: { project: project_param, label: { type: "string", required: true } },
    risk: "write",
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      try {
        const cp = await gameStudioApi.checkpoint(t.id, String(args["label"]));
        return { ok: true, message: `Point de restauration « ${cp.label} » pris.`, data: { id: cp.id } };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },
  {
    name: "checkpoint_changes",
    description: "Liste les fichiers changés depuis un point de restauration (ajoutés, modifiés, supprimés).",
    params: { project: project_param, checkpoint: { type: "string", required: true, description: "Identifiant ou nom du point." } },
    risk: "read",
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      try {
        const vcs = await gameStudioApi.vcsState(t.id);
        const cp = findByName(vcs.checkpoints, String(args["checkpoint"]), (c) => c.label, (c) => c.id);
        if (!cp) return { ok: false, message: "Point de restauration introuvable (history_status)." };
        const changes = await gameStudioApi.checkpointChanges(t.id, cp.id);
        return { ok: true, message: `${changes.length} fichier(s) changé(s) depuis « ${cp.label} ».`, data: { changes } };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },
  {
    name: "restore_checkpoint",
    description: "Revient à un point de restauration (tout le jeu, ou quelques fichiers) ; l'état actuel est d'abord sauvegardé.",
    params: { project: project_param, checkpoint: { type: "string", required: true }, files: { type: "array", description: "Seulement ces fichiers (sinon tout)." } },
    risk: "destructive",
    confirm: (args) => `Revenir au point de restauration « ${String(args["checkpoint"])} » ?`,
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      try {
        const vcs = await gameStudioApi.vcsState(t.id);
        const cp = findByName(vcs.checkpoints, String(args["checkpoint"]), (c) => c.label, (c) => c.id);
        if (!cp) return { ok: false, message: "Point de restauration introuvable (history_status)." };
        const files = list(args["files"]);
        return { ok: true, message: await gameStudioApi.restore(t.id, cp.id, files.length ? files : null) };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },
  {
    name: "read_game_journal",
    description: "Lit le journal d'un jeu (système, build, moteur, MCP, IA, erreurs…), le plus récent d'abord.",
    params: { project: project_param, category: { type: "string", enum: [...LOG_CATEGORIES] }, limit: { type: "number" } },
    risk: "read",
    run: async (args) => {
      const t = await target(args["project"]);
      if (isError(t)) return t;
      try {
        const entries = await gameStudioApi.journal(t.id, oneOf<GameLogCategory>(args["category"], LOG_CATEGORIES), typeof args["limit"] === "number" ? args["limit"] : 50);
        return { ok: true, message: `${entries.length} entrée(s).`, data: { entries } };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },

  // ── Outils ──────────────────────────────────────────────────────────────────────────
  {
    name: "environment_report",
    description: "Rapport des outils de la machine : moteurs installés et versions, Blender, Git, Python, Node, .NET, Visual Studio, SDK Android, avec ce qui manque.",
    params: { refresh: { type: "boolean" } },
    risk: "read",
    run: async (args) => {
      await useGameStudioStore.getState().loadEnvironment(args["refresh"] === true);
      const env = useGameStudioStore.getState().environment;
      if (!env) return { ok: false, message: "Rapport indisponible." };
      const ready = env.tools.filter((t) => t.state === "ready").map((t) => t.label);
      return {
        ok: true,
        message: ready.length ? `Prêts : ${ready.join(", ")}.` : "Aucun outil prêt.",
        data: { tools: env.tools.map((t) => ({ id: t.id, label: t.label, state: t.state, version: t.version, path: t.path, setup: t.state === "ready" ? [] : t.setup })), engines: env.engines },
      };
    },
  },
  {
    name: "set_tool_path",
    description: "Désigne l'exécutable d'un outil à la main (godot, unity, unreal, blender, git, python, node, dotnet), ou oublie ce chemin (path vide).",
    params: { tool: { type: "string", enum: ["godot", "unity", "unreal", "blender", "git", "python", "node", "dotnet"], required: true }, path: { type: "string" } },
    risk: "write",
    run: async (args) => {
      try {
        const env = await gameStudioApi.setToolPath(String(args["tool"]), typeof args["path"] === "string" && args["path"] ? args["path"] : null);
        useGameStudioStore.getState().setEnvironment(env);
        const tool = env.tools.find((t) => t.id === args["tool"]);
        return { ok: true, message: tool ? `${tool.label} : ${tool.state === "ready" ? "prêt" : "toujours pas détecté"}.` : "Chemin enregistré." };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },
  {
    name: "install_tool",
    description: "Installe un outil avec winget (godot, unity = Unity Hub, unreal = Epic Games Launcher, blender, git, python, node, dotnet).",
    params: { tool: { type: "string", enum: ["godot", "unity", "unreal", "blender", "git", "python", "node", "dotnet"], required: true } },
    risk: "destructive",
    confirm: (args) => `Installer ${String(args["tool"])} sur cet ordinateur avec winget ?`,
    run: async (args) => {
      try {
        const message = await gameStudioApi.installTool(String(args["tool"]));
        await useGameStudioStore.getState().loadEnvironment(true);
        return { ok: true, message };
      } catch (e) {
        return { ok: false, message: errorText(e) };
      }
    },
  },
]);
