import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AtSign, Building2, ExternalLink, Loader2, Star, X } from "lucide-react";
import { Badge, Button } from "@/design-system/primitives";
import { cn } from "@/core/lib/cn";
import { jobagentApi } from "../api";
import { directEmail, offerEmail } from "../lib/batch";
import { useJobAgentStore } from "../store";
import type { Offer } from "../types";
import { ApplyPanel } from "./ApplyPanel";
import { contractLabel, postedLabel, salaryLabel } from "./OfferCard";

/** Détail d'une offre : ce que dit l'annonce, puis de quoi préparer la candidature. */
export function OfferPanel({ offer, onClose }: { offer: Offer; onClose: () => void }) {
  const { starred, toggleStar } = useJobAgentStore();
  const [description, setDescription] = useState<string | null>(offer.description);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Le texte complet ne vient pas des listes : il est lu sur la page de l'annonce.
  useEffect(() => {
    setDescription(offer.description);
    setProblem(null);
    if (offer.description) return;
    let alive = true;
    setLoading(true);
    jobagentApi
      .offerDetail(offer.url)
      .then((detail) => {
        if (!alive) return;
        if (detail.error) setProblem(detail.error);
        setDescription(detail.description);
      })
      .catch(
        (error: { message?: string }) => alive && setProblem(error.message ?? "Lecture impossible"),
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [offer.id, offer.url, offer.description]);

  const salary = salaryLabel(offer);
  const posted = postedLabel(offer.posted);
  const contract = contractLabel(offer.contract);
  const adEmail = offerEmail(offer);
  const direct = directEmail(offer);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-title-3 font-semibold [overflow-wrap:anywhere]">{offer.title}</h2>
          <p className="text-body-sm text-text-muted">
            {offer.company ?? "Entreprise non précisée"}
            {offer.location ? ` · ${offer.location}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{offer.source_label}</Badge>
            {contract ? <Badge tone="info">{contract}</Badge> : null}
            {offer.remote ? <Badge tone="info">télétravail</Badge> : null}
            {offer.education_label ? <Badge tone="accent">{offer.education_label}</Badge> : null}
            {salary ? <Badge tone="success">{salary}</Badge> : null}
            {posted ? (
              <span className="text-caption text-text-subtle">publiée {posted}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => toggleStar(offer.id)}
            aria-label={starred.includes(offer.id) ? "Retirer des favoris" : "Ajouter aux favoris"}
          >
            <Star
              size={16}
              strokeWidth={1.75}
              className={starred.includes(offer.id) ? "text-warning" : ""}
              fill={starred.includes(offer.id) ? "currentColor" : "none"}
            />
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Fermer">
            <X size={16} strokeWidth={1.75} />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-5 px-5 py-4">
          {loading ? (
            <p className="flex items-center gap-2 text-body-sm text-text-subtle">
              <Loader2 size={14} className="animate-spin" /> Lecture de l'annonce…
            </p>
          ) : description ? (
            <div
              className={cn(
                "selectable text-body-sm leading-relaxed text-text-muted [overflow-wrap:anywhere]",
                // Même traitement du Markdown que la conversation : titres lisibles,
                // listes à puces, code en mono.
                "[&_h1]:pt-3 [&_h1]:text-body [&_h1]:font-semibold [&_h1]:text-text",
                "[&_h2]:pt-3 [&_h2]:text-body [&_h2]:font-semibold [&_h2]:text-text",
                "[&_h3]:pt-2 [&_h3]:text-body-sm [&_h3]:font-semibold [&_h3]:text-text",
                "[&_p]:py-1 [&_ul]:list-disc [&_ul]:py-1 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:py-1 [&_ol]:pl-5",
                "[&_code]:rounded-xs [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-caption",
                "[&_strong]:font-medium [&_strong]:text-text [&_a]:text-accent [&_a]:underline",
              )}
            >
              <Markdown remarkPlugins={[remarkGfm]}>{description}</Markdown>
            </div>
          ) : (
            <p className="text-body-sm leading-relaxed text-text-subtle">
              {problem ?? "Cette plateforme ne laisse pas lire l'annonce sans compte."} Ouvrez-la
              dans le navigateur pour la lire en entier.
            </p>
          )}

          {adEmail || direct ? (
            <div className="space-y-2 rounded-lg border border-border bg-surface-1 p-4">
              <p className="text-footnote font-medium text-text-muted">Contacts</p>
              {adEmail ? (
                <p className="flex items-start gap-2 text-body-sm text-text [overflow-wrap:anywhere]">
                  <AtSign size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-text-subtle" />
                  {adEmail}
                  <span className="text-caption text-text-subtle">· dans l'annonce</span>
                </p>
              ) : null}
              {direct ? (
                <p className="flex items-start gap-2 text-body-sm text-text [overflow-wrap:anywhere]">
                  <Building2
                    size={14}
                    strokeWidth={1.75}
                    className="mt-0.5 shrink-0 text-text-subtle"
                  />
                  {direct}
                  <span className="text-caption text-text-subtle">· trouvé sur le site</span>
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button size="md" onClick={() => void openUrl(offer.url)}>
              <ExternalLink size={14} strokeWidth={1.75} /> Voir l'annonce
            </Button>
            {offer.company_url ? (
              <Button size="md" variant="ghost" onClick={() => void openUrl(offer.company_url!)}>
                L'entreprise
              </Button>
            ) : null}
          </div>
        </div>

        <ApplyPanel offer={offer} />
      </div>
    </div>
  );
}
