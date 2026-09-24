import { invokeModule } from "@/core/ipc";
import type {
  CvLanguage,
  EngineStatus,
  MailSettings,
  JobAgentState,
  LetterKind,
  LetterResult,
  Offer,
  Profile,
  SearchRequest,
  Sources,
} from "./types";

/** Détail complet d'une annonce, récupéré sur la page d'origine. */
export type OfferDetail = {
  url: string;
  title: string | null;
  company: string | null;
  description: string | null;
  emails: string[];
  apply_url: string | null;
  error?: string;
};

export const jobagentApi = {
  status: () => invokeModule<EngineStatus>("jobagent", "status"),
  installEngine: () => invokeModule<EngineStatus>("jobagent", "install_engine"),
  sources: () => invokeModule<Sources>("jobagent", "sources"),

  search: (request: SearchRequest) =>
    invokeModule<Offer[]>("jobagent", "search", { request }),
  cancelSearch: () => invokeModule<void>("jobagent", "cancel_search"),
  offerDetail: (url: string) =>
    invokeModule<OfferDetail>("jobagent", "offer_detail", { url }),

  loadState: () => invokeModule<JobAgentState>("jobagent", "load_state"),
  saveState: (state: JobAgentState) =>
    invokeModule<void>("jobagent", "save_state", { state }),

  loadProfile: () => invokeModule<Profile>("jobagent", "load_profile"),
  saveProfile: (profile: Profile) =>
    invokeModule<void>("jobagent", "save_profile", { profile }),
  importCv: (path: string, language: CvLanguage) =>
    invokeModule<Profile>("jobagent", "import_cv", { path, language }),
  clearCv: (language: CvLanguage) =>
    invokeModule<Profile>("jobagent", "clear_cv", { language }),

  /** Rédaction par Antigravity (moins cher qu'un tour de chat), style tenu par humanizer. */
  writeLetter: (request: {
    kind: LetterKind;
    offer: Offer;
    cv?: string | null;
    notes?: string | null;
    language?: string | null;
    question?: string | null;
    model?: string | null;
    /** Le message s'adresse à quelqu'un de l'entreprise, pas à l'annonce. */
    direct_contact?: boolean;
    /** La candidature est déjà partie : le message le dit au lieu de l'inventer. */
    already_applied?: boolean;
  }) => invokeModule<LetterResult>("jobagent", "write_letter", { request }),

  /** Enregistre un texte (lettre, mail) à l'endroit choisi. */
  saveText: (path: string, text: string) =>
    invokeModule<void>("jobagent", "save_text", { path, text }),

  /** Compte d'envoi (sans le mot de passe). */
  mailSettings: () => invokeModule<MailSettings>("jobagent", "mail_settings"),
  saveMailSettings: (settings: MailSettings) =>
    invokeModule<MailSettings>("jobagent", "save_mail_settings", { settings }),
  /** Réglages connus pour une adresse : évite de chercher le serveur à la main. */
  smtpHint: (address: string) =>
    invokeModule<{ host: string; port: number; starttls: boolean } | null>(
      "jobagent",
      "smtp_hint",
      { address },
    ),
  /** Envoie une candidature préparée. Le lot est confirmé par la personne avant d'arriver ici. */
  sendApplication: (message: {
    to: string;
    subject: string;
    body: string;
    attachments: string[];
  }) => invokeModule<{ sent: boolean; to: string }>("jobagent", "send_application", { message }),

  /** Branche ou débranche les outils de recherche sur les agents d'ARCHIMED. */
  setMcp: (enabled: boolean) =>
    invokeModule<{ enabled: boolean; path: string; command: string }>("jobagent", "set_mcp", {
      enabled,
    }),
};

/** Lignes de l'installation du moteur Python. */
export const INSTALL_LOG = "jobagent:install";
/** Avancement d'une recherche. */
export const SEARCH_PROGRESS = "jobagent:progress";
