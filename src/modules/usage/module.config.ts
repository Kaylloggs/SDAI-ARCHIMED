import { lazy } from "react";
import { Gauge } from "lucide-react";
import { defineModule } from "@/core/modules";
import tutorial from "./tutorial";

export default defineModule({
  id: "usage",
  name: "Crédits",
  description: "Limites d'abonnement restantes et consommation des CLI d'IA.",
  version: "0.1.0",
  icon: Gauge,
  category: "ai",
  order: 30,
  enabledByDefault: true,
  page: lazy(() => import("./index")),
  launchpad: { size: "sm" },
  backend: { plugin: "usage" },
  commands: [{ id: "usage.open", title: "Voir les crédits restants", run: "navigate" }],
  tutorial,
});
