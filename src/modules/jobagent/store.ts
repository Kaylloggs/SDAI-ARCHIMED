import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { jobagentApi, SEARCH_PROGRESS } from "./api";
import { buildBatch } from "./lib/batch";
import { cvFor } from "./lib/cv";
import { isSent, withoutSent } from "./lib/triage";
import type {
  Application,
  BatchItem,
  CvLanguage,
  EngineStatus,
  JobAgentState,
  Offer,
  Profile,
  MailSettings,
  SearchProgress,
  SearchRequest,
  Sources,
} from "./types";

/** Recherche par défaut : ce que voit quelqu'un qui ouvre le module pour la première fois. */
export const DEFAULT_REQUEST: SearchRequest = {
  domains: [],
  countries: ["france"],
  cities: [],
  sites: ["hellowork", "welcometothejungle", "indeed", "linkedin"],
  education: [],
  include_unknown_education: true,
  contracts: [],
  remote: false,
  hours_old: 24 * 14,
  results_per_query: 20,
  fetch_description: false,
  find_recruiter: false,
  sort: "date",
};

type Store = {
  status: EngineStatus | null;
  sources: Sources | null;
  request: SearchRequest;
  offers: Offer[];
  starred: string[];
  dismissed: string[];
  seen: string[];
  applications: Application[];
  /**
   * Dernière suppression, le temps d'annuler. `order` garde l'ordre de la liste d'avant :
   * les annonces rendues reprennent leur place exacte, pas une place recalculée.
   */
  undo: { offers: Offer[]; order: string[]; at: number } | null;
  /** Envoi par lot en préparation ou en cours. */
  batch: BatchItem[];
  batchRunning: boolean;
  mail: MailSettings | null;
  profile: Profile;
  loaded: boolean;
  searching: boolean;
  progress: { done: number; total: number; message: string } | null;
  error: string | null;
  lastRunAt: string | null;

  load: () => Promise<void>;
  refreshStatus: () => Promise<EngineStatus | null>;
  setRequest: (patch: Partial<SearchRequest>) => void;
  runSearch: () => Promise<void>;
  cancelSearch: () => Promise<void>;
  toggleStar: (id: string) => void;
  /** Met ou retire plusieurs annonces des favoris d'un coup. */
  setStarred: (ids: string[], on: boolean) => void;
  dismissOffer: (id: string) => void;
  undoDismiss: () => void;
  dismissMany: (ids: string[]) => void;
  markSeen: (id: string) => void;
  markAllSeen: (ids: string[]) => void;
  prepareBatch: (offers: Offer[]) => void;
  clearBatch: () => void;
  runBatch: () => Promise<void>;
  loadMail: () => Promise<void>;
  saveMail: (settings: MailSettings) => Promise<void>;
  saveProfile: (patch: Profile) => Promise<void>;
  importCv: (path: string, language: CvLanguage) => Promise<void>;
  clearCv: (language: CvLanguage) => Promise<void>;
  upsertApplication: (application: Application) => void;
};

let unlisten: (() => void) | null = null;

