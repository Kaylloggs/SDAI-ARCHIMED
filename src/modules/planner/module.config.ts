import { lazy } from "react";
import { KanbanSquare } from "lucide-react";
import { defineModule } from "@/core/modules";
import tutorial from "./tutorial";

export default defineModule({
  id: "planner",
  name: "Planner",
  description: "Tableaux de tâches, roadmaps de projet synchronisées et échéances d'agenda.",
  version: "0.1.0",
  icon: KanbanSquare,
  category: "productivity",
  order: 10,
  enabledByDefault: true,
  page: lazy(() => import("./index")),
  launchpad: { size: "md" },
  backend: { plugin: "planner" },
  slots: {
    // Propose d'ajouter tâches et dates quand un message de l'IA en contient.
    "chat.message.actions": lazy(() => import("./slots/MessageActions")),
    // Propose de suivre le roadmap.md du projet ouvert dans Code.
    "code.editor.footer": lazy(() => import("./slots/RoadmapFooter")),
  },
  commands: [{ id: "planner.open", title: "Ouvrir le Planner", run: "navigate" }],
  tutorial,
});
