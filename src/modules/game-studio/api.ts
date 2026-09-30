import { invokeModule } from "@/core/ipc";
import type { GameAnalysis } from "@/core/ipc/bindings/GameAnalysis";
import type { GameCheckpoint } from "@/core/ipc/bindings/GameCheckpoint";
import type { GameCreateOutcome } from "@/core/ipc/bindings/GameCreateOutcome";
import type { GameCreateRequest } from "@/core/ipc/bindings/GameCreateRequest";
import type { GameEngine } from "@/core/ipc/bindings/GameEngine";
import type { GameEnvironment } from "@/core/ipc/bindings/GameEnvironment";
import type { GameFileChange } from "@/core/ipc/bindings/GameFileChange";
import type { GameGraph } from "@/core/ipc/bindings/GameGraph";
import type { GameGraphOp } from "@/core/ipc/bindings/GameGraphOp";
import type { GameLogCategory } from "@/core/ipc/bindings/GameLogCategory";
import type { GameLogEntry } from "@/core/ipc/bindings/GameLogEntry";
import type { GameProject } from "@/core/ipc/bindings/GameProject";
import type { GameProjectPatch } from "@/core/ipc/bindings/GameProjectPatch";
import type { GameProjectState } from "@/core/ipc/bindings/GameProjectState";
import type { GameProjectSummary } from "@/core/ipc/bindings/GameProjectSummary";
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
};

export function errorText(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
