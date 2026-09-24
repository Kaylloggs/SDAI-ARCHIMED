import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCircle2, ExternalLink, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import type { GeminiStatus } from "@/core/ipc/bindings/GeminiStatus";
import type { OpenRouterStatus } from "@/core/ipc/bindings/OpenRouterStatus";
import { errorText, mcstudioApi } from "../api";
import { focusRing, inputClass } from "./ui";

type KeyStatus = { configured: boolean; problem: string | null };

/** Ce qui change d'un service à l'autre : textes, page des clés, appels. */
type Service<S extends KeyStatus> = {
  /** « OpenRouter », « Google AI Studio ». */
  name: string;
  placeholder: string;
  keysPage: string;
  /** Où part la clé, dit sous le champ. */
  destination: string;
  empty: S;
  describe: (status: S) => string;
  load: (check: boolean) => Promise<S>;
  save: (key: string) => Promise<S>;
  clear: () => Promise<void>;
};

/**
 * Clé API d'un service d'image : saisie, vérification auprès du service, puis rangement dans
 * le Gestionnaire d'identifiants de Windows. La clé ne revient jamais vers l'interface.
 */
function ApiKeyCard<S extends KeyStatus>({
  service,
  onChange,
  compact = false,
}: {
  service: Service<S>;
  onChange?: (status: S) => void;
  /** Ligne resserrée (panneau Environnement). */
  compact?: boolean;
}) {
  const [status, setStatus] = useState<S | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const publish = useCallback(
    (next: S) => {
      setStatus(next);
      onChange?.(next);
    },
    [onChange],
  );

  const { load } = service;
  useEffect(() => {
    let cancelled = false;
    load(false)
      .then((next) => !cancelled && publish(next))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [load, publish]);

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
      publish(await service.save(key));
      setKey("");
    });

  const check = () => run(async () => publish(await service.load(true)));

  const clear = () =>
    run(async () => {
      await service.clear();
      setConfirmClear(false);
      publish(service.empty);
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
          <span className="text-text-muted">{service.describe(status)}</span>
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
          <KeyRound size={14} className="text-text-subtle" /> Clé API {service.name}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label={`Clé API ${service.name}`}
          placeholder={service.placeholder}
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
        Rangée dans le Gestionnaire d'identifiants de Windows, envoyée seulement à {service.destination}.{" "}
        <button
          type="button"
          onClick={() => void openUrl(service.keysPage)}
          className={cn("inline-flex items-center gap-1 rounded-xs underline underline-offset-2 hover:text-text", focusRing)}
        >
          Créer une clé <ExternalLink size={11} />
        </button>
      </p>
    </form>
  );
}

const OPENROUTER: Service<OpenRouterStatus> = {
  name: "OpenRouter",
  placeholder: "sk-or-v1-…",
  keysPage: "https://openrouter.ai/keys",
  destination: "OpenRouter",
  empty: { configured: false, label: null, freeTier: null, creditsLeft: null, problem: null },
  describe: (status) => {
    const parts = [status.label ?? "Clé enregistrée"];
    if (status.freeTier) parts.push("compte sans crédit : modèles gratuits uniquement");
    if (status.creditsLeft !== null) parts.push(`crédit restant ${status.creditsLeft.toFixed(2)} $`);
    return parts.join(" · ");
  },
  load: mcstudioApi.openrouterStatus,
  save: mcstudioApi.setOpenrouterKey,
  clear: mcstudioApi.clearOpenrouterKey,
};

const GEMINI: Service<GeminiStatus> = {
  name: "Google AI Studio",
  placeholder: "AIza…",
  keysPage: "https://aistudio.google.com/apikey",
  destination: "Google (API Gemini)",
  empty: { configured: false, imageModels: null, problem: null },
  describe: (status) =>
    status.imageModels === null
      ? "Clé Google enregistrée"
      : `Clé Google enregistrée · ${status.imageModels} modèle${status.imageModels > 1 ? "s" : ""} d'image accessible${
          status.imageModels > 1 ? "s" : ""
        }`,
  load: mcstudioApi.geminiStatus,
  save: mcstudioApi.setGeminiKey,
  clear: mcstudioApi.clearGeminiKey,
};

export function OpenRouterKeyCard(props: { onChange?: (status: OpenRouterStatus) => void; compact?: boolean }) {
  return <ApiKeyCard service={OPENROUTER} {...props} />;
}

/** Clé Google AI Studio, pour les modèles d'image Gemini (« Nano Banana »). */
export function GeminiKeyCard(props: { onChange?: (status: GeminiStatus) => void; compact?: boolean }) {
  return <ApiKeyCard service={GEMINI} {...props} />;
}
