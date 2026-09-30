import { Channel, invokeModule } from "@/core/ipc";
import type { GameAction } from "@/core/ipc/bindings/GameAction";
import type { GameAnalysis } from "@/core/ipc/bindings/GameAnalysis";
import type { GameBuildRecord } from "@/core/ipc/bindings/GameBuildRecord";
import type { GameCheckpoint } from "@/core/ipc/bindings/GameCheckpoint";
import type { GameCreateOutcome } from "@/core/ipc/bindings/GameCreateOutcome";
import type { GameCreateRequest } from "@/core/ipc/bindings/GameCreateRequest";
import type { GameEngine } from "@/core/ipc/bindings/GameEngine";
import type { GameEnvironment } from "@/core/ipc/bindings/GameEnvironment";
import type { GameFileChange } from "@/core/ipc/bindings/GameFileChange";
import type { GameGraph } from "@/core/ipc/bindings/GameGraph";
import type { GameGraphOp } from "@/core/ipc/bindings/GameGraphOp";
import type { GameJobEvent } from "@/core/ipc/bindings/GameJobEvent";
import type { GameLogCategory } from "@/core/ipc/bindings/GameLogCategory";
import type { GameLogEntry } from "@/core/ipc/bindings/GameLogEntry";
import type { GameMcpHealth } from "@/core/ipc/bindings/GameMcpHealth";
import type { GameMcpOwnServer } from "@/core/ipc/bindings/GameMcpOwnServer";
import type { GameMcpServer } from "@/core/ipc/bindings/GameMcpServer";
import type { GamePlatform } from "@/core/ipc/bindings/GamePlatform";
import type { GameProject } from "@/core/ipc/bindings/GameProject";
import type { GameProjectMap } from "@/core/ipc/bindings/GameProjectMap";
import type { GameProjectPatch } from "@/core/ipc/bindings/GameProjectPatch";
import type { GameProjectState } from "@/core/ipc/bindings/GameProjectState";
import type { GameProjectSummary } from "@/core/ipc/bindings/GameProjectSummary";
import type { GameRunningJob } from "@/core/ipc/bindings/GameRunningJob";
import type { GameSystem } from "@/core/ipc/bindings/GameSystem";
import type { GameVcsState } from "@/core/ipc/bindings/GameVcsState";

const PLUGIN = "game-studio";
const call = <T>(command: string, args?: Record<string, unknown>) => invokeModule<T>(PLUGIN, command, args);

/** Appels au backend de Game Studio (seul endroit du module qui parle au Rust). */
export const gameStudioApi = {
  // Environnement
  environment: (refresh = false) => call<GameEnvironment>("game_environment", { refresh }),
  setToolPath: (tool: string, path: string | null) => call<GameEnvironment>("set_tool_path", { tool, path }),
  installTool: (tool: string) => call<string>("install_tool", { tool }),

  // Idée et projets
  analyze: (idea: string) => call<GameAnalysis>("analyze_idea", { idea }),
  catalog: () => call<GameSystem[]>("system_catalog"),
  defaultParent: () => call<string>("game_default_dir"),
  create: (request: GameCreateRequest) => call<GameCreateOutcome>("create_game", { request }),
  importProject: (root: string) => call<GameProject>("import_game", { root }),
  list: () => call<GameProjectSummary[]>("list_games"),
  state: (id: string) => call<GameProjectState>("game_state", { id }),
  update: (id: string, patch: GameProjectPatch) => call<GameProject>("update_game", { id, patch }),
  forget: (id: string) => call<void>("forget_game", { id }),
  setEngine: (id: string, engine: GameEngine, editor: string | null, cpp: boolean) => call<string[]>("set_game_engine", { id, engine, editor, cpp }),

  // Graphe de connaissance
  graphOp: (id: string, op: GameGraphOp) => call<GameGraph>("graph_op", { id, op }),
  journal: (id: string, category: GameLogCategory | null, limit = 300) => call<GameLogEntry[]>("read_journal", { id, category, limit }),

  // Historique
  vcsState: (id: string) => call<GameVcsState>("vcs_state", { id }),
  vcsInit: (id: string) => call<string>("vcs_init", { id }),
  checkpoint: (id: string, label: string) => call<GameCheckpoint>("create_checkpoint", { id, label }),
  checkpointChanges: (id: string, checkpoint: string) => call<GameFileChange[]>("checkpoint_changes", { id, checkpoint }),
  checkpointDiff: (id: string, checkpoint: string, path: string) => call<string>("checkpoint_diff", { id, checkpoint, path }),
  restore: (id: string, checkpoint: string, paths: string[] | null) => call<string>("restore_checkpoint", { id, checkpoint, paths }),

  // Actions du moteur (vérifier, tester, lancer, exporter)
  /** Lance l'action ; les lignes et le résultat arrivent par `onEvent`. Renvoie l'id de l'exécution. */
  runAction: (id: string, action: GameAction, platform: GamePlatform | null, development: boolean, onEvent: Channel<GameJobEvent>) =>
    call<string>("run_game_action", { id, action, platform, development, onEvent }),
  cancelAction: (id: string) => call<void>("cancel_game_action", { id }),
  currentAction: (id: string) => call<GameRunningJob | null>("current_game_action", { id }),
  openEditor: (id: string) => call<string>("open_game_editor", { id }),
  runs: (id: string) => call<GameBuildRecord[]>("list_game_runs", { id }),
  runLog: (id: string, run: string) => call<string>("read_game_run_log", { id, run }),

  // Carte du projet
  scan: (id: string) => call<GameProjectMap>("scan_game", { id }),
  map: (id: string) => call<GameProjectMap | null>("game_map", { id }),

  // Serveurs MCP
  mcpServers: (project: string | null) => call<GameMcpServer[]>("list_mcp_servers", { project }),
  /** Lance ou contacte le serveur pour de vrai (initialize puis tools/list). */
  checkMcp: (key: string, project: string | null) => call<GameMcpHealth>("check_mcp_server", { key, project }),
  addMcp: (server: GameMcpOwnServer) => call<GameMcpServer[]>("add_mcp_server", { server }),
  removeMcp: (name: string) => call<GameMcpServer[]>("remove_mcp_server", { name }),
};

export function errorText(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
