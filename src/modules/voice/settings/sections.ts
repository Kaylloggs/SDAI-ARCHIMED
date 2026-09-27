import { AudioLines, Bot, Download, History, MessageCircle, Mic, ShieldCheck, SlidersHorizontal, type LucideIcon } from "lucide-react";

export type SectionId = "session" | "history" | "general" | "audio" | "engines" | "intelligence" | "installs" | "privacy";

export type SectionInfo = { id: SectionId; label: string; icon: LucideIcon; description: string };

export const SECTION_GROUPS: Array<{ title: string; sections: SectionInfo[] }> = [
  {
    title: "Conversation",
    sections: [
      { id: "session", label: "Session en cours", icon: MessageCircle, description: "La conversation vocale en direct, ses tâches et ses contrôles." },
      { id: "history", label: "Historique", icon: History, description: "Les sessions terminées : relire, reprendre ou supprimer." },
    ],
  },
  {
    title: "Réglages",
    sections: [
      { id: "general", label: "Général", icon: SlidersHorizontal, description: "Langue, micro, mot d'éveil, raccourcis et pastille." },
      { id: "audio", label: "Micro et son", icon: Mic, description: "Micro, sensibilité, annulation d'écho et sortie audio." },
      { id: "engines", label: "Moteurs", icon: AudioLines, description: "Ce qui transcrit votre voix et ce qui lit les réponses." },
      { id: "intelligence", label: "Intelligence", icon: Bot, description: "Qui répond, ce qu'il peut faire, et les outils d'ARCHIMED pour les agents." },
      { id: "installs", label: "Installations", icon: Download, description: "Tout ce que la voix peut utiliser, à installer en un clic." },
      { id: "privacy", label: "Confidentialité", icon: ShieldCheck, description: "Ce qui reste sur l'ordinateur, ce qui part en ligne, et les permissions." },
    ],
  },
];

export const SECTIONS: SectionInfo[] = SECTION_GROUPS.flatMap((g) => g.sections);

export const isSection = (value: unknown): value is SectionId => SECTIONS.some((s) => s.id === value);
