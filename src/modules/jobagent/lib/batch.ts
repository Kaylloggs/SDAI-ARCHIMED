import type { Application, BatchItem, Offer } from "../types";

/** Adresse indiquée par l'annonce elle-même. */
export function offerEmail(offer: Offer): string | null {
  return offer.emails?.[0] ?? null;
}

/**
 * Adresse trouvée chez l'entreprise, quand elle ne vient pas déjà de l'annonce.
 *
 * `recruiter_source` vaut `annonce` lorsque le moteur n'a fait que reprendre l'adresse
 * de l'offre : dans ce cas il n'y a pas de démarche « en direct » à faire, c'est le
 * même destinataire.
 */
export function directEmail(offer: Offer): string | null {
  if (offer.recruiter_source !== "site") return null;
  const found = offer.recruiter_email ?? null;
  return found && found !== offerEmail(offer) ? found : null;
}

/**
 * Compose un lot d'envois à partir des annonces retenues.
 *
 * Une annonce peut donner deux messages : la candidature à l'adresse de l'annonce,
 * puis, si la recherche a trouvé un contact dans l'entreprise, un message direct.
 * L'ordre compte — le direct part après, et seulement si la candidature est bien
 * partie, parce qu'il y fait référence.
 */
export function buildBatch(offers: Offer[], applications: Application[]): BatchItem[] {
  const byOffer = new Map(applications.map((item) => [item.offerId, item]));
  const batch: BatchItem[] = [];

  for (const offer of offers) {
    const record = byOffer.get(offer.id);
    const sent = record?.status === "sent" || record?.status === "answered";
    const to = offerEmail(offer);
    batch.push({
      key: `${offer.id}:offer`,
      offer,
      channel: "offer",
      to,
      // Sans adresse dans l'annonce, la candidature ne peut pas partir toute seule :
      // elle reste à déposer sur le site, depuis le panneau de droite.
      status: !to || sent ? "skipped" : "pending",
      error: !to ? "pas d'adresse dans l'annonce" : sent ? "déjà envoyée" : undefined,
    });

    const direct = directEmail(offer);
    if (!direct) continue;
    batch.push({
      key: `${offer.id}:direct`,
      offer,
      channel: "direct",
      to: direct,
      status: record?.directSentAt ? "skipped" : "pending",
      error: record?.directSentAt ? "contact déjà prévenu" : undefined,
    });
  }

  return batch;
}
