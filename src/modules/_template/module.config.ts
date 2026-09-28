import { lazy } from "react";
import { Sparkles } from "lucide-react";
import { defineModule } from "@/core/modules";
import tutorial from "./tutorial";

export default defineModule({
  id: "__ID__",
  name: "__PASCAL__",
  description: "Décrire le module en une phrase.",
  version: "0.1.0",
  icon: Sparkles,
  category: "__CATEGORY__",
  order: 50,
  enabledByDefault: true,
  page: lazy(() => import("./index")),
  launchpad: { size: "md" },
  capabilities: [],
  // Base de commandes pour les agents (voir agent-actions.ts).
  actions: () => import("./agent-actions"),
  tutorial,__BACKEND__
});
