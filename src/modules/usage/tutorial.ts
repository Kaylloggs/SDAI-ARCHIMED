import { BarChart3, Gauge, RefreshCw } from "lucide-react";
import { defineTutorial } from "@/core/modules";

export default defineTutorial({
  summary: "Voir ce qu'il reste sur votre abonnement Claude et ce que consomment vos assistants.",
  steps: [
    {
      icon: Gauge,
      title: "Lire vos limites Claude",
      text: "Fenêtre de 5 heures et semaine glissante : pourcentage utilisé et heure de remise à zéro.",
      area: "center",
    },
    {
      icon: RefreshCw,
      title: "Actualiser",
      text: "Claude ne donne ses limites qu'en répondant : « Actualiser » envoie un message très court, pour quelques tokens.",
      area: "top",
    },
    {
      icon: BarChart3,
      title: "Suivre la consommation",
      text: "Réponses, tokens et coût estimé par assistant et par jour, sur 24 heures, 7 ou 30 jours.",
      area: "center",
    },
  ],
  tips: ["Avec un abonnement, le coût affiché est un équivalent : il ne vous est pas facturé en plus."],
});
