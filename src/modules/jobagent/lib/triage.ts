import type { Application, Offer } from "../types";

/** Onglets de la liste des annonces. */
export type Scope = "unseen" | "all" | "starred" | "applied";

/** Une candidature est partie quand elle a été envoyée, ou qu'une réponse est arrivée. */
export function isSent(application: Application): boolean {
  return application.status === "sent" || application.status === "answered";
}

export function sentIds(applications: Application[]): Set<string> {
  return new Set(applications.filter(isSent).map((application) => application.offerId));
}

export type ScopeContext = {
  starred: Set<string>;
  /** Candidatures parties. */
  sent: Set<string>;
  /** Toute annonce qui a un suivi, brouillon compris. */
  tracked: Set<string>;
  /** Déjà ouvertes au moment où l'onglet « À voir » a été affiché. */
  reviewed: Set<string>;
};

/**
 * Où vit une annonce. Elle n'est qu'à un endroit à la fois, pour que chaque onglet
 * soit une pile de travail et pas une vue de plus sur la même liste :
 *
 * - candidature partie : « Candidatures » seulement ;
 * - en favori : « Favoris » seulement ;
 * - sinon : « Toutes », et « À voir » tant qu'elle n'a pas été ouverte.
 */
export function inScope(offer: Offer, scope: Scope, context: ScopeContext): boolean {
  const sent = context.sent.has(offer.id);
  const starred = context.starred.has(offer.id);
  switch (scope) {
    case "applied":
      return context.tracked.has(offer.id);
    case "starred":
      return starred && !sent;
    case "all":
      return !starred && !sent;
    case "unseen":
      return !starred && !sent && !context.reviewed.has(offer.id);
  }
}

/** Favoris débarrassés des candidatures déjà parties. */
export function withoutSent(starred: string[], applications: Application[]): string[] {
  const sent = sentIds(applications);
  return starred.filter((id) => !sent.has(id));
}

/** Annonces comprises entre deux autres, bornes incluses, dans l'ordre affiché (Maj + clic). */
export function rangeBetween(order: string[], from: string, to: string): string[] {
  const start = order.indexOf(from);
  const end = order.indexOf(to);
  if (start < 0 || end < 0) return [to];
  return start <= end ? order.slice(start, end + 1) : order.slice(end, start + 1);
}

/**
 * Annonce à ouvrir quand une série vient de quitter la liste : la suivante encore là,
 * à défaut la précédente. La revue continue sans reprendre la souris.
 */
export function nextAfter(
  order: string[],
  removed: Set<string>,
  current: string | null,
): string | null {
  if (!current) return null;
  const index = order.indexOf(current);
  if (index < 0) return null;
  for (let step = index + 1; step < order.length; step += 1) {
    const id = order[step]!;
    if (!removed.has(id)) return id;
  }
  for (let step = index - 1; step >= 0; step -= 1) {
    const id = order[step]!;
    if (!removed.has(id)) return id;
  }
  return null;
}
