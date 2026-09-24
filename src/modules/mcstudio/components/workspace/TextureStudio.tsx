import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowRight, Check, ChevronRight, CloudOff, ImageUp, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button, Select } from "@/design-system/primitives";
import type { ImageModelList } from "@/core/ipc/bindings/ImageModelList";
import type { OpenRouterStatus } from "@/core/ipc/bindings/OpenRouterStatus";
import type { PixelOptions } from "@/core/ipc/bindings/PixelOptions";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import type { TextureDraft } from "@/core/ipc/bindings/TextureDraft";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import { errorText, mcstudioApi } from "../../api";
import {
  COLOR_CHOICES,
  defaultOptions,
  DESCRIPTION_PLACEHOLDER,
  KIND_LABEL,
  MAX_DESCRIPTION,
  modelOptions,
  pickModel,
  SIZE_CHOICES,
} from "../../lib/textures";
import { OpenRouterKeyCard } from "../OpenRouterKeyCard";
import { Checker, Field, focusRing, inputClass, PixelImage, Segmented, Switch } from "../ui";

type Mode = "ai" | "file";
type Phase = "idle" | "generating" | "importing" | "applying";

function PixelSettings({
  options,
  onChange,
  disabled,
}: {
  options: PixelOptions;
  onChange: (options: PixelOptions) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Segmented
        label="Taille de la texture"
        value={options.size}
        options={SIZE_CHOICES}
        disabled={disabled}
        onChange={(size) => onChange({ ...options, size })}
      />
      <div className="w-[160px]">
        <Select
          label="Nombre de couleurs"
          value={String(options.colors)}
          options={COLOR_CHOICES}
          disabled={disabled}
          onChange={(value) => onChange({ ...options, colors: Number(value) })}
        />
      </div>
      <Switch checked={options.transparent} disabled={disabled} onChange={(transparent) => onChange({ ...options, transparent })}>
        Retirer le fond
      </Switch>
    </div>
  );
}

/**
 * Atelier d'une texture : description envoyée à un modèle d'image d'OpenRouter (ou image
 * importée), conversion en pixel-art réglable, aperçu, puis application au projet.
 */
