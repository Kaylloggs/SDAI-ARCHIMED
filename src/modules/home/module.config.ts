import { lazy } from "react";
import { LayoutGrid } from "lucide-react";
import { defineModule } from "@/core/modules";

export default defineModule({
  id: "home",
  name: "Accueil",
  description: "Point de départ : tous les blocs disponibles.",
  version: "0.1.0",
  icon: LayoutGrid,
  category: "core",
  order: 0,
  enabledByDefault: true,
  required: true,
  page: lazy(() => import("./index")),
  launchpad: false,
});
