import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Brush, Check, CloudOff, ImageUp, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button, Select } from "@/design-system/primitives";
import type { BlockFace } from "@/core/ipc/bindings/BlockFace";
import type { ImageModelList } from "@/core/ipc/bindings/ImageModelList";
import type { ImageProvider } from "@/core/ipc/bindings/ImageProvider";
import type { PixelOptions } from "@/core/ipc/bindings/PixelOptions";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import type { TextureDraft } from "@/core/ipc/bindings/TextureDraft";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import type { TextureTarget } from "@/core/ipc/bindings/TextureTarget";
import { errorText, mcstudioApi } from "../../api";
import {
  blockOf,
  COLOR_CHOICES,
  defaultOptions,
  DESCRIPTION_PLACEHOLDER,
  KIND_LABEL,
  loadProvider,
  MAX_DESCRIPTION,
  modelOptions,
  pickModel,
  PROVIDER_LABEL,
  saveProvider,
  SIZE_CHOICES,
  targetKey,
  TILING_CHOICES,
} from "../../lib/textures";
import { GeminiKeyCard, OpenRouterKeyCard } from "../ApiKeyCard";
import { Checker, Field, focusRing, inputClass, PixelImage, Segmented, Switch } from "../ui";
import { BlockFaces } from "./textures/BlockFaces";
import { DraftPanel } from "./textures/DraftPanel";
import { DEFAULT_PROMPT, PromptPanel, promptSettings, type PromptChoice } from "./textures/PromptPanel";
import type { CubeFaces } from "./textures/Previews";

type Mode = "ai" | "file" | "edit";
type Phase = "idle" | "generating" | "importing" | "opening" | "applying";

/**
 * Description et réglages du texte, gardés pendant la session : les faces d'un bloc partagent
 * les leurs (on décrit le bloc une fois, puis chaque face).
 */
const memory = new Map<string, { description: string; prompt: PromptChoice }>();

function memoryKey(target: TextureTarget): string {
  const block = blockOf(target);
  return block ? `block:${block}` : targetKey(target);
}

/** Ce que la personne doit savoir avant d'ajouter la clé d'un service. */
function KeyIntro({ provider }: { provider: ImageProvider }) {
  return provider === "gemini" ? (
    <div className="space-y-1.5 text-body-sm text-text-muted">
      <p>Les textures sont dessinées par les modèles d'image de Google (Nano Banana), avec une clé Google AI Studio.</p>
      <p className="text-footnote">
        L'abonnement Gemini (Google AI Pro) ne donne pas accès à l'API : la clé se crée sur aistudio.google.com avec le
        même compte, et chaque image est facturée sur le projet Google de la clé. Les crédits Google Cloud offerts avec
        Google AI Pro s'y appliquent.
      </p>
    </div>
  ) : (
    <p className="text-body-sm text-text-muted">
      Les textures sont dessinées par un modèle d'image d'OpenRouter, avec votre clé. Les modèles gratuits, quand OpenRouter
      en propose, sont limités par des quotas.
    </p>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="w-[96px] space-y-1.5">
      <label htmlFor={id} className="block text-footnote font-medium text-text-muted">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={1}
        max={256}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = Math.round(Number(event.target.value));
          if (Number.isFinite(next)) onChange(Math.max(1, Math.min(256, next)));
        }}
        className={cn(inputClass, "tabular-nums")}
      />
    </div>
  );
}