export const useJobAgentStore = create<Store>((set, get) => ({
  status: null,
  sources: null,
  request: DEFAULT_REQUEST,
  offers: [],
  starred: [],
  dismissed: [],
  seen: [],
  applications: [],
  undo: null,
  batch: [],
  batchRunning: false,
  mail: null,
  profile: {},
  loaded: false,
  searching: false,
  progress: null,
  error: null,
  lastRunAt: null,

  async load() {
    const [state, profile] = await Promise.all([
      jobagentApi.loadState().catch(() => null),
      jobagentApi.loadProfile().catch(() => ({}) as Profile),
    ]);
    set({
      offers: state?.offers ?? [],
      // Une candidature partie quitte les favoris : l'état écrit avant cette règle
      // est remis d'aplomb au chargement.
      starred: withoutSent(state?.starred ?? [], state?.applications ?? []),
      // `hidden` : nom de l'état d'avant la revue par lots.
      dismissed: state?.dismissed ?? state?.hidden ?? [],
      seen: state?.seen ?? [],
      applications: state?.applications ?? [],
      request: migrateRequest(state?.lastRequest),
      lastRunAt: state?.lastRunAt ?? null,
      profile,
      loaded: true,
    });

    // L'avancement arrive pendant la recherche, une ligne par plateforme interrogée.
    if (!unlisten) {
      unlisten = await listen<SearchProgress>(SEARCH_PROGRESS, (event) => {
        const payload = event.payload;
        if (payload.event === "started") {
          set({ progress: { done: 0, total: payload.queries ?? 0, message: "" } });
          return;
        }
        set({
          progress: {
            done: payload.done ?? 0,
            total: payload.total ?? 0,
            message: payload.message ?? "",
          },
        });
      });
    }

    void get().loadMail();

    const status = await get().refreshStatus();
    // Les listes de plateformes et de pays viennent du moteur : inutile de les figer ici.
    if (status?.ready) {
      const sources = await jobagentApi.sources().catch(() => null);
      if (sources) set({ sources });
    }
  },

  async refreshStatus() {
    const status = await jobagentApi.status().catch(() => null);
    set({ status });
    return status;
  },

  setRequest(patch) {
    set({ request: { ...get().request, ...patch } });
  },

  async runSearch() {
    const { request } = get();
    if (!request.domains.length) {
      set({ error: "Ajoutez au moins un domaine à chercher." });
      return;
    }
    set({ searching: true, error: null, progress: null });
    try {
      const found = await jobagentApi.search(request);
      // Une annonce écartée ne revient pas d'une recherche à l'autre.
      const dismissed = new Set(get().dismissed);
      const offers = found.filter((offer) => !dismissed.has(offer.id));
      const lastRunAt = new Date().toISOString();
      set({ offers, lastRunAt, searching: false, progress: null });
      await persist(get());
    } catch (error) {
      set({
        searching: false,
        progress: null,
        error: (error as { message?: string }).message ?? "Recherche impossible",
      });
    }
  },

  async cancelSearch() {
    await jobagentApi.cancelSearch().catch(() => undefined);
    set({ searching: false, progress: null });
  },

  toggleStar(id) {
    const starred = get().starred.includes(id)
      ? get().starred.filter((value) => value !== id)
      : [...get().starred, id];
    set({ starred });
    void persist(get());
  },

  setStarred(ids, on) {
    if (!ids.length) return;
    const current = new Set(get().starred);
    for (const id of ids) {
      if (on) current.add(id);
      else current.delete(id);
    }
    set({ starred: [...current] });
    void persist(get());
  },

  dismissOffer(id) {
    get().dismissMany([id]);
  },

  undoDismiss() {
    const undo = get().undo;
    if (!undo) return;
    // Chaque annonce retrouve sa place d'origine. Celles arrivées entre-temps (nouvelle
    // recherche) restent à la suite, sans rien perdre.
    const restored = new Map(undo.offers.map((offer) => [offer.id, offer]));
    const current = new Map(get().offers.map((offer) => [offer.id, offer]));
    const known = new Set(undo.order);
    const offers = [
      ...undo.order.flatMap((id) => {
        const offer = current.get(id) ?? restored.get(id);
        return offer ? [offer] : [];
      }),
      ...get().offers.filter((offer) => !known.has(offer.id)),
    ];
    set({
      offers,
      dismissed: get().dismissed.filter((value) => !restored.has(value)),
      undo: null,
    });
    void persist(get());
  },

  dismissMany(ids) {
    if (!ids.length) return;
    const removed = new Set(ids);
    const before = get().offers;
    set({
      offers: before.filter((item) => !removed.has(item.id)),
      dismissed: [...new Set([...get().dismissed, ...ids])],
      undo: {
        offers: before.filter((item) => removed.has(item.id)),
        order: before.map((item) => item.id),
        at: Date.now(),
      },
    });
    void persist(get());
  },

  markSeen(id) {
    if (get().seen.includes(id)) return;
    set({ seen: [...get().seen, id] });
    void persist(get());
  },

  markAllSeen(ids) {
    const known = new Set(get().seen);
    const added = ids.filter((id) => !known.has(id));
    if (!added.length) return;
    set({ seen: [...get().seen, ...added] });
    void persist(get());
  },

  /**
   * Prépare un lot de candidatures. Rien ne part encore : l'interface montre la liste,
   * les destinataires et l'expéditeur, et attend l'accord de la personne.
   */
  prepareBatch(offers) {
    set({ batch: buildBatch(offers, get().applications) });
  },

  clearBatch() {
    set({ batch: [], batchRunning: false });
  },

  /** Écrit puis envoie chaque candidature du lot, une par une. */
  async runBatch() {
    if (get().batchRunning) return;
    set({ batchRunning: true });

    const patch = (key: string, change: Partial<BatchItem>) => {
      set({
        batch: get().batch.map((item) => (item.key === key ? { ...item, ...change } : item)),
      });
    };

    /** Annonces dont la candidature est partie pendant ce lot. */
    const justSent = new Set<string>();
    const failed = new Set<string>();

    for (const item of get().batch) {
      if (!get().batchRunning) break; // arrêt demandé
      if (item.status !== "pending" || !item.to) continue;

      // Le message direct annonce une candidature déjà déposée : si elle n'est pas
      // partie, il ne part pas non plus plutôt que de raconter n'importe quoi.
      if (item.channel === "direct" && failed.has(item.offer.id)) {
        patch(item.key, { status: "skipped", error: "candidature non partie" });
        continue;
      }

      const { profile, applications } = get();
      const { language, cv } = cvFor(item.offer, profile);
      const record = applications.find((entry) => entry.offerId === item.offer.id);
      const applied =
        justSent.has(item.offer.id) ||
        record?.status === "sent" ||
        record?.status === "answered";
      patch(item.key, { status: "writing" });

      let subject = item.subject;
      let body = item.body;
      try {
        if (!body) {
          const written = await jobagentApi.writeLetter({
            kind: "email",
            offer: item.offer,
            cv: cv?.text ?? null,
            notes: profile.notes ?? null,
            language,
            direct_contact: item.channel === "direct",
            already_applied: item.channel === "direct" && applied,
          });
          const [head, ...rest] = written.text.split("\n");
          subject = (head ?? "").replace(/^objet\s*:\s*/i, "").trim() || defaultSubject(item.offer);
          body = rest.join("\n").trim() || written.text;
          if (profile.name) body = `${body}\n\n${profile.name}`;
        }
        patch(item.key, { status: "ready", subject, body });
      } catch (error) {
        if (item.channel === "offer") failed.add(item.offer.id);
        patch(item.key, {
          status: "failed",
          error: (error as { message?: string }).message ?? "rédaction impossible",
        });
        continue;
      }

      patch(item.key, { status: "sending" });
      try {
        await jobagentApi.sendApplication({
          to: item.to,
          subject: subject ?? defaultSubject(item.offer),
          body: body ?? "",
          attachments: cv?.file ? [cv.file] : [],
        });
        patch(item.key, { status: "sent" });
        if (item.channel === "offer") justSent.add(item.offer.id);
        const previous = get().applications.find((entry) => entry.offerId === item.offer.id);
        get().upsertApplication({
          offerId: item.offer.id,
          title: item.offer.title,
          company: item.offer.company,
          url: item.offer.url,
          status: item.channel === "offer" ? "sent" : (previous?.status ?? "draft"),
          email: item.channel === "offer" ? body : previous?.email,
          directSentAt:
            item.channel === "direct" ? new Date().toISOString() : previous?.directSentAt,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        if (item.channel === "offer") failed.add(item.offer.id);
        patch(item.key, {
          status: "failed",
          error: (error as { message?: string }).message ?? "envoi impossible",
        });
      }
    }

    set({ batchRunning: false });
  },

  async loadMail() {
    const mail = await jobagentApi.mailSettings().catch(() => null);
    set({ mail });
  },

  async saveMail(settings) {
    const mail = await jobagentApi.saveMailSettings(settings);
    set({ mail });
  },

  async saveProfile(patch) {
    const profile = { ...get().profile, ...patch };
    set({ profile });
    await jobagentApi.saveProfile(profile);
  },

  async importCv(path, language) {
    const profile = await jobagentApi.importCv(path, language);
    set({ profile });
  },

  async clearCv(language) {
    const profile = await jobagentApi.clearCv(language);
    set({ profile });
  },

  upsertApplication(application) {
    const others = get().applications.filter((item) => item.offerId !== application.offerId);
    // Une candidature partie n'a plus rien à faire dans les favoris : elle se suit dans
    // l'onglet « Candidatures ».
    const starred = isSent(application)
      ? get().starred.filter((id) => id !== application.offerId)
      : get().starred;
    set({ applications: [application, ...others], starred });
    void persist(get());
  },
}));

/** Sauvegarde l'état sur disque (offres, favoris, candidatures, dernière recherche). */
async function persist(state: Store) {
  const payload: JobAgentState = {
    offers: state.offers,
    starred: state.starred,
    dismissed: state.dismissed,
    seen: state.seen,
    applications: state.applications,
    lastRequest: state.request,
    lastRunAt: state.lastRunAt ?? undefined,
  };
  await jobagentApi.saveState(payload).catch(() => undefined);
}

/** Recherche enregistrée par une version précédente : un seul contrat était possible. */
function migrateRequest(saved: Partial<SearchRequest> & { contract?: string | null } = {}) {
  const { contract, ...rest } = saved;
  const request = { ...DEFAULT_REQUEST, ...rest };
  if (contract && !request.contracts.length) request.contracts = [contract];
  return request;
}

/** Objet de repli quand la lettre n'en propose pas. */
function defaultSubject(offer: Offer): string {
  return offer.company
    ? `Candidature — ${offer.title} (${offer.company})`
    : `Candidature — ${offer.title}`;
}