export function TextureStudio({
  project,
  texture,
  onApplied,
}: {
  project: ProjectSummary;
  texture: TextureInfo;
  onApplied: (info: TextureInfo) => void;
}) {
  const target = texture.target;
  const [mode, setMode] = useState<Mode>("ai");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState<PixelOptions>(() => defaultOptions(target));
  const [key, setKey] = useState<OpenRouterStatus | null>(null);
  const [models, setModels] = useState<ImageModelList | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [allowPaid, setAllowPaid] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<TextureDraft | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [converting, setConverting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const conversion = useRef(0);
  const draftRef = useRef<HTMLElement>(null);
  const busy = phase !== "idle";

  useEffect(() => {
    let cancelled = false;
    mcstudioApi
      .openrouterStatus(false)
      .then((status) => !cancelled && setKey(status))
      .catch(() => !cancelled && setKey({ configured: false, label: null, freeTier: null, creditsLeft: null, problem: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  const loadModels = useCallback(() => {
    setModelsError(null);
    mcstudioApi
      .imageModels()
      .then(setModels)
      .catch((e) => setModelsError(errorText(e)));
  }, []);
  useEffect(() => {
    if (key?.configured && !models && !modelsError) loadModels();
  }, [key?.configured, models, modelsError, loadModels]);

  useEffect(() => {
    setModel((current) => pickModel(models?.models ?? [], current, allowPaid));
  }, [models, allowPaid]);

  // Texte réellement envoyé, recalculé quand la description change.
  useEffect(() => {
    if (!showPrompt) return;
    const timer = setTimeout(() => {
      mcstudioApi
        .texturePrompt(target, description)
        .then(setPrompt)
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [showPrompt, description, target]);

  // Une nouvelle proposition arrive sous le formulaire : on l'amène à l'écran.
  useEffect(() => {
    if (draft?.revision === 1) draftRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [draft?.id, draft?.revision]);

  useEffect(() => {
    if (phase !== "generating") return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const run = async (next: Phase, work: () => Promise<void>) => {
    setPhase(next);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPhase("idle");
    }
  };

  const generate = () =>
    run("generating", async () => {
      if (!model) return;
      setDraft(
        await mcstudioApi.generateTexture(project.id, { target, description, model, options, allowPaid }),
      );
    });

  const importFile = async () => {
    const file = await openDialog({
      multiple: false,
      title: `Image pour ${texture.label}`,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof file !== "string") return;
    await run("importing", async () => setDraft(await mcstudioApi.importTexture(project.id, target, file, options)));
  };

  /** Réglages modifiés : la même image est reconvertie aussitôt, sans réseau. */
  const changeOptions = (next: PixelOptions) => {
    setOptions(next);
    if (!draft) return;
    const ticket = ++conversion.current;
    setConverting(true);
    mcstudioApi
      .reprocessTexture(draft.id, next)
      .then((updated) => ticket === conversion.current && setDraft(updated))
      .catch((e) => setError(errorText(e)))
      .finally(() => ticket === conversion.current && setConverting(false));
  };

  const apply = () =>
    run("applying", async () => {
      if (!draft) return;
      const info = await mcstudioApi.applyTexture(project.id, draft.id);
      setNotice(
        texture.exists
          ? `Texture écrite dans ${info.relative}. L'ancienne est gardée dans .mcstudio/history/textures/.`
          : `Texture écrite dans ${info.relative}.`,
      );
      setDraft(null);
      onApplied(info);
    });

  const chosen = models?.models.find((m) => m.id === model) ?? null;
  const noFreeModel = models !== null && !models.models.some((m) => m.free);
  const descriptionProblem = description.length > MAX_DESCRIPTION ? `${MAX_DESCRIPTION} caractères au plus.` : null;
  const canGenerate =
    !busy && key?.configured && !!model && description.trim().length > 0 && !descriptionProblem;
  // L'icône est agrandie à 64 px au moins ; les autres textures gardent leur taille.
  const pixelSide = target.kind === "icon" ? Math.max(options.size, 64) : options.size;
  const scales = target.kind === "icon" ? [1] : [1, 2, 4];

  return (
    <div className="mx-auto max-w-[760px] space-y-6">
      <header className="flex items-center gap-4">
        <Checker size={72}>
          {texture.exists ? (
            <PixelImage path={texture.path} version={texture.modified ?? 0} size={64} alt={`Texture actuelle de ${texture.label}`} />
          ) : (
            <span className="text-caption text-text-subtle">Aucune</span>
          )}
        </Checker>
        <div className="min-w-0">
          <h2 className="truncate text-title-3 font-semibold">{texture.label}</h2>
          <p className="truncate text-footnote text-text-subtle">
            {KIND_LABEL[target.kind]}
            {target.kind !== "icon" && <span className="font-mono"> · {target.id}</span>}
            {texture.exists ? ` · ${texture.width}×${texture.height}` : " · pas encore de texture"}
          </p>
          <p className="selectable truncate font-mono text-caption text-text-subtle">{texture.relative}</p>
        </div>
      </header>

      <Segmented
        label="Source de la texture"
        value={mode}
        onChange={setMode}
        disabled={busy}
        options={[
          { value: "ai", label: "Générer avec l'IA" },
          { value: "file", label: "Importer une image" },
        ]}
      />

      {mode === "ai" ? (
        key && !key.configured ? (
          <div className="space-y-2">
            <p className="text-body-sm text-text-muted">
              Les textures sont dessinées par un modèle d'image d'OpenRouter, avec votre clé. Plusieurs modèles sont
              gratuits (quotas limités par OpenRouter).
            </p>
            <OpenRouterKeyCard onChange={setKey} />
          </div>
        ) : (
          <div className="space-y-4">
            <Field
              id="mc-texture-description"
              label="Description"
              problem={descriptionProblem}
              hint={`${description.length} / ${MAX_DESCRIPTION} · en français ou en anglais`}
            >
              <textarea
                id="mc-texture-description"
                value={description}
                rows={3}
                disabled={busy}
                placeholder={DESCRIPTION_PLACEHOLDER[target.kind]}
                onChange={(event) => setDescription(event.target.value)}
                className={cn(inputClass, "h-auto resize-y py-2 leading-relaxed")}
              />
            </Field>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[240px] flex-1">
                  <Select
                    label="Modèle d'image"
                    value={model ?? ""}
                    options={modelOptions(models?.models ?? [], allowPaid)}
                    onChange={setModel}
                    disabled={busy || !models}
                    placeholder={models ? "Aucun modèle disponible" : "Chargement des modèles…"}
                  />
                </div>
                <button
                  type="button"
                  aria-label="Recharger la liste des modèles"
                  title="Recharger la liste des modèles"
                  disabled={busy}
                  onClick={() => {
                    // L'effet ci-dessus relit la liste.
                    setModelsError(null);
                    setModels(null);
                  }}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md text-text-subtle transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40",
                    focusRing,
                  )}
                >
                  <RefreshCw size={14} />
                </button>
                <Switch checked={allowPaid} disabled={busy} onChange={setAllowPaid}>
                  Autoriser les modèles payants
                </Switch>
              </div>
              {chosen?.description && <p className="text-caption text-text-subtle">{chosen.description}</p>}
              {allowPaid && (
                <p className="text-caption text-warning">
                  Un modèle payant est facturé sur votre crédit OpenRouter à chaque image (tarif sur openrouter.ai).
                </p>
              )}
              {models?.offline && (
                <p className="flex items-center gap-1.5 text-caption text-text-subtle">
                  <CloudOff size={12} /> OpenRouter injoignable : dernière liste connue.
                </p>
              )}
              {noFreeModel && !allowPaid && (
                <p className="text-footnote text-warning">
                  Aucun modèle d'image gratuit sur OpenRouter en ce moment. Autorisez les modèles payants (crédit
                  requis) ou importez une image.
                </p>
              )}
              {modelsError && <p className="text-footnote text-danger">{modelsError}</p>}
            </div>
          </div>
        )
      ) : (
        <p className="text-body-sm text-text-muted">
          PNG, JPEG ou WebP : un dessin, une photo, une texture trouvée ailleurs (vérifiez sa licence). Elle est
          convertie au format Minecraft ci-dessous ; rien n'est écrit tant que vous n'avez pas appliqué.
        </p>
      )}

      <div className="space-y-2">
        <p className="text-footnote font-medium text-text-muted">Conversion en pixel-art</p>
        <PixelSettings options={options} onChange={changeOptions} disabled={busy} />
      </div>

      {mode === "ai" && key?.configured && (
        <div className="space-y-2">
          <button
            type="button"
            aria-expanded={showPrompt}
            onClick={() => setShowPrompt((v) => !v)}
            className={cn("flex items-center gap-1.5 rounded-sm text-footnote text-text-subtle hover:text-text", focusRing)}
          >
            <ChevronRight size={12} className={cn("transition-transform duration-[140ms]", showPrompt && "rotate-90")} />
            Texte envoyé au modèle
          </button>
          {showPrompt && (
            <p className="selectable rounded-md border border-border bg-surface-1 px-3 py-2 font-mono text-caption text-text-muted">
              {prompt || "…"}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {mode === "ai" && !key?.configured ? null : mode === "ai" ? (
          <Button
            type="button"
            variant="primary"
            disabled={!canGenerate}
            onClick={() => void generate()}
            icon={phase === "generating" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          >
            {phase === "generating" ? "Génération…" : draft ? "Nouvelle proposition" : "Générer"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() => void importFile()}
            icon={phase === "importing" ? <Loader2 size={14} className="animate-spin" /> : <ImageUp size={14} />}
          >
            Choisir une image…
          </Button>
        )}
        {phase === "generating" && (
          <p aria-live="polite" className="text-footnote text-text-subtle tabular-nums">
            {elapsed} s · 5 à 60 s selon le modèle
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-footnote">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="flex items-start gap-2 rounded-md border border-success/40 bg-success-soft px-3 py-2 text-footnote">
          <Check size={14} className="mt-0.5 shrink-0 text-success" /> {notice}
        </p>
      )}

      {draft && (
        <section ref={draftRef} aria-labelledby="mc-draft" className="space-y-4 rounded-lg border border-border bg-surface-1 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="mc-draft" className="text-body-sm font-semibold">
              Proposition
            </h3>
            <p className="text-caption text-text-subtle">
              {draft.source.kind === "openRouter" ? `Dessinée par ${chosen?.name ?? draft.source.model}` : `Importée de ${draft.source.name}`}
              {` · image reçue ${draft.originalWidth}×${draft.originalHeight}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <figure className="space-y-1.5">
              <Checker size={200}>
                <img
                  src={convertFileSrc(draft.originalPath)}
                  alt="Image reçue"
                  draggable={false}
                  className="max-h-full max-w-full object-contain"
                />
              </Checker>
              <figcaption className="text-caption text-text-subtle">Image reçue</figcaption>
            </figure>
            <ArrowRight size={16} className="text-text-subtle" aria-hidden />
            <figure className="space-y-1.5">
              <Checker size={200} className={cn(converting && "opacity-60")}>
                <PixelImage path={draft.pixelPath} version={draft.revision} size={192} alt="Texture convertie" />
              </Checker>
              <figcaption className="text-caption text-text-subtle">
                Texture {pixelSide}×{pixelSide}
                {converting && " · conversion…"}
              </figcaption>
            </figure>
            <figure className="space-y-1.5">
              <div className="flex items-end gap-2">
                {scales.map((scale) => (
                  <Checker key={scale} size={pixelSide * scale + 8}>
                    <PixelImage path={draft.pixelPath} version={draft.revision} size={pixelSide * scale} />
                  </Checker>
                ))}
              </div>
              <figcaption className="text-caption text-text-subtle">
                {scales.length > 1 ? "Taille réelle, ×2, ×4" : "Taille réelle"}
              </figcaption>
            </figure>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              disabled={busy || converting}
              onClick={() => void apply()}
              icon={phase === "applying" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            >
              Appliquer au projet
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(null)} icon={<X size={14} />}>
              Abandonner
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
