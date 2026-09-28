import { defineActions, findByName, type ActionResult } from "@/core/modules";
import { jobagentApi } from "./api";
import { cvFor } from "./lib/cv";
import { inScope, sentIds, type Scope } from "./lib/triage";
import { useJobAgentStore } from "./store";
import { CV_LANGUAGES, type Application, type CvLanguage, type EducationLevel, type LetterKind, type Offer, type Profile, type SearchRequest } from "./types";

const STATUS: Record<string, string> = { draft: "brouillon", sent: "envoyée", answered: "réponse reçue", rejected: "refusée" };
const SCOPES: Scope[] = ["unseen", "all", "starred", "applied"];
const LETTERS: LetterKind[] = ["letter", "email", "answer"];
const EDUCATION: EducationLevel[] = ["none", "cap", "bac", "bac2", "bac3", "bac5", "phd"];

const store = () => useJobAgentStore.getState();
const s = (n: number) => (n > 1 ? "s" : "");

async function loaded() {
  if (!store().loaded) await store().load();
}

const offerName = (o: Offer) => `${o.title}${o.company ? ` ${o.company}` : ""}`;

/** Annonce désignée par son identifiant ou par son intitulé (et son entreprise). */
function offer(ref: unknown): Offer | null {
  return findByName(store().offers, String(ref ?? ""), offerName, (o) => o.id);
}

function offers(refs: unknown): { found: Offer[]; missing: string[] } {
  const list = Array.isArray(refs) ? refs : typeof refs === "string" ? [refs] : [];
  const found: Offer[] = [];
  const missing: string[] = [];
  for (const ref of list) {
    const match = offer(ref);
    if (match) found.push(match);
    else missing.push(String(ref));
  }
  return { found, missing };
}

const noOffer = (ref: unknown): ActionResult => ({ ok: false, message: `Annonce introuvable ou ambiguë : « ${String(ref)} ». Appelle list_offers.` });

const describeOffer = (o: Offer) => ({
  id: o.id,
  title: o.title,
  company: o.company,
  location: o.location,
  remote: o.remote,
  contract: o.contract,
  education: o.education_label,
  posted: o.posted,
  source: o.source_label,
  url: o.url,
  starred: store().starred.includes(o.id),
});

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.map(String).map((v) => v.trim()).filter(Boolean) : typeof value === "string" ? value.split(",").map((v) => v.trim()).filter(Boolean) : undefined;

/** Critères de recherche donnés par l'agent, appliqués au formulaire. */
function requestPatch(args: Record<string, unknown>): Partial<SearchRequest> {
  const patch: Partial<SearchRequest> = {};
  const domains = strings(args.domains);
  if (domains) patch.domains = domains;
  const countries = strings(args.countries);
  if (countries) patch.countries = countries;
  const cities = strings(args.cities);
  if (cities) patch.cities = cities;
  const contracts = strings(args.contracts);
  if (contracts) patch.contracts = contracts;
  const education = strings(args.education)?.filter((e): e is EducationLevel => EDUCATION.includes(e as EducationLevel));
  if (education) patch.education = education;
  if (typeof args.remote === "boolean") patch.remote = args.remote;
  if (typeof args.hours_old === "number") patch.hours_old = args.hours_old > 0 ? Math.round(args.hours_old) : null;
  if (typeof args.find_recruiter === "boolean") patch.find_recruiter = args.find_recruiter;
  return patch;
}

const searchParams = {
  domains: { type: "array" as const, description: "Métiers ou mots-clés (ex. développeur Rust)." },
  countries: { type: "array" as const, description: "Pays (ex. France, Canada)." },
  cities: { type: "array" as const, description: "Villes." },
  contracts: { type: "array" as const, description: "Types de contrat (CDI, stage…) ; vide : tous." },
  education: { type: "array" as const, description: `Niveaux d'études : ${EDUCATION.join(", ")}.` },
  remote: { type: "boolean" as const, description: "Télétravail seulement." },
  hours_old: { type: "number" as const, description: "Annonces publiées depuis au plus ce nombre d'heures." },
  find_recruiter: { type: "boolean" as const, description: "Chercher une adresse de contact direct chez chaque entreprise." },
};

