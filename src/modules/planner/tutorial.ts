import { CalendarDays, CalendarPlus, FileText, Hand, KanbanSquare, Plus } from "lucide-react";
import { defineTutorial } from "@/core/modules";

export default defineTutorial({
  summary: "Organiser vos tâches en tableaux, colonnes et cartes, avec échéances et roadmaps de projet.",
  steps: [
    {
      icon: KanbanSquare,
      title: "Créer un tableau",
      text: "« Nouveau tableau », dans la liste de gauche. Créez-en un par projet ou par sujet.",
      area: "left",
    },
    {
      icon: Plus,
      title: "Ajouter des cartes",
      text: "Chaque colonne reçoit des cartes : titre, échéance, étiquettes, notes et sous-tâches.",
      area: "center",
    },
    {
      icon: Hand,
      title: "Déplacer une carte",
      text: "Glissez une carte d'une colonne à l'autre pour suivre son avancement.",
      area: "center",
    },
    {
      icon: CalendarDays,
      title: "Passer au calendrier",
      text: "La vue Calendrier place les cartes à leur échéance. Glissez une carte sur un jour pour la dater.",
      area: "top",
    },
    {
      icon: FileText,
      title: "Suivre une roadmap",
      text: "« Lier un fichier roadmap » : quand l'IA coche une tâche dans ce fichier, la carte se coche ici aussi.",
      area: "left",
    },
    {
      icon: CalendarPlus,
      title: "Exporter vers l'agenda",
      text: "Ajoutez une échéance à Google Agenda, ou exportez le tableau en .ics pour Outlook.",
      area: "top",
    },
  ],
  tips: ["Sous une réponse de l'IA qui contient des tâches, « Ajouter au Planner » les range dans le bon tableau."],
});
