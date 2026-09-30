import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, KeyRound, Loader2, LogIn, Sparkles, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, Select } from "@/design-system/primitives";
import type { GameAsset } from "@/core/ipc/bindings/GameAsset";
import type { GameAssetKind } from "@/core/ipc/bindings/GameAssetKind";
import type { ProviderId } from "@/core/ipc/bindings/ProviderId";
import type { ProviderModel } from "@/core/ipc/bindings/ProviderModel";
import type { ProviderStatus } from "@/core/ipc/bindings/ProviderStatus";
import { errorText, gameStudioApi } from "../../../api";
import { canBeTransparent, imageModels, modelPrice, suggestName } from "../../../lib/assets";
import { ASSET_KIND, IMAGE_KINDS } from "../../../lib/labels";
import { useGameStudioStore } from "../../../store";
import { ErrorLine, focusRing, TextArea, TextInput } from "../../ui";

/** Demande préparée : nouvelle ressource, ou nouvelle version d'une ressource générée. */
export type ImageDraft = { asset: GameAsset | null; prompt: string; kind: GameAssetKind };

const READY = new Set(["connected", "disconnected"]);

const STATE_LOOK: Record<string, { label: string; tone: "success" | "neutral" | "warning" | "danger" }> = {
  connected: { label: "Connecté", tone: "success" },
  disconnected: { label: "Clé enregistrée", tone: "neutral" },
  error: { label: "Injoignable", tone: "warning" },
  authRequired: { label: "Clé refusée", tone: "danger" },
  apiKeyMissing: { label: "Pas de clé", tone: "neutral" },
  modelUnavailable: { label: "Aucun modèle d'image", tone: "warning" },
  cliMissing: { label: "Outil à installer", tone: "neutral" },
};

