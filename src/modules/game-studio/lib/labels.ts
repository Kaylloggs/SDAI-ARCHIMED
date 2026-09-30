import type { GameAction } from "@/core/ipc/bindings/GameAction";
import type { GameAgentRole } from "@/core/ipc/bindings/GameAgentRole";
import type { GameBuildStatus } from "@/core/ipc/bindings/GameBuildStatus";
import type { GameFileKind } from "@/core/ipc/bindings/GameFileKind";
import type { GameIssueSeverity } from "@/core/ipc/bindings/GameIssueSeverity";
import type { GameAssumptionStatus } from "@/core/ipc/bindings/GameAssumptionStatus";
import type { GameAutonomy } from "@/core/ipc/bindings/GameAutonomy";
import type { GameCapabilityVia } from "@/core/ipc/bindings/GameCapabilityVia";
import type { GameDimension } from "@/core/ipc/bindings/GameDimension";
import type { GameEngine } from "@/core/ipc/bindings/GameEngine";
import type { GameLogCategory } from "@/core/ipc/bindings/GameLogCategory";
import type { GameMcpSource } from "@/core/ipc/bindings/GameMcpSource";
import type { GameMcpState } from "@/core/ipc/bindings/GameMcpState";
import type { GameMode } from "@/core/ipc/bindings/GameMode";
import type { GameNetMode } from "@/core/ipc/bindings/GameNetMode";
import type { GameNetTopology } from "@/core/ipc/bindings/GameNetTopology";
import type { GamePlatform } from "@/core/ipc/bindings/GamePlatform";
import type { GameSystemCategory } from "@/core/ipc/bindings/GameSystemCategory";
import type { GameSystemStatus } from "@/core/ipc/bindings/GameSystemStatus";
import type { GameTaskStatus } from "@/core/ipc/bindings/GameTaskStatus";
import type { GameToolState } from "@/core/ipc/bindings/GameToolState";
import type { GameWorldKind } from "@/core/ipc/bindings/GameWorldKind";

export type Tone = "neutral" | "success" | "info" | "warning" | "danger" | "accent";

export const ENGINES: GameEngine[] = ["godot", "unity", "unreal"];

export const ENGINE_LABEL: Record<GameEngine, string> = {
  godot: "Godot",
  unity: "Unity",
  unreal: "Unreal Engine",
};

export const MODE: Record<GameMode, { label: string; hint: string }> = {
  prototype: { label: "Prototype rapide", hint: "Juste de quoi tester l'idée : peu de systèmes, pas de sur-architecture." },
  standard: { label: "Standard", hint: "Vrai projet structuré, qui peut grandir." },
  advanced: { label: "Avancé", hint: "Projet complexe : réseau, grands mondes, nombreux systèmes." },
  production: { label: "Production", hint: "Architecture robuste avec tests, versions et chaîne de build." },
  existing: { label: "Projet existant", hint: "Game Studio travaille sur un projet déjà commencé." },
};

export const AUTONOMY: Record<GameAutonomy, { label: string; hint: string }> = {
  manual: { label: "Manuel", hint: "Chaque action importante vous est demandée." },
  assisted: { label: "Assisté", hint: "Les tâches courantes se font seules ; le reste vous est demandé." },
  autonomous: { label: "Autonome", hint: "Chaînes complètes de tâches, avec points de restauration et retour possible." },
};

export const DIMENSION: Record<GameDimension, string> = { "2d": "2D", "2.5d": "2,5D", "3d": "3D" };

export const PLATFORMS: GamePlatform[] = ["windows", "linux", "macos", "android", "ios", "web", "console"];

export const PLATFORM_LABEL: Record<GamePlatform, string> = {
  windows: "Windows",
  linux: "Linux",
  macos: "macOS",
  android: "Android",
  ios: "iOS",
  web: "Web",
  console: "Consoles",
};

export const CATEGORY_LABEL: Record<GameSystemCategory, string> = {
  core: "Fondations",
  player: "Joueur",
  camera: "Caméra",
  combat: "Combat",
  ai: "IA des ennemis",
  npc: "PNJ et simulation",
  rpg: "Progression",
  items: "Objets et inventaire",
  crafting: "Fabrication",
  building: "Construction",
  vehicles: "Véhicules",
  narrative: "Quêtes et narration",
  economy: "Économie",
  world: "Monde",
  generation: "Génération procédurale",
  environment: "Temps et météo",
  multiplayer: "Multijoueur",
  backend: "Services en ligne",
  persistence: "Sauvegarde",
  ui: "Interface",
  audio: "Audio",
  visual: "Rendu, animation et effets",
  gameplay: "Règles de jeu",
  platform: "Plateformes et accessibilité",
};

