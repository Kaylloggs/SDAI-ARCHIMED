import { lazy } from "react";
import { Sparkles } from "lucide-react";
import { defineModule } from "@/core/modules";

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
  launchpad: { size: "md" },__BACKEND__
});
