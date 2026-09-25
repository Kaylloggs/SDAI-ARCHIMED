import {
  CircleHelp,
  LayoutGrid,
  MessagesSquare,
  PanelLeft,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { defineTutorial } from "@/core/modules";

/** Visite de l'application : ce qu'il faut savoir avant d'ouvrir un module. */
export default defineTutorial({
  summary: "Le tour de l'application en huit étapes : où cliquer, comment parler aux IA, comment garder la main.",
  steps: [
    {
      icon: Sparkles,
      title: "Découvrir ARCHIMED",
      text: "Vos assistants d'IA (Claude Code, Antigravity, Codex) et vos outils dans une seule fenêtre. Chaque outil est un module.",
      area: "center",
    },
    {
      icon: PanelLeft,
      title: "Changer de module",
      text: "Chaque icône du menu de gauche ouvre un module. Le bouton tout en bas déploie le menu pour afficher leurs noms.",
      area: "rail",
    },
    {
      icon: LayoutGrid,
      title: "Revenir à l'accueil",
      text: "Le logo en haut du menu ramène à l'accueil : tous vos modules en tuiles et vos dernières conversations.",
      area: "rail",
    },
    {
      icon: Search,
      title: "Tout trouver au clavier",
      text: "Ctrl K ouvre la recherche. Tapez le nom d'un module ou d'une action, puis Entrée.",
      area: "top",
      keys: ["Ctrl", "K"],
    },
    {
      icon: MessagesSquare,
      title: "Parler à une IA",
      text: "Dans Chat, choisissez l'assistant et le dossier de travail sous la zone de saisie, puis écrivez votre demande.",
      area: "bottom",
    },
    {
      icon: ShieldCheck,
      title: "Garder la main",
      text: "Avant de modifier un fichier ou de lancer une commande, l'IA vous montre une carte : vous autorisez ou vous refusez.",
      area: "center",
    },
    {
      icon: SlidersHorizontal,
      title: "Régler l'application",
      text: "Réglages, en bas du menu : thème, assistants installés, économie de tokens et modules.",
      area: "rail",
    },
    {
      icon: CircleHelp,
      title: "Retrouver l'aide",
      text: "Le point d'interrogation à côté du nom d'un module, en haut, ouvre son tutoriel ici.",
      area: "top",
    },
  ],
  tips: [
    "Un module qui ne vous sert pas se désactive ou se supprime dans Réglages › Modules. Supprimé, ses données partent à la Corbeille et il se remet quand vous voulez.",
    "Le Mode Auto accepte seul les actions sans risque. Les actions critiques vous sont toujours demandées.",
  ],
});
