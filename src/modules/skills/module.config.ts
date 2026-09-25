import { lazy } from "react";
import { Boxes } from "lucide-react";
import { defineModule } from "@/core/modules";
import tutorial from "./tutorial";

export default defineModule({
  id: "skills",
  name: "Skills",
  description: "Importer, activer et synchroniser les compétences des CLI.",
  version: "0.1.0",
  icon: Boxes,
  category: "ai",
  order: 20,
  enabledByDefault: true,
  page: lazy(() => import("./index")),
  launchpad: { size: "md" },
  backend: { plugin: "skills" },
  slots: {
    // Choisir un skill depuis la barre de chat (Chat et Code).
    "chat.composer.actions": lazy(() => import("./slots/ComposerSkills")),
  },
  commands: [{ id: "skills.open", title: "Gérer les skills", run: "navigate" }],
  tutorial,
});
