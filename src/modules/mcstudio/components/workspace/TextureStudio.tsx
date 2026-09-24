import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Brush, CloudOff, ImageUp, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button, Select } from "@/design-system/primitives";
import type { BlockFace } from "@/core/ipc/bindings/BlockFace";
import type { CropRect } from "@/core/ipc/bindings/CropRect";
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
  optionsSummary,
  outputAspect,
  pickModel,
  PROVIDER_LABEL,
  saveProvider,
  SIZE_CHOICES,
  targetKey,
  TILING_CHOICES,
} from "../../lib/textures";
import { GeminiKeyCard, OpenRouterKeyCard } from "../ApiKeyCard";
import { Checker, focusRing, inputClass, PixelImage, Segmented, Switch } from "../ui";
import { BlockFaces } from "./textures/BlockFaces";
import type { CubeFaces } from "./textures/Previews";
import { DEFAULT_PROMPT, PromptPanel, promptSettings, promptSummary, type PromptChoice } from "./textures/PromptPanel";
import { Section } from "./textures/Section";
import { Stage } from "./textures/Stage";

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
    <div className="space-y-1.5 text-footnote text-text-muted">
      <p>Les modèles d'image de Google (Nano Banana) dessinent avec une clé Google AI Studio.</p>
      <p className="text-text-subtle">
        L'abonnement Gemini (Google AI Pro) ne donne pas accès à l'API : la clé se crée sur aistudio.google.com avec le
        même compte, et chaque image est facturée sur son projet Google. Les crédits Google Cloud de Google AI Pro s'y
        appliquent.
      </p>
    </div>
  ) : (
    <p className="text-footnote text-text-muted">
      Les modèles d'image d'OpenRouter dessinent avec votre clé. Les modèles gratuits, quand il y en a, ont des quotas.
    </p>
  );
}

