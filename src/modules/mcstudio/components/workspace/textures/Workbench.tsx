import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Brush, Crop, Info, Loader2, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/core/lib/cn";
import { Badge, Button } from "@/design-system/primitives";
import { pageFade } from "@/design-system/motion";
import type { CropRect } from "@/core/ipc/bindings/CropRect";
import type { TextureDraft } from "@/core/ipc/bindings/TextureDraft";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import { errorText, mcstudioApi } from "../../../api";
import { decodePixels, encodePixels, type Pixels } from "../../../lib/pixels";
import { seamVerdict } from "../../../lib/textures";
import { Checker, focusRing } from "../../ui";
import { CropSelector } from "./CropSelector";
import { PixelEditor, ToolToggle } from "./PixelEditor";
import { BlockPreview, TilePreview, useDataUrl, type CubeFaces } from "./Previews";

/** Retouches enregistrées dans la proposition un instant après le dernier geste. */
const SAVE_DELAY = 400;
/** Côté maximal du canevas : au-delà, la texture écrase le reste de l'atelier. */
const MAX_CANVAS = 320;
/** Côté maximal de la texture actuelle, hors retouche. */
const MAX_VIEW = 256;

/** Taille d'une zone, suivie quand la fenêtre change. */
function useBoxSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Réabonné à chaque rendu : la zone mesurée change entre la vue simple et la retouche.
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const { width, height } = rect;
      setSize((s) => (Math.round(width) === s.width && Math.round(height) === s.height ? s : { width: Math.round(width), height: Math.round(height) }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  });
  return size;
}

/** Côté qui tient dans la zone (marges comprises), entre 96 px et `max`. */
function fitIn(size: { width: number; height: number }, max: number, margin = 48): number {
  if (size.width === 0 || size.height === 0) return Math.min(max, 256);
  return Math.max(96, Math.min(max, size.width - margin, size.height - margin));
}

export type SaveState = "idle" | "pending" | "saving" | "saved";

/** Colonne de droite : ce que la texture donnera en jeu. */
function Rail({ children }: { children: ReactNode }) {
  return <aside aria-label="Aperçus" className="w-[184px] shrink-0 space-y-4 overflow-y-auto overflow-x-hidden border-l border-border p-3">{children}</aside>;
}

