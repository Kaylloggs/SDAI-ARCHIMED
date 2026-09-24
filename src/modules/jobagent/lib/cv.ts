import type { CvEntry, CvLanguage, Offer, Profile } from "../types";

/**
 * Pays où une candidature se rédige en français. Ailleurs, l'anglais s'impose — y compris
 * au Canada, où la langue d'usage professionnel est l'anglais hors Québec.
 */
const FRENCH_SPEAKING = new Set([
  "france",
  "belgium",
  "belgique",
  "switzerland",
  "suisse",
  "luxembourg",
  "monaco",
]);

/** Langue attendue par une annonce, d'après son pays. */
export function languageOf(offer: Pick<Offer, "country">): CvLanguage {
  const country = (offer.country ?? "").trim().toLowerCase();
  if (!country) return "fr";
  return FRENCH_SPEAKING.has(country) ? "fr" : "en";
}

/**
 * CV à joindre pour une annonce : celui de sa langue, ou l'autre à défaut.
 * La langue réellement retenue sert aussi à la rédaction de la lettre.
 */
export function cvFor(
  offer: Pick<Offer, "country">,
  profile: Profile,
): { language: CvLanguage; cv: CvEntry | null; fallback: boolean } {
  const wanted = languageOf(offer);
  const other: CvLanguage = wanted === "fr" ? "en" : "fr";

  const preferred = profile.cvs?.[wanted];
  if (preferred?.text) return { language: wanted, cv: preferred, fallback: false };

  const spare = profile.cvs?.[other];
  if (spare?.text) return { language: other, cv: spare, fallback: true };

  return { language: wanted, cv: null, fallback: false };
}

export const LANGUAGE_LABELS: Record<CvLanguage, string> = {
  fr: "français",
  en: "anglais",
};
