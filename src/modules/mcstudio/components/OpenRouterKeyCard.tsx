import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCircle2, ExternalLink, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import type { OpenRouterStatus } from "@/core/ipc/bindings/OpenRouterStatus";
import { errorText, mcstudioApi } from "../api";
import { focusRing, inputClass } from "./ui";

const KEYS_PAGE = "https://openrouter.ai/keys";

function describe(status: OpenRouterStatus): string {
  const parts = [status.label ?? "Clé enregistrée"];
  if (status.freeTier) parts.push("compte sans crédit : modèles gratuits uniquement");
  if (status.creditsLeft !== null) parts.push(`crédit restant ${status.creditsLeft.toFixed(2)} $`);
  return parts.join(" · ");
}

/**
 * Clé API OpenRouter : saisie, vérification auprès d'OpenRouter, puis rangement dans le
 * Gestionnaire d'identifiants de Windows. La clé ne revient jamais vers l'interface.
 */
export function OpenRouterKeyCard({
  onChange,
  compact = false,
}: {
  onChange?: (status: OpenRouterStatus) => void;
  /** Ligne resserrée (panneau Environnement). */
  compact?: boolean;
}) {
  const [status, setStatus] = useState<OpenRouterStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const publish = useCallback(
    (next: OpenRouterStatus) => {
      setStatus(next);
      onChange?.(next);
    },
    [onChange],
  );

  useEffect(() => {
    let cancelled = false;
    mcstudioApi
      .openrouterStatus(false)
      .then((next) => !cancelled && publish(next))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [publish]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      publish(await mcstudioApi.setOpenrouterKey(key));
      setKey("");
    });

  const check = () => run(async () => publish(await mcstudioApi.openrouterStatus(true)));

  const clear = () =>
    run(async () => {
      await mcstudioApi.clearOpenrouterKey();
      setConfirmClear(false);
      publish({ configured: false, label: null, freeTier: null, creditsLeft: null, problem: null });
    });

  if (!status) {
    return error ? (
      <p className="text-footnote text-danger">{error}</p>
    ) : (
      <Loader2 size={14} className="animate-spin text-text-subtle" aria-label="Lecture de la clé" />
    );
  }

  if (status.configured) {
    return (
      <div className="space-y-2">
        <p className="flex items-start gap-1.5 text-footnote text-success">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <span className="text-text-muted">{describe(status)}</span>
        </p>
        {status.problem && <p className="text-footnote text-warning">{status.problem}</p>}
        {error && (
          <p role="alert" className="text-footnote text-danger">
            {error}
          </p>
        )}
        {confirmClear ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-footnote text-text-muted">La clé sera retirée de cet ordinateur.</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
              Annuler
            </Button>
            <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => void clear()}>
              Retirer la clé
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void check()}
              icon={busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            >
              Vérifier
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmClear(true)}>
              Retirer…
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <form
      className={cn("space-y-2", !compact && "rounded-md border border-border bg-surface-1 p-3")}
      onSubmit={(event) => {
        event.preventDefault();
        if (key.trim()) void save();
      }}
    >
      {!compact && (
        <p className="flex items-center gap-2 text-body-sm font-medium">
          <KeyRound size={14} className="text-text-subtle" /> Clé API OpenRouter
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label="Clé API OpenRouter"
          placeholder="sk-or-v1-…"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          className={cn(inputClass, "min-w-0 flex-1 font-mono")}
        />
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={busy || !key.trim()}
          icon={busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
        >
          Vérifier et enregistrer
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      )}
      <p className="text-caption text-text-subtle">
        Rangée dans le Gestionnaire d'identifiants de Windows, envoyée seulement à OpenRouter.{" "}
        <button
          type="button"
          onClick={() => void openUrl(KEYS_PAGE)}
          className={cn("inline-flex items-center gap-1 rounded-xs underline underline-offset-2 hover:text-text", focusRing)}
        >
          Créer une clé <ExternalLink size={11} />
        </button>
      </p>
    </form>
  );
}