/** Réglages de conversion : taille, couleurs, fond, raccord, contour, toile d'interface. */
function PixelSettings({
  target,
  options,
  onChange,
  disabled,
}: {
  target: TextureTarget;
  options: PixelOptions;
  onChange: (options: PixelOptions) => void;
  disabled: boolean;
}) {
  const gui = target.kind === "gui";
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
      {gui ? (
        <>
          <NumberField id="mc-gui-w" label="Largeur" value={options.width ?? 176} disabled={disabled} onChange={(width) => onChange({ ...options, width })} />
          <NumberField id="mc-gui-h" label="Hauteur" value={options.height ?? 166} disabled={disabled} onChange={(height) => onChange({ ...options, height })} />
        </>
      ) : (
        <Segmented
          label="Taille de la texture"
          value={options.size}
          options={SIZE_CHOICES}
          disabled={disabled}
          onChange={(size) => onChange({ ...options, size })}
        />
      )}
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
      {options.transparent ? (
        target.kind !== "gui" && (
          <Switch checked={options.outline} disabled={disabled} onChange={(outline) => onChange({ ...options, outline })}>
            Contour sombre
          </Switch>
        )
      ) : (
        !gui && (
          <div className="space-y-1.5">
            <p className="text-footnote font-medium text-text-muted">Raccord</p>
            <Segmented
              label="Raccord de la texture répétée"
              value={options.tiling}
              options={TILING_CHOICES}
              disabled={disabled}
              onChange={(tiling) => onChange({ ...options, tiling })}
            />
          </div>
        )
      )}
      {gui && (
        <Switch checked={options.atlas} disabled={disabled} onChange={(atlas) => onChange({ ...options, atlas })}>
          Toile 256 × 256
        </Switch>
      )}
    </div>
  );
}

/** Faces du cube d'inventaire, depuis les textures du bloc et l'image de la face ouverte. */
function cubeFor(texture: TextureInfo, faces: TextureInfo[]): ((src: string) => CubeFaces) | null {
  if (texture.target.kind !== "block") return null;
  const current = texture.target.face;
  const layout = texture.layout ?? "all";
  return (src) => {
    const url = (face: BlockFace | null): string | null => {
      if (face === current) return src;
      const info = faces.find((f) => f.target.kind === "block" && f.target.face === face);
      return info?.exists ? `${convertFileSrc(info.path)}?v=${info.modified ?? 0}` : null;
    };
    switch (layout) {
      case "column":
        return { top: url("end"), left: url("side"), right: url("side") };
      case "bottomTop":
        return { top: url("top"), left: url("side"), right: url("side") };
      case "faces":
        return { top: url("top"), left: url("north"), right: url("east") };
      default:
        return { top: src, left: src, right: src };
    }
  };
}

/**
 * Atelier d'une texture : description envoyée à un modèle d'image (OpenRouter ou Google
 * Gemini), image importée ou texture actuelle, conversion en pixel-art réglable, retouche au
 * pixel, aperçus (répétée, en bloc), puis application au projet.
 */