function Label({ children }: { children: string }) {
  return <p className="text-footnote font-medium text-text-muted">{children}</p>;
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
    <div className="flex-1 space-y-1.5">
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
    <div className="space-y-3">
      {gui ? (
        <div className="flex gap-2">
          <NumberField id="mc-gui-w" label="Largeur" value={options.width ?? 176} disabled={disabled} onChange={(width) => onChange({ ...options, width, crop: null })} />
          <NumberField id="mc-gui-h" label="Hauteur" value={options.height ?? 166} disabled={disabled} onChange={(height) => onChange({ ...options, height, crop: null })} />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>Taille</Label>
          <Segmented label="Taille de la texture" value={options.size} options={SIZE_CHOICES} disabled={disabled} onChange={(size) => onChange({ ...options, size })} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Couleurs</Label>
        <Select
          label="Nombre de couleurs"
          value={String(options.colors)}
          options={COLOR_CHOICES}
          disabled={disabled}
          className="w-full"
          onChange={(value) => onChange({ ...options, colors: Number(value) })}
        />
      </div>
      {!options.transparent && !gui && (
        <div className="space-y-1.5">
          <Label>Raccord quand elle est répétée</Label>
          <Segmented label="Raccord de la texture répétée" value={options.tiling} options={TILING_CHOICES} disabled={disabled} onChange={(tiling) => onChange({ ...options, tiling })} />
        </div>
      )}
      <div className="-ml-2 flex flex-col items-start">
        <Switch checked={options.transparent} disabled={disabled} onChange={(transparent) => onChange({ ...options, transparent })}>
          Retirer le fond
        </Switch>
        {options.transparent && !gui && (
          <Switch checked={options.outline} disabled={disabled} onChange={(outline) => onChange({ ...options, outline })}>
            Contour sombre
          </Switch>
        )}
        {gui && (
          <Switch checked={options.atlas} disabled={disabled} onChange={(atlas) => onChange({ ...options, atlas })}>
            Toile 256 × 256 (écrans du jeu)
          </Switch>
        )}
      </div>
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
 * Atelier d'une texture, en deux zones : la scène (la texture, son cadrage, sa retouche au
 * pixel, ses aperçus et les propositions déjà faites) et l'inspecteur (source, service et
 * modèle, description, style et texte envoyé, conversion).
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
  const [history, setHistory] = useState<TextureDraft[]>([]);
  const [confirmReprocess, setConfirmReprocess] = useState<PixelOptions | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [converting, setConverting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const conversion = useRef(0);
  const busy = phase !== "idle";
  const key = keys[provider];
  const allowPaid = paid[provider];
  const gui = target.kind === "gui";

  useEffect(() => {
    memory.set(memoryKey(target), { description, prompt });
  }, [target, description, prompt]);

  const block = blockOf(target);
  const faces = useMemo(() => (block ? textures.filter((t) => blockOf(t.target) === block) : []), [textures, block]);
  const references = useMemo(() => textures.filter((t) => t.exists), [textures]);
  const cube = useMemo(() => cubeFor(texture, faces), [texture, faces]);

  // Propositions déjà faites pour cette texture.
  const loadHistory = useCallback(() => {
    mcstudioApi
      .textureHistory(project.id, target)
      .then(setHistory)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, targetKey(target)]);
  useEffect(() => loadHistory(), [loadHistory]);

  /** Une proposition devient la proposition ouverte ; l'historique la montre aussitôt. */
  const show = useCallback((next: TextureDraft) => {
    setDraft(next);
    setHistory((list) => [next, ...list.filter((d) => d.id !== next.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, []);

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
  const guiSize = gui ? { width: options.width ?? 176, height: options.height ?? 166 } : null;
  // Sans modèle choisi, on laisse préparer la référence ; le backend vérifie à l'envoi.
  const referenceAllowed = chosen ? chosen.imageInput : true;

  /** Nouvelle image : la zone choisie sur la précédente ne vaut plus. */
  const fresh = (): PixelOptions => {
    const next = { ...options, crop: null };
    setOptions(next);
    return next;
  };

  const generate = () =>
    run("generating", async () => {
      if (!model) return;
      show(
        await mcstudioApi.generateTexture(project.id, {
          target,
          description,
          provider,
          model,
          options: fresh(),
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
    await run("importing", async () => show(await mcstudioApi.importTexture(project.id, target, file, fresh())));
  };

  const openCurrent = () => run("opening", async () => show(await mcstudioApi.editTexture(project.id, target)));

  const reprocess = (next: PixelOptions) => {
    if (!draft) return;
    const ticket = ++conversion.current;
    setConverting(true);
    setError(null);
    mcstudioApi
      .reprocessTexture(draft.id, next)
      .then((updated) => ticket === conversion.current && show(updated))
      .catch((e) => setError(errorText(e)))
      .finally(() => ticket === conversion.current && setConverting(false));
  };

  /** Réglages ou zone modifiés : la même image est reconvertie aussitôt, sans réseau (les
   * retouches au pixel seraient perdues : on demande d'abord). */
  const changeOptions = (next: PixelOptions) => {
    setOptions(next);
    if (!draft || draft.source.kind === "project") return;
    if (draft.edited) setConfirmReprocess(next);
    else reprocess(next);
  };
  const changeCrop = (crop: CropRect | null) => changeOptions({ ...options, crop });

  /** Proposition rouverte depuis l'historique : ses réglages reviennent avec elle. */
  const reopen = (previous: TextureDraft) => {
    setConfirmReprocess(null);
    setOptions(previous.options);
    setDraft(previous);
  };

  const remove = (gone: TextureDraft) => {
    void mcstudioApi
      .deleteDraft(gone.id)
      .then(() => {
        setHistory((list) => list.filter((d) => d.id !== gone.id));
        if (draft?.id === gone.id) setDraft(null);
      })
      .catch((e) => setError(errorText(e)));
  };

  const apply = () =>
    run("applying", async () => {
      if (!draft) return;
      const info = await mcstudioApi.applyTexture(project.id, draft.id);
      setNotice(
        texture.exists
          ? `Écrite dans ${info.relative}. L'ancienne est gardée dans .mcstudio/history/textures/.`
          : `Écrite dans ${info.relative}.`,
      );
      setDraft(null);
      onApplied(info);
    });

  const noFreeModel = models !== null && models.models.length > 0 && !models.models.some((m) => m.free);
  const descriptionProblem = description.length > MAX_DESCRIPTION ? `${MAX_DESCRIPTION} caractères au plus.` : null;
  const customReady = prompt.custom !== null && prompt.custom.trim().length > 0;
  const canGenerate = !busy && key === true && !!model && (customReady || (description.trim().length > 0 && !descriptionProblem));
  const sourceLabel = !draft
    ? ""
    : draft.source.kind === "file"
      ? `Importée de ${draft.source.name}`
      : draft.source.kind === "project"
        ? "Texture du projet"
        : `Dessinée par ${chosen?.id === draft.source.model ? chosen.name : draft.source.model}`;
  const modelSummary = key === false ? "clé à ajouter" : chosen ? chosen.name : PROVIDER_LABEL[provider];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-5">
        <Checker size={40}>
          {texture.exists ? (
            <PixelImage path={texture.path} version={texture.modified ?? 0} size={32} alt="" />
          ) : (
            <span className="text-caption text-text-subtle">?</span>
          )}
        </Checker>
        <div className="min-w-0">
          <h2 className="truncate text-body font-semibold">{texture.label}</h2>
          <p className="selectable truncate text-caption text-text-subtle" title={texture.relative}>
            {KIND_LABEL[target.kind]}
            {texture.exists ? ` · ${texture.width}×${texture.height}` : " · pas encore de texture"}
            <span className="font-mono"> · {texture.relative.split("/").slice(-2).join("/")}</span>
          </p>
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

      {/* Large : scène et inspecteur côte à côte, chacun défile. Étroit : l'un sous l'autre. */}
      <div className="@container min-h-0 flex-1">
        <div className="flex h-full flex-col overflow-y-auto @3xl:flex-row @3xl:overflow-hidden">
        <main aria-label="Scène" className="min-w-0 shrink-0 bg-bg @3xl:flex-1 @3xl:shrink @3xl:overflow-y-auto">
          <Stage
            texture={texture}
            draft={draft}
            onDraft={show}
            crop={options.crop}
            cropAspect={outputAspect(options)}
            onCrop={changeCrop}
            cropBusy={converting}
            sourceLabel={sourceLabel}
            tiled={target.kind === "block" && !options.transparent}
            cube={cube}
            notice={notice}
            history={history}
            onOpen={reopen}
            onDelete={remove}
            applying={phase === "applying"}
            onApply={apply}
            onClose={() => setDraft(null)}
          />
        </main>

        <aside
          aria-label="Inspecteur"
          className="flex shrink-0 flex-col border-t border-border bg-surface-1 @3xl:w-[340px] @3xl:border-l @3xl:border-t-0"
        >
          <div className="flex-1 @3xl:overflow-y-auto">
            <Section title="Source" collapsible={false}>
              <Segmented
                label="Source de la texture"
                value={mode}
                onChange={setMode}
                disabled={busy}
                options={[
                  { value: "ai", label: "IA" },
                  { value: "file", label: "Image" },
                  { value: "edit", label: "Retouche" },
                ]}
              />
              <p className="text-caption text-text-subtle">
                {mode === "ai"
                  ? "Un modèle d'image dessine à partir de votre description."
                  : mode === "file"
                    ? "PNG, JPEG ou WebP (vérifiez sa licence), converti au format du jeu."
                    : texture.exists
                      ? "La texture actuelle, telle quelle, dans l'éditeur de pixels."
                      : "Rien à retoucher : générez ou importez d'abord une image."}
              </p>
            </Section>

            {mode === "ai" && (
              <>
                <Section title="Service et modèle" summary={modelSummary} defaultOpen={key !== true || !model}>
                  <Segmented
                    label="Service d'image"
                    value={provider}
                    onChange={chooseProvider}
                    disabled={busy}
                    options={[
                      { value: "openRouter", label: PROVIDER_LABEL.openRouter },
                      { value: "gemini", label: "Gemini (Nano Banana)" },
                    ]}
                  />
                  {key === false ? (
                    <div className="space-y-3">
                      <KeyIntro provider={provider} />
                      {provider === "gemini" ? (
                        <GeminiKeyCard key="gemini" onChange={onGeminiKey} />
                      ) : (
                        <OpenRouterKeyCard key="openRouter" onChange={onOpenRouterKey} />
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1">
                        <Select
                          label="Modèle d'image"
                          value={model ?? ""}
                          options={modelOptions(models?.models ?? [], allowPaid, provider)}
                          onChange={setModel}
                          disabled={busy || !models}
                          className="min-w-0 flex-1"
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
                            "flex size-7 shrink-0 items-center justify-center rounded-sm text-text-subtle transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40",
                            focusRing,
                          )}
                        >
                          <RefreshCw size={14} />
                        </button>
                      </div>
                      <div className="-ml-2">
                        <Switch checked={allowPaid} disabled={busy} onChange={(allowed) => setPaid((p) => ({ ...p, [provider]: allowed }))}>
                          {provider === "gemini" ? "Accepter la facturation Google" : "Autoriser les modèles payants"}
                        </Switch>
                      </div>
                      {chosen?.description && <p className="text-caption text-text-subtle">{chosen.description}</p>}
                      {allowPaid && (
                        <p className="text-caption text-warning">
                          {provider === "gemini"
                            ? "Chaque image est facturée par Google sur le projet de votre clé (quelques centimes l'image)."
                            : "Un modèle payant est facturé sur votre crédit OpenRouter à chaque image."}
                        </p>
                      )}
                      {models?.offline && (
                        <p className="flex items-center gap-1.5 text-caption text-text-subtle">
                          <CloudOff size={12} /> {PROVIDER_LABEL[provider]} injoignable : dernière liste connue.
                        </p>
                      )}
                      {models !== null && models.models.length === 0 && (
                        <p className="text-caption text-warning">
                          {provider === "gemini"
                            ? "Aucun modèle d'image Gemini n'est ouvert à cette clé (pays non couvert ou projet sans l'API Gemini)."
                            : "OpenRouter ne propose aucun modèle d'image en ce moment."}
                        </p>
                      )}
                      {noFreeModel && !allowPaid && (
                        <p className="text-caption text-warning">
                          {provider === "gemini"
                            ? "Les modèles d'image de Gemini sont payants : acceptez la facturation pour générer."
                            : "Aucun modèle gratuit en ce moment : autorisez les payants, passez à Gemini, ou importez une image."}
                        </p>
                      )}
                      {modelsError && <p className="text-caption text-danger">{modelsError}</p>}
                    </>
                  )}
                </Section>

                <Section title={block ? "Description du bloc" : "Description"} collapsible={false}>
                  <textarea
                    id="mc-texture-description"
                    aria-label="Description"
                    aria-describedby="mc-texture-description-hint"
                    value={description}
                    rows={4}
                    disabled={busy || prompt.custom !== null}
                    placeholder={DESCRIPTION_PLACEHOLDER[target.kind]}
                    onChange={(event) => setDescription(event.target.value)}
                    className={cn(inputClass, "h-auto resize-y py-2 leading-relaxed")}
                  />
                  <p id="mc-texture-description-hint" className={cn("text-caption", descriptionProblem ? "text-danger" : "text-text-subtle")}>
                    {descriptionProblem ??
                      (prompt.custom !== null
                        ? "Texte écrit à la main : la description n'est plus utilisée."
                        : `${description.length} / ${MAX_DESCRIPTION} · français ou anglais${block ? " · commune aux faces" : ""}`)}
                  </p>
                </Section>

                <Section title="Style et texte envoyé" summary={promptSummary(prompt)} defaultOpen={false}>
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
                </Section>
              </>
            )}

            {mode !== "edit" && (
              <Section title="Conversion en pixel-art" summary={optionsSummary(options, gui)} defaultOpen={false}>
                <PixelSettings target={target} options={options} onChange={changeOptions} disabled={busy} />
                {converting && <p className="text-caption text-text-subtle">Conversion…</p>}
              </Section>
            )}
          </div>

          <div className="sticky bottom-0 space-y-2 border-t border-border bg-surface-1 p-4">
            {confirmReprocess && (
              <div role="alert" className="space-y-2 rounded-md bg-warning-soft p-2.5">
                <p className="text-footnote">Reconvertir l'image effacera vos retouches au pixel.</p>
                <div className="flex gap-2">
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
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmReprocess(null)}>
                    Garder mes retouches
                  </Button>
                </div>
              </div>
            )}
            {error && (
              <p role="alert" className="text-footnote text-danger">
                {error}
              </p>
            )}
            {mode === "ai" ? (
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="w-full"
                disabled={!canGenerate}
                onClick={() => void generate()}
                icon={phase === "generating" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              >
                {phase === "generating" ? `Génération… ${elapsed} s` : draft ? "Nouvelle proposition" : "Générer"}
              </Button>
            ) : mode === "file" ? (
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="w-full"
                disabled={busy}
                onClick={() => void importFile()}
                icon={phase === "importing" ? <Loader2 size={16} className="animate-spin" /> : <ImageUp size={16} />}
              >
                Choisir une image…
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="w-full"
                disabled={busy || !texture.exists}
                onClick={() => void openCurrent()}
                icon={phase === "opening" ? <Loader2 size={16} className="animate-spin" /> : <Brush size={16} />}
              >
                Ouvrir dans l'éditeur
              </Button>
            )}
            {phase === "generating" && <p className="text-center text-caption text-text-subtle">5 à 60 s selon le modèle</p>}
            {mode === "ai" && key === true && !model && models && (
              <p className="text-center text-caption text-text-subtle">Choisissez un modèle pour générer.</p>
            )}
          </div>
        </aside>
        </div>
      </div>
    </div>
  );
}