/** Commandes de JobAgent : recherche, tri des annonces, lettres, candidatures, profil et envoi. */
export default defineActions([
  {
    name: "job_overview",
    description: "Résumé de la recherche d'emploi : offres à revoir, favoris, candidatures et leur état.",
    risk: "read",
    run: async () => {
      const state = await jobagentApi.loadState();
      const dismissed = new Set([...(state.dismissed ?? []), ...(state.hidden ?? [])]);
      const seen = new Set(state.seen ?? []);
      const open = state.offers.filter((o) => !dismissed.has(o.id));
      const unseen = open.filter((o) => !seen.has(o.id));
      const starred = open.filter((o) => state.starred.includes(o.id));
      const applications = state.applications.map((a) => ({ title: a.title, company: a.company, status: STATUS[a.status] ?? a.status, updatedAt: a.updatedAt }));
      const sent = state.applications.filter((a) => a.status === "sent").length;
      return {
        ok: true,
        message: `${unseen.length} offre${s(unseen.length)} à revoir, ${starred.length} en favori, ${sent} candidature${s(sent)} envoyée${s(sent)}.`,
        data: {
          lastSearch: state.lastRunAt ?? null,
          criteria: state.lastRequest ?? null,
          starred: starred.slice(0, 15).map((o) => ({ id: o.id, title: o.title, company: o.company, location: o.location, url: o.url })),
          applications,
        },
      };
    },
  },
  {
    name: "run_search",
    description: "Lance une recherche d'annonces sur les plateformes (critères donnés ou ceux du formulaire). Peut prendre quelques minutes.",
    params: searchParams,
    risk: "write",
    run: async (args) => {
      await loaded();
      store().setRequest(requestPatch(args));
      await store().runSearch();
      if (store().error) return { ok: false, message: store().error! };
      const count = store().offers.length;
      return { ok: true, message: `${count} annonce${s(count)} trouvée${s(count)}.`, data: { offers: store().offers.slice(0, 15).map(describeOffer) }, open: { module: "jobagent" } };
    },
  },
  {
    name: "set_search_criteria",
    description: "Remplit les critères du formulaire de recherche sans la lancer.",
    params: searchParams,
    risk: "write",
    run: async (args) => {
      await loaded();
      store().setRequest(requestPatch(args));
      return { ok: true, message: "Critères de recherche mis à jour.", data: { request: store().request }, open: { module: "jobagent" } };
    },
  },
  {
    name: "cancel_search",
    description: "Arrête la recherche en cours.",
    risk: "write",
    run: async () => {
      await store().cancelSearch();
      return { ok: true, message: "Recherche arrêtée." };
    },
  },
  {
    name: "list_offers",
    description: "Liste les annonces d'un onglet (unseen : à voir, all : toutes, starred : favoris, applied : candidatures), filtrées par texte.",
    params: {
      scope: { type: "string", enum: SCOPES, description: "Onglet (unseen par défaut)." },
      text: { type: "string", description: "Mots de l'intitulé, de l'entreprise ou du lieu." },
      limit: { type: "number", description: "Nombre maximum (20 par défaut)." },
    },
    risk: "read",
    run: async (args) => {
      await loaded();
      const scope = SCOPES.includes(args.scope as Scope) ? (args.scope as Scope) : "unseen";
      const state = store();
      const context = {
        starred: new Set(state.starred),
        sent: sentIds(state.applications),
        tracked: new Set(state.applications.map((a) => a.offerId)),
        reviewed: new Set(state.seen),
      };
      const text = typeof args.text === "string" ? args.text.toLowerCase() : "";
      const list = state.offers
        .filter((o) => inScope(o, scope, context))
        .filter((o) => !text || `${o.title} ${o.company ?? ""} ${o.location ?? ""}`.toLowerCase().includes(text));
      const limit = Math.min(100, Math.max(1, Math.round(Number(args.limit) || 20)));
      return {
        ok: true,
        message: `${list.length} annonce${s(list.length)}${list.length > limit ? ` (les ${limit} premières)` : ""}.`,
        data: { offers: list.slice(0, limit).map(describeOffer) },
      };
    },
  },
  {
    name: "offer_details",
    description: "Détail d'une annonce : description complète (lue sur la page d'origine), adresses de contact, lien pour postuler. La marque comme vue.",
    params: { offer: { type: "string", description: "Identifiant ou intitulé de l'annonce.", required: true } },
    risk: "read",
    run: async (args) => {
      await loaded();
      const found = offer(args.offer);
      if (!found) return noOffer(args.offer);
      store().markSeen(found.id);
      const detail = found.description ? null : await jobagentApi.offerDetail(found.url).catch(() => null);
      return {
        ok: true,
        message: `${found.title}${found.company ? ` chez ${found.company}` : ""}${found.location ? `, ${found.location}` : ""}.`,
        data: { ...describeOffer(found), description: (found.description ?? detail?.description ?? "").slice(0, 6000), emails: [...found.emails, ...(detail?.emails ?? [])], applyUrl: found.apply_url ?? detail?.apply_url ?? null },
      };
    },
  },
  {
    name: "star_offers",
    description: "Met des annonces en favori (ou les en retire).",
    params: {
      offers: { type: "array", description: "Identifiants ou intitulés.", required: true },
      starred: { type: "boolean", description: "false pour retirer des favoris (true par défaut)." },
    },
    risk: "write",
    run: async (args) => {
      await loaded();
      const { found, missing } = offers(args.offers);
      if (found.length === 0) return noOffer(missing[0]);
      store().setStarred(found.map((o) => o.id), args.starred !== false);
      return { ok: true, message: `${found.length} annonce${s(found.length)} ${args.starred !== false ? "en favori" : "retirée(s) des favoris"}.${missing.length ? ` Introuvables : ${missing.join(", ")}.` : ""}` };
    },
  },
  {
    name: "dismiss_offers",
    description: "Écarte des annonces (elles ne reviendront plus aux recherches) ; undo à true pour annuler le dernier écart.",
    params: {
      offers: { type: "array", description: "Identifiants ou intitulés." },
      undo: { type: "boolean", description: "Annuler le dernier écart." },
    },
    risk: "write",
    run: async (args) => {
      await loaded();
      if (args.undo === true) {
        if (!store().undo) return { ok: false, message: "Rien à annuler." };
        store().undoDismiss();
        return { ok: true, message: "Annonces remises en place." };
      }
      const { found, missing } = offers(args.offers);
      if (found.length === 0) return noOffer(missing[0]);
      store().dismissMany(found.map((o) => o.id));
      return { ok: true, message: `${found.length} annonce${s(found.length)} écartée${s(found.length)}.` };
    },
  },
  {
    name: "mark_seen",
    description: "Marque des annonces comme vues (elles quittent l'onglet À voir) ; sans liste, toutes celles à voir.",
    params: { offers: { type: "array", description: "Identifiants ou intitulés ; vide : toutes." } },
    risk: "write",
    run: async (args) => {
      await loaded();
      const ids = Array.isArray(args.offers) && args.offers.length > 0 ? offers(args.offers).found.map((o) => o.id) : store().offers.map((o) => o.id);
      store().markAllSeen(ids);
      return { ok: true, message: `${ids.length} annonce${s(ids.length)} marquée${s(ids.length)} comme vue${s(ids.length)}.` };
    },
  },
  {
    name: "write_letter",
    description:
      "Rédige une lettre de motivation (letter), un mail de candidature (email) ou une réponse à une question du recruteur (answer) pour une annonce, avec le CV et le profil. Gardée comme brouillon de candidature.",
    params: {
      offer: { type: "string", description: "Identifiant ou intitulé de l'annonce.", required: true },
      kind: { type: "string", enum: LETTERS, description: "letter par défaut." },
      question: { type: "string", description: "Question du recruteur (answer)." },
      notes: { type: "string", description: "Points à mettre en avant." },
      language: { type: "string", enum: [...CV_LANGUAGES], description: "Langue (sinon selon le pays de l'annonce)." },
    },
    risk: "write",
    run: async (args) => {
      await loaded();
      const found = offer(args.offer);
      if (!found) return noOffer(args.offer);
      const kind = LETTERS.includes(args.kind as LetterKind) ? (args.kind as LetterKind) : "letter";
      const profile = store().profile;
      const auto = cvFor(found, profile);
      const language = (CV_LANGUAGES.includes(args.language as CvLanguage) ? args.language : auto.language) as CvLanguage;
      const cv = profile.cvs?.[language] ?? auto.cv;
      const result = await jobagentApi.writeLetter({
        kind,
        offer: found,
        cv: cv?.text ?? null,
        notes: (typeof args.notes === "string" && args.notes.trim()) || profile.notes || null,
        language,
        question: kind === "answer" && typeof args.question === "string" ? args.question : null,
      });
      const existing = store().applications.find((a) => a.offerId === found.id);
      if (kind !== "answer") {
        store().upsertApplication({
          offerId: found.id,
          title: found.title,
          company: found.company,
          url: found.url,
          status: existing?.status ?? "draft",
          letter: kind === "letter" ? result.text : existing?.letter,
          email: kind === "email" ? result.text : existing?.email,
          directSentAt: existing?.directSentAt,
          updatedAt: new Date().toISOString(),
        });
      }
      return { ok: true, message: `${kind === "letter" ? "Lettre" : kind === "email" ? "Mail" : "Réponse"} rédigé${kind === "letter" || kind === "answer" ? "e" : ""} pour ${found.title}.`, data: { text: result.text } };
    },
  },
  {
    name: "prepare_applications",
    description:
      "Prépare un lot de candidatures pour des annonces (destinataires trouvés dans l'annonce ou chez l'entreprise) et l'affiche : rien ne part avant send_applications.",
    params: { offers: { type: "array", description: "Identifiants ou intitulés ; vide : les favoris.", required: false } },
    risk: "write",
    run: async (args) => {
      await loaded();
      const chosen = Array.isArray(args.offers) && args.offers.length > 0 ? offers(args.offers).found : store().offers.filter((o) => store().starred.includes(o.id));
      if (chosen.length === 0) return { ok: false, message: "Aucune annonce à préparer (donne des annonces ou mets-en en favori)." };
      store().prepareBatch(chosen);
      const batch = store().batch;
      const reachable = batch.filter((b) => b.to).length;
      return {
        ok: true,
        message: `Lot prêt : ${batch.length} message${s(batch.length)}, ${reachable} avec un destinataire.`,
        data: { batch: batch.map((b) => ({ offer: b.offer.title, company: b.offer.company, channel: b.channel, to: b.to })) },
        open: { module: "jobagent" },
      };
    },
  },
  {
    name: "send_applications",
    description: "Rédige puis envoie par mail chaque candidature du lot préparé (prepare_applications), une par une, depuis le compte d'envoi.",
    risk: "destructive",
    confirm: () => {
      const batch = store().batch;
      return `Envoyer ${batch.length} candidature${s(batch.length)} par mail ?`;
    },
    run: async () => {
      if (store().batch.length === 0) return { ok: false, message: "Aucun lot préparé : appelle d'abord prepare_applications." };
      await store().runBatch();
      const batch = store().batch;
      const sent = batch.filter((b) => b.status === "sent").length;
      const failed = batch.filter((b) => b.error);
      return {
        ok: sent > 0,
        message: `${sent} candidature${s(sent)} envoyée${s(sent)}${failed.length ? `, ${failed.length} en échec (${failed[0]!.error})` : ""}.`,
        data: { results: batch.map((b) => ({ offer: b.offer.title, to: b.to, status: b.status, error: b.error ?? null })) },
      };
    },
  },
  {
    name: "set_application_status",
    description: "Change le suivi d'une candidature : draft, sent, answered (réponse reçue) ou rejected.",
    params: {
      offer: { type: "string", description: "Identifiant ou intitulé de l'annonce.", required: true },
      status: { type: "string", enum: ["draft", "sent", "answered", "rejected"], description: "Nouvel état.", required: true },
    },
    risk: "write",
    run: async (args) => {
      await loaded();
      const existing = findByName(store().applications, String(args.offer), (a) => `${a.title} ${a.company ?? ""}`, (a) => a.offerId);
      const found = existing ? null : offer(args.offer);
      if (!existing && !found) return noOffer(args.offer);
      const base: Application = existing ?? { offerId: found!.id, title: found!.title, company: found!.company, url: found!.url, status: "draft", updatedAt: "" };
      store().upsertApplication({ ...base, status: args.status as Application["status"], updatedAt: new Date().toISOString() });
      return { ok: true, message: `Candidature ${base.title} : ${STATUS[String(args.status)]}.` };
    },
  },
  {
    name: "get_profile",
    description: "Profil de candidature : coordonnées, liens, notes et CV importés (sans le texte complet du CV).",
    risk: "read",
    run: async () => {
      await loaded();
      const { cvs, ...profile } = store().profile;
      const cv = Object.fromEntries(Object.entries(cvs ?? {}).map(([language, entry]) => [language, { name: entry?.name ?? null, pages: entry?.pages ?? null, importedAt: entry?.imported_at ?? null }]));
      return { ok: true, message: profile.name ? `Profil de ${profile.name}.` : "Profil encore vide.", data: { ...profile, cvs: cv } };
    },
  },
  {
    name: "update_profile",
    description: "Modifie le profil de candidature : nom, adresse mail, téléphone, ville, liens, notes (points forts à mettre en avant).",
    params: {
      name: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      city: { type: "string" },
      links: { type: "string", description: "Portfolio, LinkedIn…" },
      notes: { type: "string", description: "Points forts, disponibilités, préférences." },
    },
    risk: "write",
    run: async (args) => {
      await loaded();
      const patch: Profile = { ...store().profile };
      const changed: string[] = [];
      for (const key of ["name", "email", "phone", "city", "links", "notes"] as const) {
        if (typeof args[key] === "string") {
          patch[key] = (args[key] as string).trim();
          changed.push(key);
        }
      }
      if (changed.length === 0) return { ok: false, message: "Rien à modifier." };
      await store().saveProfile(patch);
      return { ok: true, message: `Profil mis à jour (${changed.join(", ")}).` };
    },
  },
  {
    name: "import_cv",
    description: "Importe un CV (PDF, Word, texte) en français ou en anglais : son texte sert aux lettres, le fichier est joint aux mails.",
    params: {
      path: { type: "string", description: "Chemin du fichier.", required: true },
      language: { type: "string", enum: [...CV_LANGUAGES], description: "Langue du CV (fr par défaut)." },
    },
    risk: "write",
    run: async (args) => {
      await loaded();
      const language = (CV_LANGUAGES.includes(args.language as CvLanguage) ? args.language : "fr") as CvLanguage;
      await store().importCv(String(args.path), language);
      return { ok: true, message: `CV ${language === "fr" ? "français" : "anglais"} importé.` };
    },
  },
  {
    name: "mail_account",
    description: "Compte d'envoi des candidatures (adresse, serveur, signature) ; le mot de passe n'est jamais lu ni donné.",
    risk: "read",
    run: async () => {
      const mail = await jobagentApi.mailSettings();
      return {
        ok: true,
        message: mail.from ? `Envoi depuis ${mail.from}${mail.has_password ? "" : ", mot de passe à saisir dans le module"}.` : "Aucun compte d'envoi configuré.",
        data: { from: mail.from ?? null, replyTo: mail.reply_to ?? null, host: mail.host ?? null, port: mail.port ?? null, signature: mail.signature ?? null, hasPassword: Boolean(mail.has_password) },
      };
    },
  },
  {
    name: "update_mail_account",
    description:
      "Modifie le compte d'envoi : adresse, réponse à, serveur SMTP (trouvé d'après l'adresse si absent), port, signature. Le mot de passe se saisit dans le module, jamais par un agent.",
    params: {
      from: { type: "string" },
      reply_to: { type: "string" },
      host: { type: "string" },
      port: { type: "number" },
      signature: { type: "string" },
    },
    risk: "write",
    run: async (args) => {
      const current = await jobagentApi.mailSettings();
      const next = { ...current, password: undefined };
      if (typeof args.from === "string") next.from = args.from.trim();
      if (typeof args.reply_to === "string") next.reply_to = args.reply_to.trim();
      if (typeof args.signature === "string") next.signature = args.signature;
      if (typeof args.port === "number") next.port = Math.round(args.port);
      if (typeof args.host === "string") next.host = args.host.trim();
      else if (typeof args.from === "string" && !current.host) {
        const hint = await jobagentApi.smtpHint(args.from.trim()).catch(() => null);
        if (hint) Object.assign(next, { host: hint.host, port: hint.port, starttls: hint.starttls, ssl: !hint.starttls });
      }
      await store().saveMail(next);
      return { ok: true, message: `Compte d'envoi mis à jour${next.has_password ? "" : " ; saisissez le mot de passe dans le module"}.` };
    },
  },
  {
    name: "set_agent_tools",
    description: "Branche (ou débranche) les outils de recherche d'emploi sur les agents d'ARCHIMED (serveur MCP du module).",
    params: { enabled: { type: "boolean", description: "true pour brancher.", required: true } },
    risk: "write",
    run: async (args) => {
      const result = await jobagentApi.setMcp(args.enabled === true);
      return { ok: true, message: result.enabled ? "Outils de recherche d'emploi branchés sur les agents." : "Outils de recherche d'emploi débranchés." };
    },
  },
  {
    name: "install_engine",
    description: "Installe ou répare le moteur de recherche (Python et ses bibliothèques).",
    risk: "write",
    run: async () => {
      const status = await jobagentApi.installEngine();
      return status.ready
        ? { ok: true, message: "Moteur de recherche prêt." }
        : { ok: false, message: `Moteur incomplet : ${status.missing.join(", ") || "Python introuvable"}.` };
    },
  },
]);
