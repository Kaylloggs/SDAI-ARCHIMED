import { Leaf, Palette, Terminal, ToggleRight, Trash2 } from "lucide-react";
import { defineTutorial } from "@/core/modules";

export default defineTutorial({
  summary: "Régler l'apparence, les assistants d'IA, la consommation de tokens et les modules.",
  steps: [
    {
      icon: Palette,
      title: "Choisir un thème",
      text: "Six thèmes de couleurs, appliqués à toute l'application.",
      area: "center",
    },
    {
      icon: Terminal,
      title: "Vérifier les assistants",
      text: "Claude Code, Antigravity et Codex sont détectés seuls. Indiquez un chemin si l'un d'eux est installé ailleurs.",
      area: "center",
    },
    {
      icon: Leaf,
      title: "Économiser des tokens",
      text: "Réponses plus courtes, moins de réflexion, contexte allégé : la consommation baisse.",
      area: "center",
    },
    {
      icon: ToggleRight,
      title: "Désactiver un module",
      text: "Un module désactivé quitte le menu et garde toutes ses données.",
      area: "center",
    },
    {
      icon: Trash2,
      title: "Supprimer un module",
      text: "La corbeille le retire de l'application et met ses données à la Corbeille. Il se remet depuis « Modules supprimés ».",
      area: "center",
    },
  ],
});
