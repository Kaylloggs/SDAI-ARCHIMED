import { FileCode2, FolderOpen, Globe, MessagesSquare, MousePointerClick, Search } from "lucide-react";
import { defineTutorial } from "@/core/modules";

export default defineTutorial({
  summary: "Ouvrir un projet, lire et modifier son code, avec une IA à côté qui connaît le projet.",
  steps: [
    {
      icon: FolderOpen,
      title: "Ouvrir un dossier",
      text: "Choisissez le dossier du projet : son arborescence s'affiche à gauche.",
      area: "left",
    },
    {
      icon: FileCode2,
      title: "Lire et modifier un fichier",
      text: "Un clic ouvre le fichier dans un onglet. Modifiez-le, puis enregistrez.",
      area: "center",
      keys: ["Ctrl", "S"],
    },
    {
      icon: Search,
      title: "Trouver un fichier",
      text: "Cherchez un fichier par son nom dans tout le projet.",
      area: "top",
      keys: ["Ctrl", "P"],
    },
    {
      icon: MessagesSquare,
      title: "Demander à l'IA",
      text: "Le panneau de droite est une conversation liée au projet. Décrivez ce que vous voulez changer.",
      area: "right",
    },
    {
      icon: MousePointerClick,
      title: "Désigner un fichier",
      text: "Glissez un fichier de l'arborescence vers la zone de saisie : l'IA sait lequel modifier.",
      area: "right",
    },
    {
      icon: Globe,
      title: "Voir le résultat",
      text: "Le bouton globe ouvre l'aperçu d'un site lancé par l'IA ou d'une page HTML du projet.",
      area: "right",
    },
  ],
  tips: [
    "Les fichiers ouverts se mettent à jour seuls quand l'IA les modifie.",
    "Double-cliquez sur la séparation entre deux panneaux pour lui rendre sa taille.",
  ],
});