export function TextureStudio({
  project,
  texture,
  textures,
  onApplied,
  onSelect,
  onLayoutChanged,
}: {
  project: ProjectSummary;
  texture: TextureInfo;
  /** Toutes les textures du projet (références, faces du même bloc). */
  textures: TextureInfo[];
  onApplied: (info: TextureInfo) => void;
  onSelect: (target: TextureTarget) => void;
  onLayoutChanged: (faces: TextureInfo[]) => void;
}) {
  const target = texture.target;
  const remembered = memory.get(memoryKey(target));
  const [mode, setMode] = useState<Mode>("ai");
  const [description, setDescription] = useState(remembered?.description ?? "");
  const [prompt, setPrompt] = useState<PromptChoice>(remembered?.prompt ?? DEFAULT_PROMPT);
  const [options, setOptions] = useState<PixelOptions>(() => defaultOptions(target, texture));
  const [provider, setProvider] = useState<ImageProvider>(loadProvider);
  /** Clé présente pour chaque service (`null` : pas encore lu). */
  const [keys, setKeys] = useState<Record<ImageProvider, boolean | null>>({ openRouter: null, gemini: null });
  const [models, setModels] = useState<ImageModelList | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  /** Accord pour les modèles payants, donné service par service. */
  const [paid, setPaid] = useState<Record<ImageProvider, boolean>>({ openRouter: false, gemini: false });
  const [draft, setDraft] = useState<TextureDraft | null>(null);
  const [confirmReprocess, setConfirmReprocess] = useState<PixelOptions | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [converting, setConverting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const conversion = useRef(0);
  const draftRef = useRef<HTMLDivElement>(null);
  const busy = phase !== "idle";
  const key = keys[provider];
  const allowPaid = paid[provider];

  useEffect(() => {
    memory.set(memoryKey(target), { description, prompt });
  }, [target, description, prompt]);

  const block = blockOf(target);
  const faces = useMemo(
    () => (block ? textures.filter((t) => blockOf(t.target) === block) : []),
    [textures, block],
  );
  const references = useMemo(() => textures.filter((t) => t.exists), [textures]);
  const cube = useMemo(() => cubeFor(texture, faces), [texture, faces]);

  const setKeyConfigured = useCallback(
    (service: ImageProvider, configured: boolean) => setKeys((current) => ({ ...current, [service]: configured })),
    [],
  );
  const onOpenRouterKey = useCallback((s: { configured: boolean }) => setKeyConfigured("openRouter", s.configured), [setKeyConfigured]);
  const onGeminiKey = useCallback((s: { configured: boolean }) => setKeyConfigured("gemini", s.configured), [setKeyConfigured]);

  useEffect(() => {
    let cancelled = false;
    const read = (service: ImageProvider, status: Promise<{ configured: boolean }>) =>
      status
        .then((s) => !cancelled && setKeyConfigured(service, s.configured))
        .catch(() => !cancelled && setKeyConfigured(service, false));
    void read("openRouter", mcstudioApi.openrouterStatus(false));
    void read("gemini", mcstudioApi.geminiStatus(false));
    return () => {
      cancelled = true;
    };
  }, [setKeyConfigured]);

  // Autre service : sa propre liste de modèles.
  const current = useRef(provider);
  const chooseProvider = (next: ImageProvider) => {
    if (next === provider) return;
    current.current = next;
    saveProvider(next);
    setProvider(next);
    setModels(null);
    setModelsError(null);
    setModel(null);
  };

  const loadModels = useCallback(() => {
    const service = current.current;
    setModelsError(null);
    (service === "gemini" ? mcstudioApi.geminiImageModels() : mcstudioApi.imageModels())
      .then((list) => current.current === service && setModels(list))
      .catch((e) => current.current === service && setModelsError(errorText(e)));
  }, []);
  useEffect(() => {
    if (key && !models && !modelsError) loadModels();
  }, [key, provider, models, modelsError, loadModels]);

  useEffect(() => {
    setModel((chosen) => pickModel(models?.models ?? [], chosen, allowPaid));
  }, [models, allowPaid]);

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

  const chosen = models?.models.find((m) => m.id === model) ?? null;
  const guiSize = target.kind === "gui" ? { width: options.width ?? 176, height: options.height ?? 166 } : null;
  // Sans modèle choisi, on laisse préparer la référence ; le backend vérifie à l'envoi.
  const referenceAllowed = chosen ? chosen.imageInput : true;

  const generate = () =>
    run("generating", async () => {
      if (!model) return;
      setDraft(
        await mcstudioApi.generateTexture(project.id, {
          target,
          description,
          provider,
          model,
          options,
          allowPaid,
          prompt: promptSettings(prompt, guiSize),
          customPrompt: prompt.custom,
          reference: referenceAllowed ? prompt.reference : null,
        }),
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

  const openCurrent = () => run("opening", async () => setDraft(await mcstudioApi.editTexture(project.id, target)));

  const reprocess = (next: PixelOptions) => {
    if (!draft) return;
    const ticket = ++conversion.current;
    setConverting(true);
    mcstudioApi
      .reprocessTexture(draft.id, next)
      .then((updated) => ticket === conversion.current && setDraft(updated))
      .catch((e) => setError(errorText(e)))
      .finally(() => ticket === conversion.current && setConverting(false));
  };

  /** Réglages modifiés : la même image est reconvertie aussitôt, sans réseau (les retouches
   * au pixel seraient perdues : on demande d'abord). */
  const changeOptions = (next: PixelOptions) => {
    setOptions(next);
    if (!draft || draft.source.kind === "project") return;
    if (draft.edited) setConfirmReprocess(next);
    else reprocess(next);
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

  const noFreeModel = models !== null && models.models.length > 0 && !models.models.some((m) => m.free);
  const descriptionProblem = description.length > MAX_DESCRIPTION ? `${MAX_DESCRIPTION} caractères au plus.` : null;
  const customReady = prompt.custom !== null && prompt.custom.trim().length > 0;
  const canGenerate =
    !busy && key === true && !!model && (customReady || (description.trim().length > 0 && !descriptionProblem));
  const sourceLabel = !draft
    ? ""
    : draft.source.kind === "file"
      ? `Importée de ${draft.source.name}`
      : draft.source.kind === "project"
        ? "Texture actuelle du projet"
        : `Dessinée par ${chosen?.id === draft.source.model ? chosen.name : draft.source.model}`;

  return (
    <div className="mx-auto max-w-[860px] space-y-6">
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
            {(target.kind === "item" || target.kind === "block") && <span className="font-mono"> · {target.id}</span>}
            {texture.exists ? ` · ${texture.width}×${texture.height}` : " · pas encore de texture"}
          </p>
          <p className="selectable truncate font-mono text-caption text-text-subtle">{texture.relative}</p>
        </div>
      </header>

      {block && (
        <BlockFaces
          projectId={project.id}
          block={block}
          texture={texture}
          faces={faces}
          disabled={busy}
          onSelect={onSelect}
          onLayoutChanged={onLayoutChanged}
        />
      )}

      <Segmented
        label="Source de la texture"
        value={mode}
        onChange={setMode}
        disabled={busy}
        options={[
          { value: "ai", label: "Générer avec l'IA" },
          { value: "file", label: "Importer une image" },
          { value: "edit", label: "Retoucher l'actuelle" },
        ]}
      />

      {mode === "ai" && (
        <div className="space-y-4">
          <Segmented
            label="Service d'image"
            value={provider}
            onChange={chooseProvider}
            disabled={busy}
            options={[
              { value: "openRouter", label: PROVIDER_LABEL.openRouter },
              { value: "gemini", label: `${PROVIDER_LABEL.gemini} (Nano Banana)` },
            ]}
          />
          {key === false ? (
            <div className="space-y-2">
              <KeyIntro provider={provider} />
              {provider === "gemini" ? (
                <GeminiKeyCard key="gemini" onChange={onGeminiKey} />
              ) : (
                <OpenRouterKeyCard key="openRouter" onChange={onOpenRouterKey} />
              )}
            </div>
          ) : (
            <>
              <Field
                id="mc-texture-description"
                label={block ? "Description du bloc" : "Description"}
                problem={descriptionProblem}
                hint={`${description.length} / ${MAX_DESCRIPTION} · en français ou en anglais${block ? " · partagée par les faces du bloc" : ""}`}
              >
                <textarea
                  id="mc-texture-description"
                  value={description}
                  rows={3}
                  disabled={busy || prompt.custom !== null}
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
                      options={modelOptions(models?.models ?? [], allowPaid, provider)}
                      onChange={setModel}
                      disabled={busy || !models}
                      placeholder={
                        !models
                          ? "Chargement des modèles…"
                          : models.models.length > 0
                            ? provider === "gemini"
                              ? "Acceptez la facturation Google"
                              : "Modèles payants : autorisez-les"
                            : "Aucun modèle disponible"
                      }
                    />
                  </div>
                  <button
                    type="button"
                    aria-label="Recharger la liste des modèles"
                    title="Recharger la liste des modèles"
                    disabled={busy}
                    onClick={() => {
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
                  <Switch
                    checked={allowPaid}
                    disabled={busy}
                    onChange={(allowed) => setPaid((current) => ({ ...current, [provider]: allowed }))}
                  >
                    {provider === "gemini" ? "Accepter la facturation Google" : "Autoriser les modèles payants"}
                  </Switch>
                </div>
                {chosen?.description && <p className="text-caption text-text-subtle">{chosen.description}</p>}
                {allowPaid && (
                  <p className="text-caption text-warning">
                    {provider === "gemini"
                      ? "Chaque image est facturée par Google sur le projet de votre clé (quelques centimes l'image, tarifs sur ai.google.dev/pricing)."
                      : "Un modèle payant est facturé sur votre crédit OpenRouter à chaque image (tarif sur openrouter.ai)."}
                  </p>
                )}
                {models?.offline && (
                  <p className="flex items-center gap-1.5 text-caption text-text-subtle">
                    <CloudOff size={12} /> {PROVIDER_LABEL[provider]} injoignable : dernière liste connue.
                  </p>
                )}
                {models !== null && models.models.length === 0 && (
                  <p className="text-footnote text-warning">
                    {provider === "gemini"
                      ? "Aucun modèle d'image Gemini n'est ouvert à cette clé (pays non couvert ou projet sans l'API Gemini)."
                      : "OpenRouter ne propose aucun modèle d'image en ce moment."}
                  </p>
                )}
                {noFreeModel && !allowPaid && (
                  <p className="text-footnote text-warning">
                    {provider === "gemini"
                      ? "Les modèles d'image de Gemini sont payants : acceptez la facturation Google pour générer, ou importez une image."
                      : "Aucun modèle d'image gratuit sur OpenRouter en ce moment. Autorisez les modèles payants (crédit requis), passez à Google Gemini, ou importez une image."}
                  </p>
                )}
                {modelsError && <p className="text-footnote text-danger">{modelsError}</p>}
              </div>

              <PromptPanel
                target={target}
                description={description}
                choice={prompt}
                onChange={setPrompt}
                references={references}
                referenceAllowed={referenceAllowed}
                guiSize={guiSize}
                disabled={busy}
              />
            </>
          )}
        </div>
      )}

      {mode === "file" && (
        <p className="text-body-sm text-text-muted">
          PNG, JPEG ou WebP : un dessin, une photo, une texture trouvée ailleurs (vérifiez sa licence). Elle est convertie au
          format Minecraft ci-dessous ; rien n'est écrit tant que vous n'avez pas appliqué.
        </p>
      )}

      {mode === "edit" && (
        <p className="text-body-sm text-text-muted">
          {texture.exists
            ? "La texture actuelle s'ouvre telle quelle dans l'éditeur de pixels : crayon, gomme, remplissage, pipette, miroir, et décalage pour travailler le raccord. Rien n'est écrit avant « Appliquer »."
            : "Cette texture n'existe pas encore : générez-la ou importez une image, puis retouchez-la."}
        </p>
      )}

      {mode !== "edit" && (
        <div className="space-y-2">
          <p className="text-footnote font-medium text-text-muted">Conversion en pixel-art</p>
          <PixelSettings target={target} options={options} onChange={changeOptions} disabled={busy} />
          {converting && <p className="text-caption text-text-subtle">Conversion…</p>}
        </div>
      )}

      {confirmReprocess && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2">
          <p className="flex-1 text-footnote">Reconvertir l'image reçue avec ces réglages effacera vos retouches au pixel.</p>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmReprocess(null)}>
            Garder mes retouches
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              reprocess(confirmReprocess);
              setConfirmReprocess(null);
            }}
          >
            Reconvertir
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {mode === "ai" ? (
          key === true && (
            <Button
              type="button"
              variant="primary"
              disabled={!canGenerate}
              onClick={() => void generate()}
              icon={phase === "generating" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            >
              {phase === "generating" ? "Génération…" : draft ? "Nouvelle proposition" : "Générer"}
            </Button>
          )
        ) : mode === "file" ? (
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() => void importFile()}
            icon={phase === "importing" ? <Loader2 size={14} className="animate-spin" /> : <ImageUp size={14} />}
          >
            Choisir une image…
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            disabled={busy || !texture.exists}
            onClick={() => void openCurrent()}
            icon={phase === "opening" ? <Loader2 size={14} className="animate-spin" /> : <Brush size={14} />}
          >
            Ouvrir dans l'éditeur
          </Button>
        )}
        {phase === "generating" && (
          <p aria-live="polite" className="text-footnote tabular-nums text-text-subtle">
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
        <div ref={draftRef}>
          <DraftPanel
            key={draft.id}
            draft={draft}
            onDraft={setDraft}
            sourceLabel={sourceLabel}
            tiled={target.kind === "block" && !options.transparent}
            cube={cube}
            applying={phase === "applying"}
            onApply={apply}
            onDiscard={() => setDraft(null)}
          />
        </div>
      )}
    </div>
  );
}
