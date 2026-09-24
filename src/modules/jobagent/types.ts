/** Formes échangées avec le moteur Python. Le backend Rust ne fait que les transporter. */

/** Une annonce, telle que la renvoie le moteur. */
export type Offer = {
  id: string;
  source: string;
  source_label: string;
  title: string;
  company: string | null;
  url: string;
  apply_url: string | null;
  company_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  location: string | null;
  remote: boolean;
  contract: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  posted: string | null;
  education: EducationLevel | null;
  education_label: string | null;
  description: string | null;
  emails: string[];
  /** Adresse trouvée chez l'entreprise quand la recherche l'a demandé. */
  recruiter_email?: string | null;
  recruiter_emails?: string[];
  /** `annonce` : l'adresse venait déjà de l'offre. `site` : trouvée sur le site. */
  recruiter_source?: "annonce" | "site" | null;
  /** Position sur la carte, posée par le moteur à partir de la ville ou du pays. */
  latitude: number | null;
  longitude: number | null;
  /** `city` quand la ville a été reconnue, `country` quand on retombe sur le pays. */
  geo: "city" | "country" | null;
  domain: string | null;
  found_at: string;
};

export type EducationLevel = "none" | "cap" | "bac" | "bac2" | "bac3" | "bac5" | "phd";

export type SearchRequest = {
  domains: string[];
  countries: string[];
  cities: string[];
  sites: string[];
  education: EducationLevel[];
  include_unknown_education: boolean;
  /** Types de contrat retenus ; vide = tous. */
  contracts: string[];
  remote: boolean;
  hours_old: number | null;
  results_per_query: number;
  fetch_description: boolean;
  /** Chercher, chez chaque entreprise, une adresse à qui écrire en direct. */
  find_recruiter: boolean;
  sort: "date" | "company" | "domain" | "education";
};

export type EngineStatus = {
  ready: boolean;
  python: string | null;
  python_version: string | null;
  missing: string[];
  /** La bibliothèque du serveur MCP est installée. */
  mcp: boolean;
  /** Les outils de recherche sont branchés sur les agents d'ARCHIMED. */
  mcp_enabled: boolean;
  home: string;
};

/** Plateformes, pays et niveaux acceptés, lus depuis le moteur. */
export type Sources = {
  sites: Array<{ id: string; label: string; countries: string[] | "all" }>;
  /** `id` part vers les plateformes (en anglais), `code` sert à l'afficher en français. */
  countries: Array<{ id: string; code: string }>;
  education: Array<{ id: EducationLevel; label: string }>;
  contracts: string[];
};

/** Langues de CV gérées par le module. */
export const CV_LANGUAGES = ["fr", "en"] as const;
export type CvLanguage = (typeof CV_LANGUAGES)[number];

/** Un CV importé : le fichier d'origine et son texte extrait. */
export type CvEntry = {
  file?: string;
  name?: string;
  pages?: number | null;
  imported_at?: string;
  text?: string;
};

export type Profile = {
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  links?: string;
  notes?: string;
  /** Un CV par langue : l'anglais sert aux annonces hors zone francophone. */
  cvs?: Partial<Record<CvLanguage, CvEntry>>;
};

/** Suivi d'une candidature préparée depuis le module. */
export type Application = {
  offerId: string;
  title: string;
  company: string | null;
  url: string;
  status: "draft" | "sent" | "answered" | "rejected";
  letter?: string;
  email?: string;
  /** Date du message envoyé au contact direct, pour ne pas le relancer deux fois. */
  directSentAt?: string;
  updatedAt: string;
};

export type JobAgentState = {
  offers: Offer[];
  starred: string[];
  /** Offres écartées : elles disparaissent et ne reviennent pas aux recherches suivantes. */
  dismissed: string[];
  /** Offres déjà ouvertes, pour ne passer en revue que ce qui reste. */
  seen: string[];
  applications: Application[];
  lastRequest?: SearchRequest;
  lastRunAt?: string;
  /** Ancien nom de `dismissed` (état écrit avant la revue par lots). */
  hidden?: string[];
};

/** Compte d'envoi des candidatures. Le mot de passe ne remonte jamais jusqu'ici. */
export type MailSettings = {
  from?: string;
  reply_to?: string;
  host?: string;
  port?: number;
  ssl?: boolean;
  starttls?: boolean;
  user?: string;
  signature?: string;
  /** Un mot de passe est enregistré (chiffré par Windows). */
  has_password?: boolean;
  /** Saisi dans le formulaire, envoyé une seule fois puis oublié. */
  password?: string;
};

/** Étape d'une candidature dans un envoi par lot. */
export type BatchStatus =
  | "pending"
  | "writing"
  | "ready"
  | "sending"
  | "sent"
  | "failed"
  | "skipped";

/** Un message du lot : la candidature, ou le mot au contact trouvé dans l'entreprise. */
export type BatchChannel = "offer" | "direct";

export type BatchItem = {
  /** `${offer.id}:${channel}` — une annonce peut donner deux messages. */
  key: string;
  offer: Offer;
  channel: BatchChannel;
  status: BatchStatus;
  /** Destinataire. Sans adresse, la candidature ne peut pas partir seule. */
  to: string | null;
  subject?: string;
  body?: string;
  error?: string;
};

export type LetterKind = "letter" | "email" | "answer";

export type LetterResult = {
  text: string;
  input_tokens: number;
  output_tokens: number;
};

/** Avancement d'une recherche, émis par le moteur pendant l'exécution. */
export type SearchProgress = {
  event: "started" | "progress";
  done?: number;
  total?: number;
  queries?: number;
  message?: string;
};
