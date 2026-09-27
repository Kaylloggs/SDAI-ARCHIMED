import {
  AudioLines,
  Bot,
  Cpu,
  Gauge,
  History,
  KeyRound,
  Keyboard,
  MessageCircle,
  Mic,
  MonitorSmartphone,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  Speech,
  UserCheck,
  type LucideIcon,
} from "lucide-react";

export type SectionId =
  | "session"
  | "history"
  | "general"
  | "audio"
  | "stt"
  | "tts"
  | "models"
  | "providers"
  | "agents"
  | "mcp"
  | "shortcuts"
  | "overlay"
  | "privacy"
  | "permissions"
  | "performance";

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
      { id: "general", label: "Général", icon: SlidersHorizontal, description: "Langue, ouverture du micro, mot d'éveil et annonces." },
      { id: "audio", label: "Micro et son", icon: Mic, description: "Micro, sensibilité, annulation d'écho et sortie audio." },
      { id: "stt", label: "Reconnaissance", icon: AudioLines, description: "Le moteur qui transcrit votre voix." },
      { id: "tts", label: "Voix", icon: Speech, description: "Le moteur et la voix qui lisent les réponses." },
      { id: "models", label: "Modèles locaux", icon: Cpu, description: "Modèles installés sur cet ordinateur : reconnaissance, voix, intelligence." },
      { id: "providers", label: "Fournisseurs", icon: KeyRound, description: "Clés des services en ligne et serveurs locaux détectés." },
      { id: "agents", label: "Agents", icon: Bot, description: "Qui répond : une CLI d'IA installée ou un modèle local." },
      { id: "mcp", label: "Serveur MCP", icon: Plug, description: "Les outils d'ARCHIMED pour les agents (parler, lire le contexte, agir)." },
      { id: "shortcuts", label: "Raccourcis", icon: Keyboard, description: "Raccourcis clavier du micro." },
      { id: "overlay", label: "Affichage", icon: MonitorSmartphone, description: "Pastille, animation et sous-titres." },
      { id: "privacy", label: "Confidentialité", icon: ShieldCheck, description: "Ce qui reste sur l'ordinateur, ce qui part en ligne." },
      { id: "permissions", label: "Permissions", icon: UserCheck, description: "Ce que l'assistant peut faire sans demander." },
      { id: "performance", label: "Performances", icon: Gauge, description: "Priorité des moteurs locaux et préchargement." },
    ],
  },
];

export const SECTIONS: SectionInfo[] = SECTION_GROUPS.flatMap((g) => g.sections);

export const isSection = (value: unknown): value is SectionId => SECTIONS.some((s) => s.id === value);
