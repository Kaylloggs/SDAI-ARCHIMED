import { MousePointerClick, Sparkles } from "lucide-react";
import { defineTutorial } from "@/core/modules";

/**
 * Tutoriel affiché par le module Tutoriel. Trois à sept étapes, dans l'ordre où on les fait :
 * un verbe au début du titre, une ou deux phrases, la zone de l'écran concernée.
 */
export default defineTutorial({
  summary: "Décrire en une phrase ce que la personne peut faire avec __PASCAL__.",
  steps: [
    {
      icon: Sparkles,
      title: "Ouvrir __PASCAL__",
      text: "Cliquez sur son icône dans le menu de gauche.",
      area: "rail",
    },
    {
      icon: MousePointerClick,
      title: "Faire la première action",
      text: "Expliquer le geste principal du module, avec les mots affichés à l'écran.",
      area: "center",
    },
  ],
  tips: ["Une astuce utile, facultative."],
});
