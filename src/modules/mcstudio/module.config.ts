import { lazy } from "react";
import { Pickaxe } from "lucide-react";
import { defineModule } from "@/core/modules";

export default defineModule({
  id: "mcstudio",
  name: "Mod Studio",
  description: "Crée, compile et exporte de vrais mods Minecraft (Fabric, Forge, NeoForge).",
  version: "0.1.0",
  icon: Pickaxe,
  category: "creative",
  order: 20,
  enabledByDefault: true,
  page: lazy(() => import("./index")),
  launchpad: { size: "md" },
  backend: { plugin: "mcstudio" },
  commands: [{ id: "mcstudio.open", title: "Ouvrir Mod Studio", run: "navigate" }],
});
