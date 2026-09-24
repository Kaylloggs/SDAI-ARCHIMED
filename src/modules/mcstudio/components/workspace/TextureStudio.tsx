import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
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
  defaultOptions,
  kindLabel,
  loadProvider,
  MAX_DESCRIPTION,
  outputAspect,
  pickModel,
  placeholderFor,
  saveProvider,
  targetKey,
} from "../../lib/textures";
import { Checker, focusRing, PixelImage } from "../ui";
import { BlockFaces } from "./textures/BlockFaces";
import { Composer, type ModelState } from "./textures/Composer";
import { Filmstrip } from "./textures/Filmstrip";
import type { CubeFaces } from "./textures/Previews";
import { DEFAULT_PROMPT, promptSettings, type PromptChoice } from "./textures/PromptPanel";
import { Workbench, type SaveState } from "./textures/Workbench";

type Phase = "idle" | "generating" | "importing" | "opening" | "applying" | "deleting";

/**
 * Description et réglages du texte, gardés pendant la session : les faces d'un bloc partagent
 * les leurs (on décrit le bloc une fois, puis chaque face).
 */
const memory = new Map<string, { description: string; prompt: PromptChoice }>();

function memoryKey(target: TextureTarget): string {
  const block = blockOf(target);
  return block ? `block:${block}` : targetKey(target);
}

