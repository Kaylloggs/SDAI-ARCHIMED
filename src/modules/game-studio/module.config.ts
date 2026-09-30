import { lazy } from "react";
import { Gamepad2 } from "lucide-react";
import { defineModule } from "@/core/modules";
import tutorial from "./tutorial";

export default defineModule({
  id: "game-studio",
  name: "Game Studio",
  description: "Conçoit, crée et fait avancer des jeux vidéo avec des agents IA, dans Godot, Unity ou Unreal.",
  version: "0.1.0",
  icon: Gamepad2,
  category: "creative",
  order: 25,
  enabledByDefault: true,
  page: lazy(() => import("./index")),
  launchpad: { size: "md" },
  backend: { plugin: "game-studio" },
  commands: [{ id: "game-studio.open", title: "Ouvrir Game Studio", run: "navigate" }],
  capabilities: ["game_design", "game_projects", "game_systems", "game_tasks", "engine_detection", "godot", "unity", "unreal", "checkpoints"],
  // Base de commandes pour les agents (voir agent-actions.ts).
  actions: () => import("./agent-actions"),
  tutorial,
});
