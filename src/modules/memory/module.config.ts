import { lazy } from "react";
import { Brain } from "lucide-react";
import { defineModule } from "@/core/modules";

export default defineModule({
  id: "memory",
  name: "Mémoire",
  description: "Les informations que vous donnez aux IA au début de chaque conversation.",
  version: "0.2.0",
  icon: Brain,
  category: "ai",
  order: 25,
  enabledByDefault: true,
  page: lazy(() => import("./index")),
  launchpad: { size: "sm" },
  backend: { plugin: "memory" },
  provides: {
    // Consommé par useChat : notes actives ajoutées au premier message d'une conversation.
    "memory.context": () => import("./services/context"),
  },
  commands: [{ id: "memory.open", title: "Gérer la mémoire des IA", run: "navigate" }],
});