/** Faces du cube d'inventaire, depuis les textures du bloc et l'image de la face ouverte. */
function cubeFor(texture: TextureInfo, faces: TextureInfo[]): ((src: string) => CubeFaces) | null {
  if (texture.target.kind !== "block" || texture.unused) return null;
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
 * Atelier d'une texture : la texture au centre (éditeur de pixels, cadrage, aperçu en jeu),
 * ses versions dessous, et la barre de création en bas (description, modèle, style, fond,
 * import). Appliquer, fermer ou supprimer se fait depuis l'en-tête.
 */
export function TextureStudio({
  project,
  texture,
  textures,
  onApplied,
  onSelect,
  onLayoutChanged,
  onDeleted,
}: {
  project: ProjectSummary;
  texture: TextureInfo;
  /** Toutes les textures du projet (références, faces du même bloc). */
  textures: TextureInfo[];
  onApplied: (info: TextureInfo) => void;
  onSelect: (target: TextureTarget) => void;
  onLayoutChanged: (faces: TextureInfo[]) => void;
  onDeleted: () => void;
}) {
  const target = texture.target;
  const remembered = memory.get(memoryKey(target));
  const [description, setDescription] = useState(remembered?.description ?? "");
  const [prompt, setPrompt] = useState<PromptChoice>(remembered?.prompt ?? DEFAULT_PROMPT);
  const [options, setOptions] = useState<PixelOptions>(() => defaultOptions(target, texture));
  const [provider, setProvider] = useState<ImageProvider>(loadProvider);
  const [keys, setKeys] = useState<Record<ImageProvider, boolean | null>>({ openRouter: null, gemini: null });
  const [models, setModels] = useState<ImageModelList | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [paid, setPaid] = useState<Record<ImageProvider, boolean>>({ openRouter: false, gemini: false });
  const [draft, setDraft] = useState<TextureDraft | null>(null);
  const [history, setHistory] = useState<TextureDraft[]>([]);
  const [confirmReprocess, setConfirmReprocess] = useState<PixelOptions | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [converting, setConverting] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const conversion = useRef(0);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const busy = phase !== "idle";
  const key = keys[provider];
  const allowPaid = paid[provider];

  useEffect(() => {
    memory.set(memoryKey(target), { description, prompt });
  }, [target, description, prompt]);

  const block = texture.unused ? null : blockOf(target);
  const faces = useMemo(() => (block ? textures.filter((t) => !t.unused && blockOf(t.target) === block) : []), [textures, block]);
  const references = useMemo(() => textures.filter((t) => t.exists), [textures]);
  const cube = useMemo(() => cubeFor(texture, faces), [texture, faces]);

  // Versions déjà faites pour cette texture.
  useEffect(() => {
    mcstudioApi
      .textureHistory(project.id, target)
      .then(setHistory)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, targetKey(target)]);

  /** Une proposition devient celle du plan de travail ; la bande des versions la montre. */
  const show = useCallback((next: TextureDraft) => {
    setDraft(next);
    setHistory((list) => [next, ...list.filter((d) => d.id !== next.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, []);

  const setKeyConfigured = useCallback(
    (service: ImageProvider, configured: boolean) => setKeys((current) => ({ ...current, [service]: configured })),
    [],
  );

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
  // Taille annoncée au modèle : éléments d'interface et textures libres (superposition…).
  const guiSize =
    target.kind === "gui" || target.kind === "asset"
      ? { width: options.width ?? 176, height: options.height ?? 166 }
      : null;
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
      await flushRef.current();
      const request = fresh();
      show(
        await mcstudioApi.generateTexture(project.id, {
          target,
          description,
          provider,
          model,
          options: request,
          allowPaid,
          prompt: promptSettings(prompt, guiSize, request.transparent),
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

  const retouch = () => run("opening", async () => show(await mcstudioApi.editTexture(project.id, target)));

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

  /** Zone ou fond modifiés : la même image est reconvertie aussitôt, sans réseau (les
   * retouches au pixel seraient perdues : on demande d'abord). */
  const changeOptions = (next: PixelOptions) => {
    setOptions(next);
    if (!draft || draft.source.kind === "project") return;
    if (draft.edited) setConfirmReprocess(next);
    else reprocess(next);
  };
  const changeCrop = (crop: CropRect | null) => changeOptions({ ...options, crop });

  /** Version rouverte depuis la bande : ses réglages reviennent avec elle. */
  const reopen = async (previous: TextureDraft) => {
    await flushRef.current();
    setConfirmReprocess(null);
    setOptions(previous.options);
    setDraft(previous);
  };

  const closeDraft = async () => {
    await flushRef.current();
    setConfirmReprocess(null);
    setDraft(null);
  };

  const removeDraft = (gone: TextureDraft) => {
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
      await flushRef.current();
      const info = await mcstudioApi.applyTexture(project.id, draft.id);
      setNotice(texture.exists ? "Appliquée. L'ancienne est gardée dans .mcstudio/history/textures/." : "Appliquée au projet.");
      setDraft(null);
      onApplied(info);
    });

  const deleteTexture = () =>
    run("deleting", async () => {
      await mcstudioApi.deleteTextures(project.id, [texture.relative]);
      setConfirmDelete(false);
      onDeleted();
    });

  const handwritten = prompt.custom !== null && prompt.custom.trim().length > 0;
  const canGenerate =
    !busy && key === true && !!model && (handwritten || (description.trim().length > 0 && description.length <= MAX_DESCRIPTION));

  const modelState: ModelState = {
    provider,
    onProvider: chooseProvider,
    key,
    onKey: setKeyConfigured,
    models,
    modelsError,
    onReload: () => {
      setModelsError(null);
      setModels(null);
    },
    model,
    onModel: setModel,
    chosen,
    allowPaid,
    onAllowPaid: (allowed) => setPaid((p) => ({ ...p, [provider]: allowed })),
  };

  const status =
    saveState === "pending" || saveState === "saving"
      ? "Enregistrement des retouches…"
      : saveState === "saved"
        ? "Retouches enregistrées"
        : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-1.5">
        <Checker size={30}>
          {texture.exists ? (
            <PixelImage path={texture.path} version={texture.modified ?? 0} size={24} alt="" />
          ) : (
            <span className="text-caption text-text-subtle">?</span>
          )}
        </Checker>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-body font-semibold">{texture.label}</h2>
          <p
            className="selectable truncate text-caption text-text-subtle"
            title={texture.usedBy ? `${texture.relative}\nUtilisée par ${texture.usedBy}` : texture.relative}
          >
            {texture.unused ? "Texture inutilisée" : kindLabel(texture)}
            {texture.exists ? ` · ${texture.width}×${texture.height}` : " · pas encore de texture"}
            <span className="font-mono">
              {" · "}
              {texture.relative.includes("/textures/")
                ? texture.relative.split("/textures/").at(-1)
                : texture.relative.split("/").at(-1)}
            </span>
            {texture.usedBy && <> · utilisée par {texture.usedBy.split("/").at(-1)}</>}
          </p>
        </div>

        <div className="flex items-center gap-2 whitespace-nowrap">
          {(notice || status) && (
            <span aria-live="polite" className={cn("flex items-center gap-1 text-caption", notice ? "text-success" : "text-text-subtle")}>
              {notice && <Check size={12} aria-hidden />}
              {notice ?? status}
            </span>
          )}
          {confirmDelete ? (
            <>
              <span className="text-footnote text-text-muted">Mettre la texture à la Corbeille ?</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Annuler
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => void deleteTexture()}
                icon={phase === "deleting" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              >
                Supprimer
              </Button>
            </>
          ) : (
            <>
              {texture.exists && (
                <button
                  type="button"
                  aria-label="Supprimer la texture"
                  title="Supprimer la texture (Corbeille)"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md text-text-subtle transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-40",
                    focusRing,
                  )}
                >
                  <Trash2 size={16} strokeWidth={1.75} />
                </button>
              )}
              {draft && (
                <>
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void closeDraft()} icon={<X size={14} />}>
                    Fermer
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={busy || converting || saveState === "saving"}
                    onClick={() => void apply()}
                    icon={phase === "applying" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  >
                    Appliquer au projet
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </header>

      {block ? (
        <BlockFaces
          projectId={project.id}
          block={block}
          texture={texture}
          faces={faces}
          disabled={busy}
          onSelect={onSelect}
          onLayoutChanged={onLayoutChanged}
        />
      ) : texture.unused ? (
        <p className="border-b border-border px-4 py-2.5 text-footnote text-text-subtle">
          Aucun objet, bloc ni modèle ne se sert de cette texture (par exemple une face laissée par un changement de
          répartition). Supprimez-la si vous n'en avez plus besoin.
        </p>
      ) : null}

      {confirmReprocess && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-border bg-warning-soft px-4 py-2">
          <p className="flex-1 text-footnote">Reconvertir l'image effacera vos retouches au pixel.</p>
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

      <Workbench
        texture={texture}
        draft={draft}
        onDraft={show}
        crop={options.crop}
        cropAspect={outputAspect(options)}
        onCrop={changeCrop}
        converting={converting}
        generating={phase === "generating"}
        elapsed={elapsed}
        tiled={target.kind === "block" && !options.transparent}
        cube={cube}
        onRetouch={() => void retouch()}
        retouchBusy={phase === "opening"}
        onSaveState={setSaveState}
        flushRef={flushRef}
      />

      {error && (
        <p role="alert" className="border-t border-border bg-danger-soft px-4 py-2 text-footnote">
          {error}
        </p>
      )}

      <div className="shrink-0 border-t border-border">
        <Filmstrip
          texture={texture}
          drafts={history}
          current={draft?.id ?? null}
          onCurrent={() => void closeDraft()}
          onOpen={(d) => void reopen(d)}
          onDelete={removeDraft}
        />
        <Composer
          target={target}
          description={description}
          onDescription={setDescription}
          placeholder={placeholderFor(texture)}
          shared={block !== null}
          prompt={prompt}
          onPrompt={setPrompt}
          references={references}
          guiSize={guiSize}
          transparent={options.transparent}
          onTransparent={(transparent) => changeOptions({ ...options, transparent })}
          modelState={modelState}
          canGenerate={canGenerate}
          generating={phase === "generating"}
          busy={busy}
          onGenerate={() => void generate()}
          onImport={() => void importFile()}
        />
      </div>
    </div>
  );
}
