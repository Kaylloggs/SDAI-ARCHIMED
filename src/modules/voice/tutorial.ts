import { AudioLines, Cpu, Mic, ShieldCheck, Speech, Workflow } from "lucide-react";
import { defineTutorial } from "@/core/modules";

export default defineTutorial({
  summary: "Parler à ARCHIMED : il écoute, répond à voix haute, agit dans vos modules et confie les longues tâches aux agents.",
  steps: [
    {
      icon: Mic,
      title: "Ouvrir le micro",
      text: "Cliquez sur le micro de la pastille, en haut à côté de la recherche, ou utilisez le raccourci. Le laiton signifie : le micro écoute.",
      area: "top",
      keys: ["Ctrl", "Maj", "Espace"],
    },
    {
      icon: AudioLines,
      title: "Parler naturellement",
      text: "Demandez une action, une explication ou une recherche. Vous pouvez couper la parole à l'assistant : il se tait et vous écoute.",
      area: "top",
    },
    {
      icon: Workflow,
      title: "Confier une longue tâche",
      text: "« Crée le projet et lance les tests » : un agent s'en charge en arrière-plan, et vous prévient à la fin. Changez de module, la voix continue.",
      area: "center",
    },
    {
      icon: ShieldCheck,
      title: "Répondre aux confirmations",
      text: "Avant une action sensible, l'assistant demande : dites « oui », « oui toujours » ou « non », ou cliquez sur le bouton.",
      area: "top",
    },
    {
      icon: Speech,
      title: "Choisir les voix et moteurs",
      text: "Dans Voice, choisissez la reconnaissance et la voix, sur l'ordinateur ou en ligne. Chaque étape affiche où partent vos données.",
      area: "left",
    },
    {
      icon: Cpu,
      title: "Travailler hors ligne",
      text: "Installations › « Tout installer » met en place Whisper et Piper choisis pour votre machine. Avec eux, rien ne quitte l'ordinateur.",
      area: "center",
    },
  ],
  tips: [
    "« Stop », « attends », « continue », « répète », « plus lentement » : ces commandes agissent tout de suite, sans modèle.",
    "« Qu'est-ce que tu fais ? » résume le travail en cours des agents.",
    "« Travaille en mode local » bascule la reconnaissance et la voix sur l'ordinateur.",
    "« Termine la session » : l'agent oublie le contexte, l'historique reste dans Voice.",
  ],
});
