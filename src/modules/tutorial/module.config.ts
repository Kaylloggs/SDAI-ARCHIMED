import { lazy } from "react";
import { GraduationCap } from "lucide-react";
import { defineModule } from "@/core/modules";
import { open } from "./services/open";
import { CREATE_MODULE_TOPIC, START_TOPIC } from "./store";

export default defineModule({
  id: "tutorial",
  name: "Tutoriel",
  description: "Apprendre à utiliser l'application et chacun de ses modules, étape par étape.",
  version: "0.1.0",
  icon: GraduationCap,
  // Épinglé en bas du menu, juste au-dessus de Réglages (order 900).
  category: "settings",
  order: 800,
  enabledByDefault: true,
  required: true,
  page: lazy(() => import("./index")),
  launchpad: { size: "sm" },
  provides: {
    "tutorial.open": () => import("./services/open"),
  },
  commands: [
    { id: "tutorial.start", title: "Tutoriel : premiers pas", run: () => open(START_TOPIC) },
    { id: "tutorial.create-module", title: "Tutoriel : créer un module", run: () => open(CREATE_MODULE_TOPIC) },
  ],
});
