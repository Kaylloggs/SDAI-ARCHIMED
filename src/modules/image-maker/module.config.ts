import { lazy } from "react";
import { ImagePlus } from "lucide-react";
import { defineModule } from "@/core/modules";
import tutorial from "./tutorial";

export default defineModule({
  id: "image-maker",
  name: "Image Maker",
  description: "Studio d'images assisté par IA : créer, retoucher une zone, étendre, améliorer, varier, exporter.",
  version: "0.1.0",
  icon: ImagePlus,
  // Catégorie Création, juste après Mod Studio (order 20).
  category: "creative",
  order: 22,
  enabledByDefault: true,
  page: lazy(() => import("./index")),
  launchpad: { size: "md" },
  backend: { plugin: "image-maker" },
  provides: {
    // Service offert aux autres modules : voir `services/image.ts` et le README.
    "image.maker": () => import("./services/image"),
  },
  commands: [
    { id: "image-maker.open", title: "Ouvrir Image Maker", run: "navigate" },
  ],
  tutorial,
});
