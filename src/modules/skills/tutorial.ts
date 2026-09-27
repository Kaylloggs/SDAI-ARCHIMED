import { Boxes, FlaskConical, FolderDown, ShieldCheck, Sparkles, ToggleRight } from "lucide-react";
import { defineTutorial } from "@/core/modules";

export default defineTutorial({
  summary: "Créer, importer, activer et utiliser les compétences (skills) de vos assistants.",
  steps: [
    {
      icon: Sparkles,
      title: "Créer un skill avec l'atelier",
      text: "« Créer un skill » : décrivez ce qu'il doit faire, ou partez d'une conversation réussie. Une IA l'écrit et vous pose ses questions si besoin.",
      area: "top",
    },
    {
      icon: ShieldCheck,
      title: "Le vérifier",
      text: "L'onglet Vérification signale ce qui empêcherait une IA de s'en servir. « Corriger avec l'IA » lui renvoie la liste.",
      area: "right",
    },
    {
      icon: FlaskConical,
      title: "L'essayer",
      text: "Chaque demande de test part dans une conversation neuve qui dispose du skill. Donnez votre avis, puis renvoyez-le à l'atelier.",
      area: "right",
    },
    {
      icon: FolderDown,
      title: "Ou importer un skill",
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
  tips: [
    "Rien n'entre dans la bibliothèque avant « Enregistrer » : un brouillon se reprend plus tard depuis la liste des skills.",
    "« Améliorer » ouvre une copie d'un skill dans l'atelier ; l'onglet Modifications montre ce qui change.",
    "Un skill désactivé reste dans la bibliothèque, prêt à resservir.",
  ],
});
