import type { MouseEvent } from "react";
import { Check, GraduationCap, MapPin, Star, Trash2, Wifi } from "lucide-react";
import { Badge } from "@/design-system/primitives";
import { cn } from "@/core/lib/cn";
import type { Offer } from "../types";

/** Contrats affichés en français, quelle que soit la plateforme d'origine. */
const CONTRACT_LABELS: Record<string, string> = {
  fulltime: "CDI / temps plein",
  parttime: "Temps partiel",
  contract: "CDD / freelance",
  temporary: "Intérim",
  internship: "Stage / alternance",
  perdiem: "Vacation",
  other: "Autre",
};

export function contractLabel(contract: string | null): string | null {
  if (!contract) return null;
  return contract
    .split(", ")
    .map((item) => CONTRACT_LABELS[item] ?? item)
    .join(" · ");
}

export function salaryLabel(offer: Offer): string | null {
  const {
    salary_min: low,
    salary_max: high,
    salary_currency: currency,
    salary_period,
  } = offer;
  if (!low && !high) return null;
  const money = (value: number) =>
    new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value);
  const periods: Record<string, string> = {
    yearly: "an",
    monthly: "mois",
    weekly: "semaine",
    daily: "jour",
    hourly: "heure",
  };
  const range =
    low && high
      ? `${money(low)} – ${money(high)}`
      : money((low ?? high) as number);
  const unit = salary_period
    ? ` / ${periods[salary_period] ?? salary_period}`
    : "";
  return `${range} ${currency === "USD" ? "$" : currency === "GBP" ? "£" : "€"}${unit}`;
}

/**
 * Jours écoulés depuis la publication, comptés en **jours calendaires locaux**.
 * Une date `2026-09-19` se lit minuit UTC : comparée à l'instant présent, une annonce
 * publiée le matin même ressortait « hier ».
 */
export function daysSince(posted: string | null): number | null {
  if (!posted) return null;
  const [year, month, day] = posted.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  const published = new Date(year, month - 1, day).getTime();
  const now = new Date();
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  return Math.round((midnight - published) / 86_400_000);
}

/** « il y a 3 jours » plutôt qu'une date brute : c'est la fraîcheur qui compte. */
export function postedLabel(posted: string | null): string | null {
  const days = daysSince(posted);
  if (days === null) return null;
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} jours`;
  if (days < 31)
    return `il y a ${Math.round(days / 7)} semaine${days >= 14 ? "s" : ""}`;
  return `il y a ${Math.round(days / 30)} mois`;
}

export function OfferCard({
  offer,
  selected,
  starred,
  seen,
  applied,
  checked = false,
  selecting = false,
  onSelect,
  onCheck,
  onStar,
  onDismiss,
}: {
  offer: Offer;
  /** Ouverte dans le panneau de droite. */
  selected: boolean;
  starred: boolean;
  /** Déjà ouverte : la carte s'efface pour laisser ressortir ce qui reste à voir. */
  seen: boolean;
  applied: boolean;
  /** Cochée pour une action groupée. */
  checked?: boolean;
  /** Une sélection est en cours : les cases restent visibles sur toutes les cartes. */
  selecting?: boolean;
  onSelect: () => void;
  /**
   * Coche ou décoche ; Maj étend la sélection jusqu'à la dernière carte cochée. Sans lui
   * (carte de la carte du monde), pas de case à cocher.
   */
  onCheck?: (event: MouseEvent) => void;
  onStar: () => void;
  onDismiss: () => void;
}) {
  const salary = salaryLabel(offer);
  const contract = contractLabel(offer.contract);
  const posted = postedLabel(offer.posted);

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-selected={checked}
        onClick={(event) => {
          // Ctrl ou Maj : on coche sans ouvrir, comme dans un explorateur de fichiers.
          if (onCheck && (event.ctrlKey || event.metaKey || event.shiftKey)) {
            event.preventDefault();
            onCheck(event);
            return;
          }
          onSelect();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSelect();
          }
        }}
        className={cn(
          "group flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left",
          "transition-colors duration-[80ms] ease-standard",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          selected
            ? "border-accent bg-accent-soft"
            : checked
              ? "border-border-strong bg-surface-2"
              : "border-border bg-surface-1 hover:border-border-strong",
          seen && !selected && !checked && "opacity-60",
        )}
      >
        {onCheck ? (
          <button
            role="checkbox"
            aria-checked={checked}
            aria-label={
              checked ? "Décocher cette annonce" : "Cocher cette annonce"
            }
            onClick={(event) => {
              event.stopPropagation();
              onCheck(event);
            }}
            className={cn(
              "mt-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-xs border transition-[opacity,background-color,border-color]",
              checked
                ? "border-transparent bg-accent text-accent-fg"
                : "border-border-strong bg-surface-1",
              checked || selecting
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            )}
          >
            {checked ? <Check size={14} strokeWidth={2.5} /> : null}
          </button>
        ) : null}

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "truncate text-body-sm",
                  seen
                    ? "font-normal text-text-muted"
                    : "font-medium text-text",
                )}
              >
                {offer.title}
              </p>
              <p className="truncate text-footnote text-text-muted">
                {offer.company ?? "Entreprise non précisée"}
              </p>
            </div>
            <div className="-mr-1 -mt-1 flex shrink-0 items-center">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onStar();
                }}
                aria-label={
                  starred ? "Retirer des favoris" : "Ajouter aux favoris"
                }
                title={
                  starred ? "Retirer des favoris" : "Ajouter aux favoris (F)"
                }
                className={cn(
                  "flex size-7 cursor-pointer items-center justify-center rounded-sm transition-[opacity,color] hover:bg-surface-2",
                  starred
                    ? "text-warning"
                    : "text-text-subtle opacity-0 hover:text-warning group-hover:opacity-100",
                )}
              >
                <Star
                  size={14}
                  strokeWidth={1.75}
                  fill={starred ? "currentColor" : "none"}
                />
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onDismiss();
                }}
                aria-label="Supprimer cette annonce"
                title="Supprimer (Suppr) — elle ne reviendra pas aux prochaines recherches"
                className="flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-subtle opacity-0 transition-[opacity,color] hover:bg-surface-2 hover:text-danger group-hover:opacity-100"
              >
                <Trash2 size={14} strokeWidth={1.75} />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-text-subtle">
            {applied ? (
              <span className="inline-flex items-center gap-1 text-success">
                <Check size={14} strokeWidth={2} /> candidature envoyée
              </span>
            ) : null}
            <Badge tone="neutral">{offer.source_label}</Badge>
            {offer.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin size={14} strokeWidth={1.75} /> {offer.location}
              </span>
            ) : null}
            {offer.remote ? (
              <span className="inline-flex items-center gap-1 text-info">
                <Wifi size={14} strokeWidth={1.75} /> télétravail
              </span>
            ) : null}
            {contract ? <span>{contract}</span> : null}
            {offer.education_label ? (
              <span className="inline-flex items-center gap-1">
                <GraduationCap size={14} strokeWidth={1.75} />{" "}
                {offer.education_label}
              </span>
            ) : null}
            {salary ? <Badge tone="success">{salary}</Badge> : null}
            {posted ? <span className="ml-auto">{posted}</span> : null}
          </div>
        </div>
      </div>
    </li>
  );
}