/** Libellé au-dessus du contrôle (formulaire en colonnes). */
function Labeled({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-footnote font-medium text-text-muted">
          {label}
        </label>
        {hint && <span className="text-caption text-text-subtle">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Connexion d'un fournisseur : clé rangée dans le coffre du système, ou compte (navigateur). */
function Connect({ status, onChange }: { status: ProviderStatus; onChange: (next: ProviderStatus) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (work: () => Promise<ProviderStatus>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await work());
      setKey("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (status.access === "account") {
    return (
      <div className="space-y-1.5">
        <Button size="sm" icon={busy ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />} disabled={busy} onClick={() => void act(() => gameStudioApi.imageLogin(status.provider))}>
          Se connecter dans le navigateur
        </Button>
        {status.detail && <p className="text-footnote text-text-muted">{status.detail}</p>}
        <ErrorLine message={error} onClose={() => setError(null)} />
      </div>
    );
  }
  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (key.trim()) void act(() => gameStudioApi.setImageKey(status.provider, key));
      }}
    >
      <div className="flex gap-2">
        <div className="relative flex-1">
          <KeyRound size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle" aria-hidden />
          <TextInput
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={status.keyHint}
            aria-label={`Clé ${status.name}`}
            className="w-full pl-8 font-mono"
          />
        </div>
        <Button type="submit" variant="primary" size="sm" disabled={busy || !key.trim()} icon={busy ? <Loader2 size={13} className="animate-spin" /> : undefined}>
          Vérifier et enregistrer
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-footnote text-text-subtle">Rangée dans le coffre du système, jamais dans le projet ni dans les journaux.</p>
        <button type="button" onClick={() => void openUrl(status.keyUrl)} className={cn("inline-flex shrink-0 items-center gap-1 text-footnote text-accent hover:underline", focusRing)}>
          Obtenir une clé <ExternalLink size={12} />
        </button>
      </div>
      <ErrorLine message={error} onClose={() => setError(null)} />
    </form>
  );
}

/**
 * Génération d'une image pour le jeu : fournisseur et modèle réels, consigne relue avant l'envoi
 * (demande, usage dans le jeu, charte du projet), fichier écrit dans les ressources avec sa trace.
 */
export function GeneratePanel({ projectId, draft, styleEmpty, onDone, onClose }: { projectId: string; draft: ImageDraft; styleEmpty: boolean; onDone: (asset: GameAsset) => void; onClose: () => void }) {
  const [statuses, setStatuses] = useState<ProviderStatus[] | null>(null);
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [models, setModels] = useState<ProviderModel[] | null>(null);
  const [modelNote, setModelNote] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [kind, setKind] = useState<GameAssetKind>(draft.kind);
  const [prompt, setPrompt] = useState(draft.prompt);
  const [name, setName] = useState(draft.asset?.name ?? "");
  const [nameTouched, setNameTouched] = useState(Boolean(draft.asset));
  const [ratio, setRatio] = useState<string>("");
  const [transparent, setTransparent] = useState(false);
  const [useStyle, setUseStyle] = useState(!styleEmpty);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void gameStudioApi
      .imageProviders(false)
      .then((list) => {
        if (!alive) return;
        setStatuses(list);
        setProvider((current) => current ?? list.find((s) => READY.has(s.state))?.provider ?? list[0]?.provider ?? null);
      })
      .catch((e) => setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, []);

  const status = statuses?.find((s) => s.provider === provider) ?? null;
  const ready = Boolean(status && READY.has(status.state));

  useEffect(() => {
    setModels(null);
    setModelNote(null);
    if (!provider || !ready) return;
    let alive = true;
    void gameStudioApi
      .imageModels(provider)
      .then((list) => {
        if (!alive) return;
        const usable = imageModels(list.models);
        setModels(usable);
        setModelNote(list.offline ? "Liste reprise du cache : le fournisseur n'a pas répondu." : list.note);
        setModel((current) => (usable.some((m) => m.id === current) ? current : (usable[0]?.id ?? "")));
      })
      .catch((e) => setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [provider, ready]);

  const chosen = models?.find((m) => m.id === model);
  const caps = chosen?.capabilities;
  const transparentOk = canBeTransparent(caps, kind);
  const price = modelPrice(chosen);

  // La consigne réellement envoyée, relue avant de dépenser quoi que ce soit.
  useEffect(() => {
    if (!prompt.trim()) {
      setSent(null);
      return;
    }
    const timer = setTimeout(() => {
      void gameStudioApi
        .imagePrompt(projectId, prompt, kind, useStyle, transparentOk && transparent)
        .then(setSent)
        .catch(() => setSent(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [projectId, prompt, kind, useStyle, transparent, transparentOk]);

  const providerOptions = useMemo(
    () => (statuses ?? []).map((s) => ({ value: s.provider, label: s.name, hint: STATE_LOOK[s.state]?.label })),
    [statuses],
  );

  const generate = async () => {
    if (!provider || !model) return;
    setBusy(true);
    setError(null);
    try {
      const asset = await gameStudioApi.generateImage(projectId, {
        provider,
        model,
        prompt,
        name: name.trim() || suggestName(prompt),
        kind,
        asset: draft.asset?.id ?? null,
        aspectRatio: ratio || null,
        resolution: null,
        seed: null,
        negativePrompt: null,
        transparent: transparentOk && transparent,
        useStyle,
      });
      void useGameStudioStore.getState().reload();
      onDone(asset);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Générer une image" className="space-y-4 rounded-lg border border-border bg-surface-1 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="flex items-center gap-2 text-body font-semibold">
            <Sparkles size={15} className="text-accent" aria-hidden />
            {draft.asset ? `Nouvelle version de « ${draft.asset.name} »` : "Générer une image"}
          </h3>
          <p className="text-footnote text-text-muted">L'image est écrite dans les ressources du jeu avec le fournisseur, le modèle et la consigne, pour la refaire ou la modifier.</p>
        </div>
        <Button size="sm" variant="ghost" aria-label="Fermer" onClick={onClose} disabled={busy}>
          <X size={14} />
        </Button>
      </header>

      {statuses === null ? (
        <p className="text-footnote text-text-subtle">Lecture des fournisseurs…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Labeled label="Fournisseur">
              <Select label="Fournisseur" value={provider ?? ""} onChange={(v) => setProvider(v as ProviderId)} options={providerOptions} className="w-64" />
            </Labeled>
            {status && (
              <Badge tone={STATE_LOOK[status.state]?.tone ?? "neutral"}>
                {STATE_LOOK[status.state]?.label ?? status.state}
                {status.keySource?.kind === "shared" ? ` · clé de ${status.keySource.module}` : ""}
              </Badge>
            )}
          </div>
          {status && !ready && <Connect status={status} onChange={(next) => setStatuses((list) => (list ?? []).map((s) => (s.provider === next.provider ? next : s)))} />}
        </>
      )}

      {ready && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Modèle" hint={price ?? undefined}>
              {models === null ? (
                <p className="text-footnote text-text-subtle">Lecture des modèles…</p>
              ) : models.length === 0 ? (
                <p className="text-footnote text-text-muted">{modelNote ?? "Aucun modèle d'image ouvert avec cette connexion."}</p>
              ) : (
                <Select label="Modèle" value={model} onChange={setModel} options={models.map((m) => ({ value: m.id, label: m.name, hint: m.free ? "sans frais" : undefined }))} className="w-full" />
              )}
            </Labeled>
            <Labeled label="Nature">
              <Select label="Nature" value={kind} onChange={(v) => setKind(v as GameAssetKind)} disabled={Boolean(draft.asset)} options={IMAGE_KINDS.map((k) => ({ value: k, label: ASSET_KIND[k] }))} className="w-full" />
            </Labeled>
          </div>
          <Labeled label="Ce que l'image montre" htmlFor="gs-image-prompt">
            <TextArea
              id="gs-image-prompt"
              value={prompt}
              rows={3}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (!nameTouched) setName(suggestName(e.target.value));
              }}
              placeholder="ex. Caisse en bois usée, planches clouées, coins renforcés de métal"
            />
          </Labeled>
          <div className="grid gap-3 sm:grid-cols-2">
            {!draft.asset && (
              <Labeled label="Nom de la ressource" htmlFor="gs-image-name">
                <TextInput
                  id="gs-image-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameTouched(true);
                  }}
                  placeholder="Caisse en bois"
                />
              </Labeled>
            )}
            {caps && caps.aspectRatios.length > 0 && (
              <Labeled label="Format">
                <Select label="Format" value={ratio} onChange={setRatio} options={[{ value: "", label: "Par défaut du modèle" }, ...caps.aspectRatios.map((r) => ({ value: r, label: r }))]} className="w-full" />
              </Labeled>
            )}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-body-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={useStyle} onChange={(e) => setUseStyle(e.target.checked)} className="accent-[var(--color-accent)]" />
              Suivre la charte graphique du projet
            </label>
            {transparentOk && (
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} className="accent-[var(--color-accent)]" />
                Fond transparent
              </label>
            )}
          </div>
          {useStyle && styleEmpty && <p className="text-footnote text-text-muted">La charte du projet est vide : remplissez-la dans Conception pour que toutes les images se ressemblent.</p>}
          {sent && (
            <details className="rounded-md bg-surface-2 px-3 py-2">
              <summary className={cn("cursor-pointer text-footnote text-text-muted", focusRing)}>Consigne envoyée au modèle</summary>
              <p className="whitespace-pre-wrap pt-1.5 font-mono text-caption text-text">{sent}</p>
            </details>
          )}
          <ErrorLine message={error} onClose={() => setError(null)} />
          <div className="flex items-center justify-end gap-2">
            {busy && (
              <Button size="sm" variant="ghost" onClick={() => void gameStudioApi.cancelImage(projectId).catch(() => undefined)}>
                Annuler
              </Button>
            )}
            <Button variant="primary" icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} disabled={busy || !model || !prompt.trim() || (!draft.asset && !(name.trim() || suggestName(prompt)))} onClick={() => void generate()}>
              {busy ? "Génération…" : draft.asset ? "Générer la nouvelle version" : "Générer"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
