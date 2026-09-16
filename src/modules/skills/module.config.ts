import { lazy } from "react";
import { Boxes } from "lucide-react";
import { defineModule } from "@/core/modules";

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
  commands: [{ id: "skills.open", title: "Gérer les skills", run: "navigate" }],
});
