import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Channel } from "@/core/ipc";
import { Button } from "@/design-system/primitives";
import type { InstallEvent } from "@/core/ipc/bindings/InstallEvent";
import type { JavaInstall } from "@/core/ipc/bindings/JavaInstall";
import type { JdkOffer } from "@/core/ipc/bindings/JdkOffer";
import { errorText, mcstudioApi } from "../api";
import { megabytes } from "../lib/format";

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "confirm"; offer: JdkOffer }
  | { kind: "downloading"; offer: JdkOffer; received: number; total: number }
  | { kind: "verifying" | "extracting"; offer: JdkOffer }
  | { kind: "done"; install: JavaInstall }
  | { kind: "failed"; message: string };

/**
 * Installe un JDK sur demande. Rien ne se télécharge sans confirmation : l'offre
 * (source, fichier, taille, dossier) est affichée d'abord (guidelines §11).
 */
export function JdkInstallCard({
  major,
  exact = false,
  compact = false,
  onInstalled,
}: {
  major: number;
  exact?: boolean;
  /** Bouton seul tant que rien n'est demandé (listes, barres d'outils). */
  compact?: boolean;
  onInstalled?: (install: JavaInstall) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const done = useRef(onInstalled);
  done.current = onInstalled;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const set = (next: Phase) => {
    if (mounted.current) setPhase(next);
  };

  const prepare = async () => {
    set({ kind: "loading" });
    try {
      set({ kind: "confirm", offer: await mcstudioApi.jdkOffer(major) });
    } catch (e) {
      set({ kind: "failed", message: errorText(e) });
    }
  };

  const install = async (offer: JdkOffer) => {
    const channel = new Channel<InstallEvent>();
    channel.onmessage = (event) => {
      switch (event.type) {
        case "downloading":
          set({ kind: "downloading", offer, received: event.received, total: event.total });
          break;
        case "verifying":
          set({ kind: "verifying", offer });
          break;
        case "extracting":
          set({ kind: "extracting", offer });
          break;
        case "done":
          set({ kind: "done", install: event.install });
          done.current?.(event.install);
          break;
        case "failed":
          set({ kind: "failed", message: event.message });
          break;
      }
    };
    set({ kind: "downloading", offer, received: 0, total: Number(offer.size) });
    try {
      await mcstudioApi.installJdk(offer, channel);
    } catch (e) {
      set({ kind: "failed", message: errorText(e) });
    }
  };

  const label = `Java ${major}${exact ? " (exactement)" : ""}`;

  if (phase.kind === "idle" || phase.kind === "loading") {
    return (
      <Button
        type="button"
        size={compact ? "sm" : "md"}
        variant={compact ? "secondary" : "primary"}
        disabled={phase.kind === "loading"}
        onClick={() => void prepare()}
        icon={phase.kind === "loading" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      >
        Installer {label}
      </Button>
    );
  }

  if (phase.kind === "done") {
    return (
      <p className="flex items-center gap-2 text-footnote text-success">
        <CheckCircle2 size={14} /> Java {phase.install.major} installé ({phase.install.version}).
      </p>
    );
  }

  if (phase.kind === "failed") {
    return (
      <div role="alert" className="space-y-2">
        <p className="flex items-start gap-2 text-footnote text-danger">
          <XCircle size={14} className="mt-0.5 shrink-0" /> {phase.message}
        </p>
        <Button type="button" size="sm" onClick={() => void prepare()}>
          Réessayer
        </Button>
      </div>
    );
  }

  const offer = phase.offer;
  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-1 px-3 py-3">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-footnote">
        <dt className="text-text-subtle">Source</dt>
        <dd>{offer.vendor}</dd>
        <dt className="text-text-subtle">Version</dt>
        <dd className="font-mono">{offer.releaseName}</dd>
        <dt className="text-text-subtle">Fichier</dt>
        <dd className="truncate font-mono">
          {offer.fileName} · {megabytes(Number(offer.size))}
        </dd>
        <dt className="text-text-subtle">Dossier</dt>
        <dd className="selectable truncate font-mono">{offer.targetDir}</dd>
      </dl>
      <p className="flex items-start gap-2 text-caption text-text-muted">
        <ShieldCheck size={12} className="mt-0.5 shrink-0 text-success" />
        Empreinte SHA-256 vérifiée après le téléchargement. Installé dans les données d'ARCHIMED : aucun droit
        administrateur, rien de modifié dans le système.
      </p>

      {phase.kind === "confirm" ? (
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => set({ kind: "idle" })}>
            Annuler
          </Button>
          <Button type="button" size="sm" variant="primary" onClick={() => void install(offer)} icon={<Download size={12} />}>
            Télécharger et installer
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5" aria-live="polite">
          <div
            role="progressbar"
            aria-label={`Installation de Java ${major}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={phase.kind === "downloading" && phase.total > 0 ? Math.round((phase.received / phase.total) * 100) : undefined}
            className="h-1.5 overflow-hidden rounded-full bg-surface-3"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-[220ms]"
              style={{
                width:
                  phase.kind === "downloading"
                    ? `${phase.total > 0 ? Math.min(100, (phase.received / phase.total) * 100) : 5}%`
                    : "100%",
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-caption text-text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" />
              {phase.kind === "downloading"
                ? `Téléchargement : ${megabytes(phase.received)} sur ${megabytes(phase.total)}`
                : phase.kind === "verifying"
                  ? "Vérification de l'empreinte…"
                  : "Décompression…"}
            </span>
            {phase.kind === "downloading" && (
              <button
                type="button"
                className="rounded-sm text-text-subtle underline-offset-2 hover:text-text hover:underline"
                onClick={() => void mcstudioApi.cancelJdkInstall(major)}
              >
                Annuler
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
