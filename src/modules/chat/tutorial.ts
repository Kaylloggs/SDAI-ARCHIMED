import { Bot, FolderOpen, Paperclip, ShieldCheck, SquarePen, Zap } from "lucide-react";
import { defineTutorial } from "@/core/modules";

export default defineTutorial({
  summary: "Converser avec Claude Code, Antigravity ou Codex, qui peuvent lire et modifier vos fichiers.",
  steps: [
    {
      icon: SquarePen,
      title: "Démarrer une conversation",
      text: "« Nouvelle conversation », en haut de la liste de gauche. Vos conversations restent enregistrées.",
      area: "left",
    },
    {
      icon: Bot,
      title: "Choisir l'assistant et le modèle",
      text: "Sous la zone de saisie : Claude, Antigravity ou Codex, puis le modèle. Un assistant non installé est grisé, avec l'aide pour l'installer.",
      area: "bottom",
    },
    {
      icon: FolderOpen,
      title: "Donner un dossier de travail",
      text: "Le bouton dossier dit à l'IA où elle travaille. Elle y lit et écrit les fichiers, comme dans un terminal.",
      area: "bottom",
    },
    {
      icon: Paperclip,
      title: "Joindre des fichiers",
      text: "Le trombone ajoute des PDF, des images ou des documents. Vous pouvez aussi les glisser depuis l'Explorateur, ou les coller avec Ctrl+V (fichiers copiés, capture d'écran).",
      area: "bottom",
    },
    {
      icon: ShieldCheck,
      title: "Répondre aux demandes de l'IA",
      text: "Avant d'agir, l'IA affiche une carte qui montre ce qui va changer. Autorisez, refusez ou modifiez.",
      area: "center",
    },
    {
      icon: Zap,
      title: "Régler le Mode Auto",
      text: "Désactivé, tout vous est demandé. Intelligent, les actions sans risque passent seules. Les actions critiques sont toujours demandées.",
      area: "bottom",
    },
  ],
  tips: [
    "Entrée envoie, Maj + Entrée passe à la ligne.",
    "Échap arrête l'IA en pleine réponse ; le message suivant reprend la même conversation.",
    "Le micro dicte votre message avec la reconnaissance vocale de Windows, sans consommer de tokens.",
  ],
});