/** Ordre d'affichage des catégories : le cœur du jeu d'abord, les fondations à la fin. */
export const CATEGORY_ORDER: GameSystemCategory[] = [
  "gameplay", "player", "camera", "combat", "ai", "npc", "rpg", "items", "crafting", "building", "vehicles",
  "narrative", "economy", "world", "generation", "environment", "multiplayer", "backend", "persistence", "ui",
  "audio", "visual", "platform", "core",
];

export const NET_MODE: Record<GameNetMode, string> = {
  local: "Local",
  serverAuthority: "Autorité serveur",
  replicated: "Répliqué",
  predicted: "Prédit",
  clientOnly: "Client seulement",
};

export const SYSTEM_STATUS: Record<GameSystemStatus, { label: string; tone: Tone }> = {
  planned: { label: "Prévu", tone: "neutral" },
  inProgress: { label: "En cours", tone: "info" },
  implemented: { label: "Implémenté", tone: "accent" },
  validated: { label: "Validé", tone: "success" },
  broken: { label: "Cassé", tone: "danger" },
  deprecated: { label: "Abandonné", tone: "neutral" },
};

export const TASK_STATUS: Record<GameTaskStatus, { label: string; tone: Tone }> = {
  todo: { label: "À faire", tone: "neutral" },
  running: { label: "En cours", tone: "info" },
  blocked: { label: "Bloquée", tone: "warning" },
  review: { label: "À relire", tone: "accent" },
  done: { label: "Terminée", tone: "success" },
  failed: { label: "En échec", tone: "danger" },
  cancelled: { label: "Annulée", tone: "neutral" },
};

export const ROLE: Record<GameAgentRole, { label: string; hint: string }> = {
  director: { label: "Directeur", hint: "Coordonne les agents, tranche les conflits, tient le plan." },
  gameDesign: { label: "Game design", hint: "Gameplay, règles, équilibrage, expérience de jeu." },
  architecture: { label: "Architecture", hint: "Découpage en systèmes, interfaces, choix techniques." },
  programming: { label: "Programmation", hint: "Code des systèmes, intégré au projet." },
  world: { label: "Monde", hint: "Niveaux, génération, streaming, environnement." },
  aiNpc: { label: "IA et PNJ", hint: "Comportements, navigation, perception, routines." },
  modeling: { label: "Modélisation 3D", hint: "Modèles, UV, export (Blender)." },
  texture: { label: "Textures", hint: "Textures, matériaux, cohérence de style." },
  animation: { label: "Animation", hint: "Squelettes, machines à états, IK." },
  vfx: { label: "Effets visuels", hint: "Particules, shaders d'effets, rendu." },
  uiUx: { label: "Interface", hint: "Menus, HUD, navigation manette, accessibilité." },
  audio: { label: "Audio", hint: "Musique, ambiances, effets sonores, mixage." },
  network: { label: "Réseau", hint: "Réplication, autorité, latence, sessions." },
  backend: { label: "Services en ligne", hint: "Comptes, sauvegardes en ligne, classements." },
  build: { label: "Build", hint: "Préparation, compilation, packaging par plateforme." },
  qa: { label: "Qualité", hint: "Tests, non-régression, vérifications." },
  debug: { label: "Débogage", hint: "Cause racine des erreurs, corrections." },
  optimization: { label: "Optimisation", hint: "Profilage, LOD, budgets de performance." },
};

export const WORLD_KIND: Record<GameWorldKind, string> = {
  static: "Monde statique",
  sceneBased: "Scènes successives",
  levelBased: "Niveaux",
  openWorld: "Monde ouvert",
  streaming: "Streaming",
  procedural: "Procédural",
  infinite: "Infini",
  voxel: "Voxels",
  tile: "Tuiles",
  destructible: "Destructible",
  hybrid: "Hybride",
};

export const TOPOLOGY: Record<GameNetTopology, string> = {
  none: "Solo",
  local: "Multijoueur local",
  listenServer: "Hôte joueur",
  dedicatedServer: "Serveur dédié",
  persistent: "Monde persistant en ligne",
};

export const TOOL_STATE: Record<GameToolState, { label: string; tone: Tone }> = {
  ready: { label: "Prêt", tone: "success" },
  missing: { label: "Manquant", tone: "danger" },
  optional: { label: "Facultatif", tone: "neutral" },
  error: { label: "Erreur", tone: "danger" },
  degraded: { label: "Partiel", tone: "warning" },
  authRequired: { label: "Connexion requise", tone: "warning" },
  versionMismatch: { label: "Version inadaptée", tone: "warning" },
};

