import { Boxes, FolderDown, ToggleRight } from "lucide-react";
import { defineTutorial } from "@/core/modules";

export default defineTutorial({
  summary: "Gérer les compétences (skills) de vos assistants : les importer, les activer, les utiliser.",
  steps: [
    {
      icon: FolderDown,
      title: "Importer un skill",
      text: "Ajoutez le dossier d'un skill à la bibliothèque, ou ouvrez la bibliothèque pour en déposer plusieurs.",
      area: "top",
    },
    {
      icon: ToggleRight,
      title: "L'activer pour un assistant",
      text: "Activé, le skill est relié à l'assistant choisi : il le voit dès sa prochaine conversation.",
      area: "center",
    },
    {
      icon: Boxes,
      title: "L'utiliser dans le chat",
      text: "« Utiliser un skill », dans la zone de saisie, l'ajoute à votre message.",
      area: "bottom",
    },
  ],
  tips: ["Un skill désactivé reste dans la bibliothèque, prêt à resservir."],
});
