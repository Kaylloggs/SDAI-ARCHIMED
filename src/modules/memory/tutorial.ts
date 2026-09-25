import { Eye, FileUp, FolderTree, Plus, ToggleRight } from "lucide-react";
import { defineTutorial } from "@/core/modules";

export default defineTutorial({
  summary: "Donner aux IA ce qu'elles doivent savoir sur vous et vos projets, au début de chaque conversation.",
  steps: [
    {
      icon: Plus,
      title: "Ajouter une information",
      text: "Écrivez une préférence ou une règle : « Réponds en français », « Ce projet utilise pnpm ».",
      area: "top",
    },
    {
      icon: FolderTree,
      title: "Choisir sa portée",
      text: "Partout, ou seulement pour un dossier de projet et ses sous-dossiers.",
      area: "center",
    },
    {
      icon: ToggleRight,
      title: "Activer ou mettre de côté",
      text: "L'interrupteur de chaque information décide si elle est transmise. Rien n'est effacé.",
      area: "center",
    },
    {
      icon: FileUp,
      title: "Importer une liste",
      text: "Un fichier .txt, .md ou .json ajoute plusieurs informations d'un coup, après un aperçu.",
      area: "top",
    },
    {
      icon: Eye,
      title: "Vérifier ce que l'IA reçoit",
      text: "L'aperçu montre le texte exact envoyé au premier message d'une conversation.",
      area: "right",
    },
  ],
  tips: ["Rien n'est enregistré automatiquement : la mémoire ne contient que ce que vous écrivez."],
});