function RailItem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-footnote font-medium text-text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Previews({
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
  return (
    <>
      {cube && (
        <RailItem title="En jeu">
          <BlockPreview faces={cube} size={48} />
        </RailItem>
      )}
      {tiled && (
        <RailItem title="Répétée">
          <TilePreview src={src} width={width} height={height} side={144} />
        </RailItem>
      )}
      <RailItem title="Taille réelle">
        <div className="flex items-end gap-2">
          {[1, 2, 4].filter((scale) => scale === 1 || side * scale <= 64).map((scale) => {
            const shown = Math.min(side * scale, 64);
            return (
              <Checker key={scale} size={shown + 6} className="rounded-sm">
                <img src={src} alt="" draggable={false} className="object-contain [image-rendering:pixelated]" style={{ width: shown, height: shown }} />
              </Checker>
            );
          })}
        </div>
        <p className="text-caption text-text-subtle">
          {width}×{height}
        </p>
      </RailItem>
    </>
  );
}

/**
 * Plan de travail : la texture au centre. Sans proposition, la texture actuelle (à retoucher
 * d'un clic) ; avec une proposition, l'éditeur de pixels dont le cadrage est un outil (zone de
 * l'image reçue qui devient la texture). À droite, l'aperçu en jeu.
 */
export function Workbench({
  texture,
  draft,
  onDraft,
  crop,
  cropAspect,
  onCrop,
  converting,
  generating,
  elapsed,
  tiled,
  cube,
  onRetouch,
  retouchBusy,
  onSaveState,
  flushRef,
}: {
  texture: TextureInfo;
  draft: TextureDraft | null;
  onDraft: (draft: TextureDraft) => void;
  crop: CropRect | null;
  cropAspect: number;
  onCrop: (crop: CropRect | null) => void;
  converting: boolean;
  generating: boolean;
  elapsed: number;
  tiled: boolean;
  cube: ((src: string) => CubeFaces) | null;
  onRetouch: () => void;
  retouchBusy: boolean;
  onSaveState: (state: SaveState) => void;
  /** Enregistre tout de suite les retouches en attente (avant d'appliquer ou de fermer). */
  flushRef: React.MutableRefObject<() => Promise<void>>;
}) {
  const [pixels, setPixels] = useState<Pixels | null>(null);
  const [framing, setFraming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Version (`id:révision`) écrite par nos propres retouches : pas besoin de relire les pixels. */
  const ownRevision = useRef("");
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; pixels: Pixels; id: string } | null>(null);
  const [resetKey, setResetKey] = useState("");
  const canFrame = draft !== null && draft.source.kind !== "project";
  const area = useRef<HTMLDivElement>(null);
  const areaSize = useBoxSize(area);

  // Nouvelle proposition : on repart de ses pixels.
  useEffect(() => {
    setPixels(null);
    setError(null);
    setFraming(false);
    onSaveState("idle");
  }, [draft?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!draft) return;
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
      onSaveState("saving");
      try {
        const updated = await mcstudioApi.saveDraftPixels(id, encodePixels(next));
        ownRevision.current = `${updated.id}:${updated.revision}`;
        onDraft(updated);
        onSaveState("saved");
      } catch (e) {
        setError(errorText(e));
        onSaveState("idle");
      }
    },
    [onDraft, onSaveState],
  );

  const flush = useCallback(async () => {
    const waiting = pending.current;
    if (!waiting) return;
    clearTimeout(waiting.timer);
    pending.current = null;
    await save(waiting.id, waiting.pixels);
  }, [save]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush, flushRef]);
  // Retouches en attente enregistrées avant de changer de proposition ou de quitter.
  useEffect(() => () => void flush(), [flush, draft?.id]);

  const edited = (next: Pixels) => {
    if (!draft) return;
    setPixels(next);
    setError(null);
    onSaveState("pending");
    if (pending.current) clearTimeout(pending.current.timer);
    const id = draft.id;
    pending.current = {
      id,
      pixels: next,
      timer: setTimeout(() => {
        pending.current = null;
        void save(id, next);
      }, SAVE_DELAY),
    };
  };

  const live = useDataUrl(draft ? pixels : null);
  const currentSrc = texture.exists ? `${convertFileSrc(texture.path)}?v=${texture.modified ?? 0}` : null;
  const src = draft ? (live ?? `${convertFileSrc(draft.pixelPath)}?v=${draft.revision}`) : currentSrc;
  const verdict = draft?.seam != null ? seamVerdict(draft.seam) : null;

  const overlay = generating && (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-bg/70" aria-live="polite">
      <Loader2 size={20} className="animate-spin text-accent" />
      <p className="text-footnote text-text-muted tabular-nums">Génération… {elapsed} s</p>
      <p className="text-caption text-text-subtle">5 à 60 s selon le modèle</p>
    </div>
  );

  const notes = draft && (verdict || draft.notes.length > 0) && (
    <div className="space-y-1.5">
      {verdict && draft.seam != null && (
        <Badge tone={verdict.tone}>
          {verdict.label} · {draft.seam} %
        </Badge>
      )}
      {draft.notes.map((note) => (
        <p key={note} className="flex items-start gap-1.5 text-caption text-text-subtle">
          <Info size={12} aria-hidden className="mt-0.5 shrink-0" /> {note}
        </p>
      ))}
    </div>
  );

  // Sans proposition : la texture actuelle, ou une invitation à en créer une.
  if (!draft) {
    const view = fitIn(areaSize, MAX_VIEW, 32);
    return (
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {src && (
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={retouchBusy || generating}
                onClick={onRetouch}
                icon={retouchBusy ? <Loader2 size={14} className="animate-spin" /> : <Brush size={14} />}
              >
                Retoucher cette texture
              </Button>
              <span className="text-caption text-text-subtle">crayon, gomme, grille, raccord…</span>
            </div>
          )}
          <div ref={area} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
            {overlay}
            {src ? (
              <Checker size={view + 8}>
                <img src={src} alt={`Texture actuelle de ${texture.label}`} draggable={false} className="object-contain [image-rendering:pixelated]" style={{ width: view, height: view }} />
              </Checker>
            ) : (
              <div className="flex max-w-[40ch] flex-col items-center gap-3 text-center">
                <Checker size={96}>
                  <Sparkles size={20} className="text-text-subtle" aria-hidden />
                </Checker>
                <p className="text-body text-text">Pas encore de texture</p>
                <p className="text-footnote text-text-subtle">
                  Décrivez-la dans la barre du bas, ou importez une image avec le trombone : la proposition s'ouvrira ici.
                </p>
              </div>
            )}
          </div>
        </div>
        {src && (
          <Rail>
            <Previews src={src} width={texture.width || 16} height={texture.height || 16} tiled={tiled} cube={cube?.(src) ?? null} />
          </Rail>
        )}
      </div>
    );
  }

  if (!pixels) {
    return (
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {overlay}
        {error ? (
          <p role="alert" className="text-footnote text-danger">
            {error}
          </p>
        ) : (
          <Loader2 size={16} className="animate-spin text-text-subtle" aria-label="Lecture des pixels" />
        )}
      </div>
    );
  }

  const frameTitle = canFrame
    ? "Cadrer : choisir la zone de l'image reçue qui devient la texture (C)"
    : "Le cadrage choisit une zone d'une image générée ou importée";

  return (
    <PixelEditor
      initial={pixels}
      resetKey={resetKey}
      onChange={edited}
      suspended={framing}
      fit={fitIn(areaSize, MAX_CANVAS)}
      extraTools={
        <ToolToggle
          label="Cadrer"
          title={frameTitle}
          pressed={framing}
          disabled={!canFrame}
          onClick={() => setFraming((v) => !v)}
          icon={<Crop size={15} strokeWidth={1.75} />}
        />
      }
    >
      {({ toolbar, canvas, palette }) => (
        <div
          className="flex min-h-0 flex-1"
          onKeyDown={(event) => {
            if (canFrame && event.key.toLowerCase() === "c" && !event.ctrlKey && (event.target as HTMLElement).tagName !== "INPUT") {
              setFraming((v) => !v);
            }
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-border px-2 py-1">{toolbar}</div>
            <div ref={area} className="relative flex min-h-0 flex-1 flex-col overflow-auto">
              {overlay}
              <AnimatePresence mode="wait" initial={false}>
                {framing && canFrame ? (
                  <motion.div key="frame" variants={pageFade} initial="hidden" animate="visible" exit="exit" className="m-auto flex flex-col items-center gap-2 p-4">
                    <CropSelector
                      src={convertFileSrc(draft.originalPath)}
                      imageWidth={draft.originalWidth}
                      imageHeight={draft.originalHeight}
                      crop={crop}
                      aspect={cropAspect}
                      box={fitIn(areaSize, 360, 72)}
                      onCommit={onCrop}
                    />
                    <div className="flex w-full items-center justify-between gap-3 text-caption text-text-subtle">
                      <span>
                        Image reçue {draft.originalWidth}×{draft.originalHeight} · glissez pour choisir la zone{converting ? " · conversion…" : ""}
                      </span>
                      <span className="flex items-center gap-2">
                        {crop && (
                          <button type="button" onClick={() => onCrop(null)} className={cn("rounded-xs text-text-muted hover:text-text hover:underline", focusRing)}>
                            Toute l'image
                          </button>
                        )}
                        <Button type="button" size="sm" variant="secondary" onClick={() => setFraming(false)}>
                          Terminé
                        </Button>
                      </span>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="paint" variants={pageFade} initial="hidden" animate="visible" exit="exit" className={cn("m-auto p-4", converting && "opacity-60")}>
                    {canvas}
                  </motion.div>
                )}
              </AnimatePresence>
              {error && (
                <p role="alert" className="px-4 pb-3 text-footnote text-danger">
                  {error}
                </p>
              )}
            </div>
          </div>
          <Rail>
            {framing ? (
              <RailItem title="Résultat">
                {src && (
                  <Checker size={120}>
                    <img src={src} alt="Texture obtenue" draggable={false} className="size-28 object-contain [image-rendering:pixelated]" />
                  </Checker>
                )}
              </RailItem>
            ) : (
              <RailItem title="Couleurs">{palette}</RailItem>
            )}
            {src && <Previews src={src} width={pixels.width} height={pixels.height} tiled={tiled} cube={cube?.(src) ?? null} />}
            {notes}
          </Rail>
        </div>
      )}
    </PixelEditor>
  );
}
