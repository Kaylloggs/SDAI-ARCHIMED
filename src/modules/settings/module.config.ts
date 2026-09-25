import { lazy } from "react";
import { Settings } from "lucide-react";
import { defineModule } from "@/core/modules";
import tutorial from "./tutorial";

export default defineModule({
  id: "settings",
  name: "Réglages",
  description: "Modules, apparence, moteur et sécurité.",
  version: "0.1.0",
  icon: Settings,
  category: "settings",
  order: 900,
  enabledByDefault: true,
  required: true,
  page: lazy(() => import("./index")),
  launchpad: { size: "sm" },
  tutorial,
});
