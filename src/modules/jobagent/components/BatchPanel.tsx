import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  Loader2,
  Mail,
  Send,
  SkipForward,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/design-system/primitives";
import { cn } from "@/core/lib/cn";
import { cvFor, LANGUAGE_LABELS } from "../lib/cv";
import { useJobAgentStore } from "../store";
import type { BatchItem, BatchStatus } from "../types";

const STATUS_LABELS: Record<BatchStatus, string> = {
  pending: "en attente",
  writing: "rédaction…",
  ready: "prête",
  sending: "envoi…",
  sent: "envoyée",
  failed: "échec",
  skipped: "à faire à la main",
};

function StatusIcon({ item }: { item: BatchItem }) {
  const { status } = item;
  if (status === "writing" || status === "sending") {
    return <Loader2 size={14} className="animate-spin text-accent" />;
  }
  if (status === "sent") return <Check size={14} strokeWidth={1.75} className="text-success" />;
  if (status === "failed") {
    return <AlertTriangle size={14} strokeWidth={1.75} className="text-danger" />;
  }
  if (status === "skipped") {
    return <SkipForward size={14} strokeWidth={1.75} className="text-text-subtle" />;
  }
  return item.channel === "direct" ? (
    <Building2 size={14} strokeWidth={1.75} className="text-text-subtle" />
  ) : (
    <Mail size={14} strokeWidth={1.75} className="text-text-subtle" />
  );
}

/**
 * Envoi groupé : ARCHIMED écrit chaque message, y joint le bon CV et l'expédie, sans
 * repasser par une validation annonce par annonce.
 *
 * Un envoi reste un acte irréversible : la liste complète — destinataires, expéditeur,
 * CV joint — est affichée, et rien ne part avant l'accord donné ici. Les annonces sans
 * adresse de contact sont écartées d'office ; elles se déposent sur le site.
 */
export function BatchPanel({ onClose }: { onClose: () => void }) {
  const batch = useJobAgentStore((state) => state.batch);
  const running = useJobAgentStore((state) => state.batchRunning);
  const mail = useJobAgentStore((state) => state.mail);
  const profile = useJobAgentStore((state) => state.profile);
  const runBatch = useJobAgentStore((state) => state.runBatch);
  const clearBatch = useJobAgentStore((state) => state.clearBatch);
  const [confirmed, setConfirmed] = useState(false);

  const counts = useMemo(() => {
    const tally = (status: BatchStatus) => batch.filter((item) => item.status === status).length;
    return {
      ready: tally("pending"),
      direct: batch.filter((item) => item.status === "pending" && item.channel === "direct").length,
      skipped: tally("skipped"),
      sent: tally("sent"),
      failed: tally("failed"),
    };
  }, [batch]);

  const ready = Boolean(mail?.from && mail?.host && mail?.has_password);
  const finished = !running && (counts.sent > 0 || counts.failed > 0) && counts.ready === 0;

  const languages = useMemo(() => {
    const used = new Set(
      batch
        .filter((item) => item.status === "pending")
        .map((item) => cvFor(item.offer, profile).language),
    );
    return [...used];
  }, [batch, profile]);

  const missingCv = useMemo(
    () => batch.some((item) => item.status === "pending" && !cvFor(item.offer, profile).cv),
    [batch, profile],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-title-3 font-semibold">Envoyer les candidatures</h2>
          <p className="text-caption text-text-subtle">
            {counts.ready} à envoyer
            {counts.direct > 0 ? ` · dont ${counts.direct} en direct` : ""}
            {counts.skipped > 0 ? ` · ${counts.skipped} à déposer à la main` : ""}
            {counts.sent > 0 ? ` · ${counts.sent} envoyé${counts.sent > 1 ? "s" : ""}` : ""}
            {counts.failed > 0 ? ` · ${counts.failed} en échec` : ""}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            clearBatch();
            onClose();
          }}
          aria-label="Fermer"
        >
          <X size={16} strokeWidth={1.75} />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <ul className="space-y-2">
          {batch.map((item) => (
            <Row key={item.key} item={item} />
          ))}
        </ul>
      </div>

      <footer className="shrink-0 space-y-3 border-t border-border bg-surface-1/60 px-5 py-4">
        {!ready ? (
          <p className="text-caption leading-relaxed text-warning">
            Compte d'envoi incomplet : renseignez l'adresse, le serveur et le mot de passe
            d'application dans l'onglet Profil.
          </p>
        ) : null}
        {missingCv ? (
          <p className="text-caption leading-relaxed text-warning">
            Certaines annonces n'ont aucun CV à joindre dans leur langue.
          </p>
        ) : null}

        {running ? (
          <Button
            size="lg"
            className="w-full"
            onClick={() => useJobAgentStore.setState({ batchRunning: false })}
          >
            <Square size={16} strokeWidth={1.75} /> Arrêter après l'envoi en cours
          </Button>
        ) : finished ? (
          <Button
            size="lg"
            variant="primary"
            className="w-full"
            onClick={() => {
              clearBatch();
              onClose();
            }}
          >
            <Check size={16} strokeWidth={1.75} /> Terminé
          </Button>
        ) : confirmed ? (
          <div className="space-y-3">
            <p className="text-body-sm leading-relaxed text-text-muted">
              {counts.ready} e-mail{counts.ready > 1 ? "s" : ""}{" "}
              {counts.ready > 1 ? "partiront" : "partira"} de{" "}
              <span className="text-text">{mail?.from}</span>, avec le CV en{" "}
              {languages.map((item) => LANGUAGE_LABELS[item]).join(" ou ")}.
              {counts.direct > 0
                ? ` ${counts.direct} ${counts.direct > 1 ? "vont" : "va"} à un contact trouvé dans l'entreprise, en plus de la candidature.`
                : ""}{" "}
              Cette action est définitive.
            </p>
            <div className="flex gap-2">
              <Button size="lg" variant="ghost" className="flex-1" onClick={() => setConfirmed(false)}>
                Revenir
              </Button>
              <Button
                size="lg"
                variant="primary"
                className="flex-1"
                disabled={!ready || counts.ready === 0}
                onClick={() => void runBatch()}
              >
                <Send size={16} strokeWidth={1.75} /> Envoyer les {counts.ready}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="lg"
            variant="primary"
            className="w-full"
            disabled={!ready || counts.ready === 0}
            onClick={() => setConfirmed(true)}
          >
            <Send size={16} strokeWidth={1.75} /> Préparer et envoyer ({counts.ready})
          </Button>
        )}
      </footer>
    </div>
  );
}

function Row({ item }: { item: BatchItem }) {
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border bg-surface-1 p-3",
        item.status === "skipped" && "opacity-60",
      )}
    >
      <span className="mt-0.5 shrink-0">
        <StatusIcon item={item} />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-body-sm text-text">{item.offer.title}</p>
        <p className="truncate text-caption text-text-subtle">
          {item.offer.company ?? "Entreprise non précisée"}
          {item.to ? ` · ${item.to}` : ""}
        </p>
        {item.channel === "direct" ? (
          <p className="text-caption text-text-subtle">message direct, en plus de la candidature</p>
        ) : null}
        {item.error ? (
          <p className="text-caption text-text-subtle [overflow-wrap:anywhere]">{item.error}</p>
        ) : null}
      </div>
      <span
        className={cn(
          "shrink-0 text-caption",
          item.status === "sent"
            ? "text-success"
            : item.status === "failed"
              ? "text-danger"
              : "text-text-subtle",
        )}
      >
        {STATUS_LABELS[item.status]}
      </span>
    </li>
  );
}
