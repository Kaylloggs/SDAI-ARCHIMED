import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowRight, Check, Info, Loader2, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button } from "@/design-system/primitives";
import type { TextureDraft } from "@/core/ipc/bindings/TextureDraft";
import { errorText, mcstudioApi } from "../../../api";
import { decodePixels, encodePixels, type Pixels } from "../../../lib/pixels";
import { seamVerdict } from "../../../lib/textures";
import { Checker, Segmented } from "../../ui";
import { PixelEditor } from "./PixelEditor";
import { BlockPreview, TilePreview, useDataUrl, type CubeFaces } from "./Previews";

type View = "preview" | "edit";

/** Retouches enregistrées dans le brouillon un instant après le dernier geste. */
const SAVE_DELAY = 400;

/**
 * Proposition en cours : image reçue et texture convertie, retouche au pixel (enregistrée au
 * fil de l'eau dans le brouillon), aperçus répétés et en bloc, puis application au projet.
 */
export function DraftPanel({
  draft,
  onDraft,
  sourceLabel,
  tiled,
  cube,
  applying,
  onApply,
  onDiscard,
}: {
  draft: TextureDraft;
  onDraft: (draft: TextureDraft) => void;
  sourceLabel: string;
  /** Texture pleine (face de bloc) : aperçu répété 3 × 3. */
  tiled: boolean;
  /** Faces du bloc pour l'aperçu 3D, à partir de l'image de cette face. */
  cube: ((src: string) => CubeFaces) | null;
  applying: boolean;
  onApply: () => Promise<void>;
  onDiscard: () => void;
}) {
  const [view, setView] = useState<View>(draft.source.kind === "project" ? "edit" : "preview");
  const [pixels, setPixels] = useState<Pixels | null>(null);
  const [saving, setSaving] = useState<"idle" | "pending" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  /** Révision écrite par nos propres retouches : pas besoin de relire les pixels. */
  const ownRevision = useRef(0);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; pixels: Pixels } | null>(null);
  const [resetKey, setResetKey] = useState(`${draft.id}:${draft.revision}`);

  // Pixels du brouillon : relus quand il change d'ailleurs (génération, reconversion).
  useEffect(() => {
    if (draft.revision === ownRevision.current) return;
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
  }, [draft.id, draft.revision]);

  const save = useCallback(
    async (next: Pixels) => {
      setSaving("saving");
      try {
        const updated = await mcstudioApi.saveDraftPixels(draft.id, encodePixels(next));
        ownRevision.current = updated.revision;
        onDraft(updated);
        setSaving("saved");
      } catch (e) {
        setError(errorText(e));
        setSaving("idle");
      }
    },
    [draft.id, onDraft],
  );

  const flush = useCallback(async () => {
    const waiting = pending.current;
    if (!waiting) return;
    clearTimeout(waiting.timer);
    pending.current = null;
    await save(waiting.pixels);
  }, [save]);

  // Retouches en attente enregistrées si le panneau se ferme.
  useEffect(() => () => void flush(), [flush]);

  const edited = (next: Pixels) => {
    setPixels(next);
    setError(null);
    setSaving("pending");
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = {
      pixels: next,
      timer: setTimeout(() => {
        pending.current = null;
        void save(next);
      }, SAVE_DELAY),
    };
  };

  const live = useDataUrl(pixels);
  const fileSrc = `${convertFileSrc(draft.pixelPath)}?v=${draft.revision}`;
  const src = live ?? fileSrc;
  const verdict = draft.seam !== null ? seamVerdict(draft.seam) : null;
  const side = pixels ? Math.max(pixels.width, pixels.height) : draft.options.size;
  const scales = side > 64 ? [1] : [1, 2, 4];

  return (
    <section aria-labelledby="mc-draft" className="space-y-4 rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h3 id="mc-draft" className="text-body-sm font-semibold">
            Proposition
          </h3>
          <Segmented
            label="Affichage de la proposition"
            value={view}
            onChange={setView}
            options={[
              { value: "preview", label: "Aperçu" },
              { value: "edit", label: "Retouche au pixel" },
            ]}
          />
        </div>
        <p className="text-caption text-text-subtle">
          {sourceLabel}
          {draft.source.kind !== "project" && ` · image reçue ${draft.originalWidth}×${draft.originalHeight}`}
        </p>
      </div>

      {(draft.notes.length > 0 || verdict) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {verdict && draft.seam !== null && (
            <Badge tone={verdict.tone}>
              {verdict.label} · {draft.seam} %
            </Badge>
          )}
          {draft.notes.map((note) => (
            <span key={note} className="inline-flex items-center gap-1 text-caption text-text-subtle">
              <Info size={12} aria-hidden /> {note}
            </span>
          ))}
        </div>
      )}

      {view === "edit" ? (
        pixels ? (
          <div className="flex flex-wrap items-start gap-6">
            <PixelEditor initial={pixels} resetKey={resetKey} onChange={edited} disabled={applying} />
            <div className="space-y-3">
              {tiled && <TilePreview src={src} width={pixels.width} height={pixels.height} side={144} outline />}
              {cube && <BlockPreview faces={cube(src)} size={64} />}
            </div>
          </div>
        ) : error ? null : (
          <Loader2 size={16} className="animate-spin text-text-subtle" aria-label="Lecture des pixels" />
        )
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          {draft.source.kind !== "project" && (
            <>
              <figure className="space-y-1.5">
                <Checker size={184}>
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
            </>
          )}
          <figure className="space-y-1.5">
            <div className="flex items-end gap-2">
              {scales.map((scale) => (
                <Checker key={scale} size={Math.min(side * scale, 192) + 8}>
                  <img
                    src={src}
                    alt={scale === 1 ? "Texture, taille réelle" : ""}
                    draggable={false}
                    className="[image-rendering:pixelated]"
                    style={{ width: Math.min(side * scale, 192), height: Math.min(side * scale, 192), objectFit: "contain" }}
                  />
                </Checker>
              ))}
            </div>
            <figcaption className="text-caption text-text-subtle">
              Texture {pixels ? `${pixels.width}×${pixels.height}` : ""}
              {scales.length > 1 ? " · taille réelle, ×2, ×4" : ""}
            </figcaption>
          </figure>
          {tiled && pixels && (
            <figure className="space-y-1.5">
              <TilePreview src={src} width={pixels.width} height={pixels.height} side={168} />
              <figcaption className="text-caption text-text-subtle">Répétée, comme en jeu</figcaption>
            </figure>
          )}
          {cube && (
            <figure className="space-y-1.5">
              <BlockPreview faces={cube(src)} size={72} />
              <figcaption className="text-caption text-text-subtle">Le bloc</figcaption>
            </figure>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          disabled={applying || saving === "saving"}
          onClick={() => void flush().then(onApply)}
          icon={applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        >
          Appliquer au projet
        </Button>
        <Button type="button" variant="ghost" disabled={applying} onClick={onDiscard} icon={<X size={14} />}>
          Abandonner
        </Button>
        <span aria-live="polite" className={cn("text-caption text-text-subtle", saving === "idle" && "sr-only")}>
          {saving === "pending" || saving === "saving" ? "Enregistrement des retouches…" : saving === "saved" ? "Retouches enregistrées dans la proposition." : ""}
        </span>
      </div>
    </section>
  );
}
