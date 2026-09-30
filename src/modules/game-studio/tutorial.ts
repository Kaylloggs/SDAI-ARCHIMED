import { Bot, Boxes, Gamepad2, Hammer, History, ListChecks, Sparkles, Wrench } from "lucide-react";
import { defineTutorial } from "@/core/modules";

/**
 * Tutoriel affiché par le module Tutoriel : de l'idée au projet, puis le suivi.
 */
export default defineTutorial({
  summary: "Décrire un jeu en une phrase, laisser Game Studio en tirer les systèmes et l'architecture, puis créer le projet dans Godot, Unity ou Unreal.",
  steps: [
    {
      icon: Wrench,
      title: "Vérifier votre machine",
      text: "« Votre machine » montre les moteurs trouvés. Il en manque un ? Cliquez sur « Installer », ou sur « Désigner l'exécutable ».",
      area: "center",
    },
    {
      icon: Sparkles,
      title: "Décrire le jeu",
      text: "Cliquez sur « Nouveau jeu » et écrivez l'idée, puis « Analyser l'idée ». Écrivez « sans combat » pour exclure un système.",
      area: "center",
      keys: ["Ctrl", "Entrée"],
    },
    {
      icon: Gamepad2,
      title: "Relire et créer",
      text: "Retirez ou ajoutez des systèmes, corrigez les hypothèses, choisissez le moteur à droite, puis « Créer le jeu ».",
      area: "right",
    },
    {
      icon: Boxes,
      title: "Explorer les systèmes",
      text: "Dans « Systèmes », cliquez sur un système : ses dépendances et ce qui l'utilise s'allument, sa fiche s'ouvre à droite.",
      area: "left",
    },
    {
      icon: ListChecks,
      title: "Suivre le plan",
      text: "« Tâches » liste le plan de départ. Une tâche « Prête » n'attend plus rien : c'est la prochaine à faire.",
      area: "left",
    },
    {
      icon: Bot,
      title: "Confier une tâche à un agent",
      text: "Ouvrez une tâche puis « Confier à l'agent » : la demande arrive prête dans « Agents ». Relisez-la, puis envoyez. Un point de restauration est pris avant.",
      area: "left",
    },
    {
      icon: Hammer,
      title: "Vérifier et lancer le jeu",
      text: "« Build et tests » > « Vérifier le code » : chaque erreur donne son fichier, sa ligne et une piste. En cas d'échec, « Corriger avec l'agent ».",
      area: "left",
    },
    {
      icon: History,
      title: "Prendre un point de restauration",
      text: "Avant un gros changement, « Historique » > « Créer un point de restauration ». « Revenir à ce point » garde toujours l'état d'avant.",
      area: "left",
    },
  ],
  tips: [
    "Le genre ne limite rien : décrivez ce que fait le joueur, Game Studio en déduit les systèmes.",
    "Le graphe, les décisions et le journal vivent dans le dossier .gamestudio du projet, qui reste autonome.",
    "Un projet existant ajouté s'ouvre sur sa carte : systèmes déjà codés et risques, sans rien modifier.",
    "« Documents » montre le GDD et le TDD tirés du graphe ; « Écrire dans docs/ » les enregistre dans le projet.",
  ],
});
