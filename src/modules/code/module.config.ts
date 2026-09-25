import { lazy } from "react";
import { Code2 } from "lucide-react";
import { defineModule } from "@/core/modules";
import tutorial from "./tutorial";

export default defineModule({
  id: "code",
  name: "Code",
  description: "Explorer un projet, lire le code et le modifier avec une IA.",
  version: "0.1.0",
  icon: Code2,
  category: "ai",
  order: 15,
  enabledByDefault: true,
  page: lazy(() => import("./index")),
  launchpad: { size: "md" },
  backend: { plugin: "code" },
  provides: {
    // Permet au module Chat de détecter un projet sans dépendre de ce module.
    "code.project": () => import("./services/project"),
    // Ouvre un fichier cité dans une réponse d'IA (liens de la conversation).
    "code.open": () => import("./services/open"),
  },
  commands: [{ id: "code.open", title: "Ouvrir un projet dans Code", run: "navigate" }],
  tutorial,
});
