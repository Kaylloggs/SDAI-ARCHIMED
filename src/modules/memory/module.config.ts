import { lazy } from "react";
import { Brain } from "lucide-react";
import { defineModule } from "@/core/modules";

export default defineModule({
  id: "memory",
  name: "Mémoire",
  description: "Ce qu'ARCHIMED retient de vos projets et le rappelle aux IA.",
  version: "0.1.0",
  icon: Brain,
  category: "ai",
  order: 25,
  enabledByDefault: true,
  page: lazy(() => import("./index")),
  launchpad: { size: "sm" },
  backend: { plugin: "memory" },
  provides: {
    // Consommé par useChat : contexte ajouté au premier message d'une conversation.
    "memory.context": () => import("./services/context"),
  },
  slots: {
    "app.background": lazy(() => import("./slots/MemoryRecorder")),
    "chat.message.actions": lazy(() => import("./slots/RememberAction")),
  },
  commands: [{ id: "memory.open", title: "Voir la mémoire", run: "navigate" }],
});
