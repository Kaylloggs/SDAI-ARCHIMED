import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowRight, Brush, Check, ImageUp, Info, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button } from "@/design-system/primitives";
import type { CropRect } from "@/core/ipc/bindings/CropRect";
import type { TextureDraft } from "@/core/ipc/bindings/TextureDraft";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import { errorText, mcstudioApi } from "../../../api";
import { ago } from "../../../lib/format";
import { decodePixels, encodePixels, type Pixels } from "../../../lib/pixels";
import { seamVerdict } from "../../../lib/textures";
import { Checker, focusRing, Segmented } from "../../ui";
import { CropSelector } from "./CropSelector";
import { PixelEditor } from "./PixelEditor";
import { BlockPreview, TilePreview, useDataUrl, type CubeFaces } from "./Previews";

type View = "frame" | "edit";

/** Retouches enregistrées dans la proposition un instant après le dernier geste. */
const SAVE_DELAY = 400;

const SOURCE_ICON = { openRouter: Sparkles, gemini: Sparkles, file: ImageUp, project: Brush } as const;

/** Propositions déjà faites pour cette texture : on y revient d'un clic. */
function History({
  drafts,
  current,
  onOpen,
  onDelete,
}: {
  drafts: TextureDraft[];
  current: string | null;
  onOpen: (draft: TextureDraft) => void;
  onDelete: (draft: TextureDraft) => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  if (drafts.length === 0) return null;
  return (
    <section aria-labelledby="mc-history" className="space-y-2">
      <h3 id="mc-history" className="text-footnote font-medium text-text-muted">
        Propositions <span className="font-normal text-text-subtle">· {drafts.length}, gardées même fermées</span>
      </h3>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {drafts.map((draft) => {
          const Icon = SOURCE_ICON[draft.source.kind];
          const active = draft.id === current;
          const asking = confirm === draft.id;
          return (
            <li key={draft.id} className="group relative shrink-0">
              <button
                type="button"
                aria-current={active ? "true" : undefined}
                aria-label={`Rouvrir la proposition de ${ago(draft.createdAt)}`}
                title={ago(draft.createdAt)}
                onClick={() => onOpen(draft)}
                className={cn(
                  "block rounded-md border p-1 transition-colors",
                  active ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong",
                  focusRing,
                )}
              >
                <Checker size={56} className="rounded-sm border-0">
                  <img
                    src={`${convertFileSrc(draft.pixelPath)}?v=${draft.revision}`}
                    alt=""
                    draggable={false}
                    className="size-12 object-contain [image-rendering:pixelated]"
                  />
                </Checker>
                <span className="mt-1 flex items-center justify-center gap-1 text-caption text-text-subtle">
                  <Icon size={11} aria-hidden />
                  {draft.edited ? "retouchée" : ago(draft.createdAt).replace("il y a ", "")}
                </span>
              </button>
              <button
                type="button"
                aria-label={asking ? "Confirmer : retirer de l'historique" : "Retirer de l'historique"}
                title={asking ? "Cliquer encore pour retirer" : "Retirer de l'historique"}
                onClick={() => {
                  if (asking) {
                    setConfirm(null);
                    onDelete(draft);
                  } else setConfirm(draft.id);
                }}
                onBlur={() => setConfirm((c) => (c === draft.id ? null : c))}
                className={cn(
                  "absolute right-0 top-0 flex size-6 items-center justify-center rounded-sm transition-opacity",
                  asking
                    ? "bg-danger text-text opacity-100"
                    : "bg-surface-3 text-text-muted opacity-0 hover:text-text group-hover:opacity-100 focus-visible:opacity-100",
                  focusRing,
                )}
              >
                <Trash2 size={12} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PreviewStrip({
  src,
  width,
  height,
  tiled,
  cube,
}: {
  src: string;
  width: number;
  height: number;
  tiled: boolean;
  cube: CubeFaces | null;
}) {
  const side = Math.max(width, height);
  const scales = side > 64 ? [1] : [1, 2, 4];
  return (
    <div className="flex flex-wrap items-end gap-6">
      <figure className="space-y-1.5">
        <div className="flex items-end gap-2">
          {scales.map((scale) => {
            const shown = Math.min(side * scale, 128);
            return (
              <Checker key={scale} size={shown + 8}>
                <img
                  src={src}
                  alt={scale === 1 ? "Texture, taille réelle" : ""}
                  draggable={false}
                  className="object-contain [image-rendering:pixelated]"
                  style={{ width: shown, height: shown }}
                />
              </Checker>
            );
          })}
        </div>
        <figcaption className="text-caption text-text-subtle">
          {width}×{height}
          {scales.length > 1 ? " · taille réelle, ×2, ×4" : ""}
        </figcaption>
      </figure>
      {tiled && (
        <figure className="space-y-1.5">
          <TilePreview src={src} width={width} height={height} side={120} />
          <figcaption className="text-caption text-text-subtle">Répétée</figcaption>
        </figure>
      )}
      {cube && (
        <figure className="space-y-1.5">
          <BlockPreview faces={cube} size={60} />
          <figcaption className="text-caption text-text-subtle">En jeu</figcaption>
        </figure>
      )}
    </div>
  );
}

/**
 * Scène de l'atelier : la texture au centre. Sans proposition, la texture actuelle ; avec une
 * proposition, son cadrage (zone de l'image reçue qui devient la texture) ou sa retouche au
 * pixel, les aperçus, l'historique des propositions et l'application au projet.
 */
export function Stage({
  texture,
  draft,
  onDraft,
  crop,
  cropAspect,
  onCrop,
  cropBusy,
  sourceLabel,
  tiled,
  cube,
  notice,
  history,
  onOpen,
  onDelete,
  applying,
  onApply,
  onClose,
}: {
  texture: TextureInfo;
  draft: TextureDraft | null;
  onDraft: (draft: TextureDraft) => void;
  crop: CropRect | null;
  cropAspect: number;
  onCrop: (crop: CropRect | null) => void;
  cropBusy: boolean;
  sourceLabel: string;
  tiled: boolean;
  cube: ((src: string) => CubeFaces) | null;
  notice: string | null;
  history: TextureDraft[];
  onOpen: (draft: TextureDraft) => void;
  onDelete: (draft: TextureDraft) => void;
  applying: boolean;
  onApply: () => Promise<void>;
  onClose: () => void;
}) {
  const canFrame = draft !== null && draft.source.kind !== "project";
  const [view, setView] = useState<View>(canFrame ? "frame" : "edit");
  const [pixels, setPixels] = useState<Pixels | null>(null);
  const [saving, setSaving] = useState<"idle" | "pending" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  /** Version (`id:révision`) écrite par nos propres retouches : pas besoin de relire les pixels. */
  const ownRevision = useRef("");
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; pixels: Pixels } | null>(null);
  const [resetKey, setResetKey] = useState("");

  // Nouvelle proposition : vue adaptée à sa source.
  useEffect(() => {
    setView(draft && draft.source.kind !== "project" ? "frame" : "edit");
    setSaving("idle");
    setError(null);
    setPixels(null);
  }, [draft?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pixels de la proposition : relus quand elle change d'ailleurs (génération, recadrage).
  useEffect(() => {
    if (!draft) {
      setPixels(null);
      return;
    }
    if (`${draft.id}:${draft.revision}` === ownRevision.current) return;
    let cancelled = false;
    mcstudioApi
      .draftPixels(draft.id)
      .then((data) => {
        if (cancelled) return;
        setPixels(decodePixels(data));
        setResetKey(`${draft.id}:${draft.revision}`);
      })
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [draft?.id, draft?.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(
    async (id: string, next: Pixels) => {
      setSaving("saving");
      try {
        const updated = await mcstudioApi.saveDraftPixels(id, encodePixels(next));
        ownRevision.current = `${updated.id}:${updated.revision}`;
        onDraft(updated);
        setSaving("saved");
      } catch (e) {
        setError(errorText(e));
        setSaving("idle");
      }
    },
    [onDraft],
  );

  const flush = useCallback(async () => {
    const waiting = pending.current;
    if (!waiting || !draft) return;
    clearTimeout(waiting.timer);
    pending.current = null;
    await save(draft.id, waiting.pixels);
  }, [save, draft]);

  // Retouches en attente enregistrées avant de changer de proposition ou de fermer.
  useEffect(() => () => void flush(), [flush]);

  const edited = (next: Pixels) => {
    if (!draft) return;
    const id = draft.id;
    setPixels(next);
    setError(null);
    setSaving("pending");
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = {
      pixels: next,
      timer: setTimeout(() => {
        pending.current = null;
        void save(id, next);
      }, SAVE_DELAY),
    };
  };

  const live = useDataUrl(draft ? pixels : null);
  const src = draft
    ? (live ?? `${convertFileSrc(draft.pixelPath)}?v=${draft.revision}`)
    : texture.exists
      ? `${convertFileSrc(texture.path)}?v=${texture.modified ?? 0}`
      : null;
  const size = draft && pixels ? { width: pixels.width, height: pixels.height } : { width: texture.width, height: texture.height };
  const verdict = draft?.seam != null ? seamVerdict(draft.seam) : null;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border px-5 py-2">
        {draft ? (
          <Segmented
            label="Vue de la proposition"
            value={view}
            onChange={setView}
            options={
              canFrame
                ? [
                    { value: "frame", label: "Cadrage" },
                    { value: "edit", label: "Retouche au pixel" },
                  ]
                : [{ value: "edit", label: "Retouche au pixel" }]
            }
          />
        ) : (
          <p className="text-body-sm text-text-muted">{texture.exists ? "Texture actuelle" : "Pas encore de texture"}</p>
        )}
        <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
          {verdict && draft?.seam != null && (
            <Badge tone={verdict.tone}>
              {verdict.label} · {draft.seam} %
            </Badge>
          )}
          {draft && <span className="truncate text-caption text-text-subtle">{sourceLabel}</span>}
        </div>
      </div>

      <div className="flex-1 space-y-6 px-5 py-6">
        {notice && (
          <p role="status" className="flex items-start gap-2 text-footnote text-success">
            <Check size={14} className="mt-0.5 shrink-0" /> <span className="text-text-muted">{notice}</span>
          </p>
        )}

        {!draft ? (
          src ? (
            <div className="flex flex-col items-center gap-6 py-4">
              <Checker size={264}>
                <img
                  src={src}
                  alt={`Texture actuelle de ${texture.label}`}
                  draggable={false}
                  className="size-64 object-contain [image-rendering:pixelated]"
                />
              </Checker>
              <PreviewStrip src={src} width={size.width} height={size.height} tiled={tiled} cube={cube?.(src) ?? null} />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Checker size={96}>
                <Sparkles size={20} className="text-text-subtle" aria-hidden />
              </Checker>
              <p className="text-body text-text">Cette texture n'existe pas encore</p>
              <p className="max-w-[44ch] text-footnote text-text-subtle">
                Décrivez-la à l'IA ou importez une image dans l'inspecteur : la proposition s'affichera ici, à cadrer et
                à retoucher avant de l'appliquer.
              </p>
            </div>
          )
        ) : view === "frame" && canFrame ? (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-5">
              <figure className="space-y-2">
                <CropSelector
                  src={convertFileSrc(draft.originalPath)}
                  imageWidth={draft.originalWidth}
                  imageHeight={draft.originalHeight}
                  crop={crop}
                  aspect={cropAspect}
                  disabled={applying}
                  onCommit={onCrop}
                />
                <figcaption className="flex items-center justify-between gap-3 text-caption text-text-subtle">
                  <span>
                    Image reçue {draft.originalWidth}×{draft.originalHeight} · glissez pour choisir la zone
                  </span>
                  {crop && (
                    <button
                      type="button"
                      onClick={() => onCrop(null)}
                      className={cn("rounded-xs text-text-muted underline-offset-2 hover:text-text hover:underline", focusRing)}
                    >
                      Toute l'image
                    </button>
                  )}
                </figcaption>
              </figure>
              <ArrowRight size={16} className="text-text-subtle" aria-hidden />
              <figure className="space-y-2">
                <Checker size={200} className={cn(cropBusy && "opacity-60")}>
                  {src && (
                    <img src={src} alt="Texture obtenue" draggable={false} className="size-48 object-contain [image-rendering:pixelated]" />
                  )}
                </Checker>
                <figcaption className="text-caption text-text-subtle">{cropBusy ? "Conversion…" : "Texture obtenue"}</figcaption>
              </figure>
            </div>
            {src && pixels && <PreviewStrip src={src} width={pixels.width} height={pixels.height} tiled={tiled} cube={cube?.(src) ?? null} />}
          </div>
        ) : pixels ? (
          <div className="space-y-6">
            <PixelEditor initial={pixels} resetKey={resetKey} onChange={edited} disabled={applying} />
            {src && <PreviewStrip src={src} width={pixels.width} height={pixels.height} tiled={tiled} cube={cube?.(src) ?? null} />}
          </div>
        ) : error ? null : (
          <Loader2 size={16} className="animate-spin text-text-subtle" aria-label="Lecture des pixels" />
        )}

        {draft && draft.notes.length > 0 && (
          <ul className="space-y-1">
            {draft.notes.map((note) => (
              <li key={note} className="flex items-center gap-1.5 text-caption text-text-subtle">
                <Info size={12} aria-hidden /> {note}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-footnote text-danger">
            {error}
          </p>
        )}

        <History drafts={history} current={draft?.id ?? null} onOpen={onOpen} onDelete={onDelete} />
      </div>

      {draft && (
        <div className="sticky bottom-0 flex h-14 shrink-0 items-center gap-2 whitespace-nowrap border-t border-border bg-surface-1 px-5">
          <Button
            type="button"
            variant="primary"
            disabled={applying || saving === "saving" || cropBusy}
            onClick={() => void flush().then(onApply)}
            icon={applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          >
            Appliquer au projet
          </Button>
          <Button type="button" variant="ghost" disabled={applying} onClick={() => void flush().then(onClose)} icon={<X size={14} />}>
            Fermer
          </Button>
          <span aria-live="polite" className="ml-auto min-w-0 truncate text-caption text-text-subtle">
            {saving === "pending" || saving === "saving"
              ? "Enregistrement des retouches…"
              : saving === "saved"
                ? "Retouches enregistrées"
                : "Fermée, elle reste dans les propositions"}
          </span>
        </div>
      )}
    </div>
  );
}
