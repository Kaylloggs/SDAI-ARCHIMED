import { Download, FileText, ListFilter, Map, Search, Send } from "lucide-react";
import { defineTutorial } from "@/core/modules";

export default defineTutorial({
  summary: "Chercher des offres d'emploi sur plusieurs sites à la fois, les trier vite et préparer vos candidatures.",
  steps: [
    {
      icon: Download,
      title: "Installer le moteur",
      text: "Au premier usage, « Installer le moteur » prépare la recherche. Il faut Python 3.10 ou plus récent.",
      area: "center",
    },
    {
      icon: Search,
      title: "Lancer une recherche",
      text: "Choisissez métiers, pays, villes, types de contrat et sites : tout est cherché en même temps.",
      area: "left",
    },
    {
      icon: ListFilter,
      title: "Trier les annonces",
      text: "Les onglets À voir, Toutes, Favoris et Candidatures se vident au fil du tri. F met en favori, Suppr supprime.",
      area: "center",
      keys: ["F", "Suppr"],
    },
    {
      icon: Map,
      title: "Voir la carte",
      text: "La carte du monde place un point par ville : plus il y a d'annonces, plus le point est gros.",
      area: "center",
    },
    {
      icon: FileText,
      title: "Préparer une candidature",
      text: "À partir de votre CV, l'IA rédige la lettre, l'e-mail ou les réponses du formulaire.",
      area: "right",
    },
    {
      icon: Send,
      title: "Envoyer par lot",
      text: "Les candidatures prêtes partent ensemble, après une confirmation qui liste chaque destinataire.",
      area: "right",
    },
  ],
  tips: ["↑ et ↓ passent d'une annonce à l'autre.", "Ctrl + Z annule la dernière suppression."],
});