export const VIA: Record<GameCapabilityVia, string> = {
  cli: "Ligne de commande",
  files: "Fichiers du projet",
  mcp: "Serveur MCP",
  manual: "Dans l'éditeur",
};

export const ASSUMPTION_STATUS: Record<GameAssumptionStatus, string> = {
  editable: "Modifiable",
  confirmed: "Confirmée",
  replaced: "Remplacée",
};

export const LOG_CATEGORY: Record<GameLogCategory, string> = {
  SYSTEM: "Système",
  BUILD: "Build",
  ENGINE: "Moteur",
  MCP: "MCP",
  AI: "IA",
  NETWORK: "Réseau",
  ASSET: "Assets",
  CODE: "Code",
  TEST: "Tests",
  ERROR: "Erreurs",
  PERFORMANCE: "Performance",
};

export const ACTION: Record<GameAction, { label: string; verb: string }> = {
  setup: { label: "Préparation", verb: "Préparer le projet" },
  check: { label: "Vérification", verb: "Vérifier le code" },
  test: { label: "Tests", verb: "Lancer les tests" },
  run: { label: "Partie", verb: "Lancer le jeu" },
  build: { label: "Build", verb: "Exporter le build" },
  editor: { label: "Éditeur", verb: "Ouvrir l'éditeur" },
};

export const RUN_STATUS: Record<GameBuildStatus, { label: string; tone: Tone }> = {
  running: { label: "En cours", tone: "info" },
  success: { label: "Réussi", tone: "success" },
  failed: { label: "Échec", tone: "danger" },
  cancelled: { label: "Arrêté", tone: "neutral" },
};

export const SEVERITY: Record<GameIssueSeverity, { label: string; tone: Tone }> = {
  error: { label: "Erreur", tone: "danger" },
  warning: { label: "Avertissement", tone: "warning" },
  info: { label: "Info", tone: "neutral" },
};

export const FILE_KIND: Record<GameFileKind, string> = {
  script: "Scripts",
  scene: "Scènes et cartes",
  texture: "Textures et images",
  model: "Modèles 3D",
  audio: "Sons et musiques",
  material: "Matériaux et ressources",
  shader: "Shaders",
  animation: "Animations",
  font: "Polices",
  video: "Vidéos",
  data: "Données et réglages",
  other: "Autres",
};

/** « 12,4 Mo » */
export function bytes(size: number): string {
  if (size < 1024) return `${size} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

/** « 1 min 05 s » */
export function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${minutes} min ${String(rest).padStart(2, "0")} s` : `${minutes} min`;
}

export const MCP_SOURCE: Record<GameMcpSource, string> = {
  claudeCode: "Claude Code",
  project: "Projet (.mcp.json)",
  claudeDesktop: "Claude Desktop",
  cursor: "Cursor",
  codex: "Codex",
  gemini: "Gemini CLI",
  antigravity: "Antigravity",
  gameStudio: "Ajouté dans Game Studio",
};

export const MCP_STATE: Record<GameMcpState, { label: string; tone: Tone }> = {
  ok: { label: "Prêt", tone: "success" },
  error: { label: "Erreur", tone: "danger" },
  timeout: { label: "Sans réponse", tone: "warning" },
  missing: { label: "Programme absent", tone: "danger" },
  authRequired: { label: "Connexion requise", tone: "warning" },
  unsupported: { label: "Non testable", tone: "neutral" },
};

/** Découpe une ligne de commande en programme et arguments (guillemets simples ou doubles). */
export function splitCommand(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  let started = false;
  for (const char of line.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started || current) parts.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started || current) parts.push(current);
  return parts;
}

const TOPIC: Record<string, string> = {
  camera: "Caméra",
  dimension: "Dimension",
  players: "Joueurs",
  targets: "Plateformes",
  world: "Monde",
  network: "Réseau",
  gameplay: "Gameplay",
  console: "Consoles",
  engine: "Moteur",
};

/** Sujet d'une hypothèse ou d'une question, en clair (« targets » → « Plateformes »). */
export function topicLabel(topic: string): string {
  const known = TOPIC[topic];
  if (known) return known;
  const words = topic.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Version lisible : « 4.4.1.stable.official.49a5bc7b6 » → « 4.4.1 », « 2022.3.10f1 » inchangée. */
export function shortVersion(version: string | null | undefined): string {
  if (!version) return "";
  return version.match(/^\d+(?:\.\d+)*(?:[a-z]\d+)?/i)?.[0] ?? version;
}

/** « il y a 3 min » à partir d'une date ISO. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "hier" : `il y a ${days} jours`;
}
