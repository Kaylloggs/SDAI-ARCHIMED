import { useEffect, useRef, useState } from "react";
import { cn } from "@/core/lib/cn";
import type { CropRect } from "@/core/ipc/bindings/CropRect";
import { focusRing } from "../../ui";

type Corner = "nw" | "ne" | "sw" | "se";
type Drag =
  | { kind: "move"; startX: number; startY: number; from: CropRect }
  | { kind: "resize"; anchorX: number; anchorY: number }
  | { kind: "draw"; anchorX: number; anchorY: number };

/** Plus petite zone acceptée, en pixels de l'image. */
const MIN = 8;

function clampRect(rect: CropRect, width: number, height: number): CropRect {
  const w = Math.max(MIN, Math.min(rect.width, width));
  const h = Math.max(MIN, Math.min(rect.height, height));
  return {
    x: Math.max(0, Math.min(rect.x, width - w)),
    y: Math.max(0, Math.min(rect.y, height - h)),
    width: w,
    height: h,
  };
}

/** Zone de `(ax, ay)` à `(bx, by)`, aux proportions `aspect` (largeur / hauteur), dans l'image. */
function spanRect(ax: number, ay: number, bx: number, by: number, aspect: number, width: number, height: number): CropRect {
  let w = Math.abs(bx - ax);
  let h = Math.abs(by - ay);
  // Proportions imposées : le plus grand des deux côtés commande.
  if (w / aspect > h) h = w / aspect;
  else w = h * aspect;
  // Reste dans l'image du côté où l'on tire.
  const maxW = bx >= ax ? width - ax : ax;
  const maxH = by >= ay ? height - ay : ay;
  const scale = Math.min(1, maxW / Math.max(w, 1), maxH / Math.max(h, 1));
  w = Math.max(MIN, w * scale);
  h = Math.max(MIN, h * scale);
  return clampRect(
    {
      x: Math.round(bx >= ax ? ax : ax - w),
      y: Math.round(by >= ay ? ay : ay - h),
      width: Math.round(w),
      height: Math.round(h),
    },
    width,
    height,
  );
}

/** Zone par défaut : la plus grande aux bonnes proportions, centrée. */
export function fullRect(width: number, height: number, aspect: number): CropRect {
  const w = Math.min(width, Math.round(height * aspect));
  const h = Math.min(height, Math.round(w / aspect));
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), width: w, height: h };
}

/**
 * Sélection de la zone de l'image reçue qui devient la texture : glisser pour tracer une zone,
 * la déplacer, ou tirer un coin ; flèches pour la déplacer (Maj : l'agrandir ou la réduire).
 * La zone garde les proportions de la texture.
 */
export function CropSelector({
  src,
  imageWidth,
  imageHeight,
  crop,
  aspect,
  box = 360,
  disabled,
  onCommit,
}: {
  src: string;
  imageWidth: number;
  imageHeight: number;
  crop: CropRect | null;
  aspect: number;
  box?: number;
  disabled?: boolean;
  onCommit: (crop: CropRect | null) => void;
}) {
  const scale = Math.min(box / imageWidth, box / imageHeight);
  const [viewW, viewH] = [Math.round(imageWidth * scale), Math.round(imageHeight * scale)];
  const [rect, setShown] = useState<CropRect>(() => crop ?? fullRect(imageWidth, imageHeight, aspect));
  /** Dernière zone affichée, lue au relâchement (sans attendre le rendu). */
  const latest = useRef(rect);
  const setRect = (next: CropRect) => {
    latest.current = next;
    setShown(next);
  };
  const drag = useRef<Drag | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const keyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const next = crop ?? fullRect(imageWidth, imageHeight, aspect);
    latest.current = next;
    setShown(next);
  }, [crop, imageWidth, imageHeight, aspect]);

  const toImage = (event: React.PointerEvent): [number, number] => {
    const bounds = areaRef.current?.getBoundingClientRect();
    if (!bounds) return [0, 0];
    return [
      Math.max(0, Math.min(imageWidth, (event.clientX - bounds.left) / scale)),
      Math.max(0, Math.min(imageHeight, (event.clientY - bounds.top) / scale)),
    ];
  };

  const start = (event: React.PointerEvent, corner?: Corner) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    areaRef.current?.setPointerCapture(event.pointerId);
    const [x, y] = toImage(event);
    if (corner) {
      // Le coin opposé reste en place.
      drag.current = {
        kind: "resize",
        anchorX: corner.includes("w") ? rect.x + rect.width : rect.x,
        anchorY: corner.includes("n") ? rect.y + rect.height : rect.y,
      };
    } else if (crop && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
      // Une zone déjà choisie se déplace ; sans zone, glisser en trace une.
      drag.current = { kind: "move", startX: x, startY: y, from: rect };
    } else {
      drag.current = { kind: "draw", anchorX: x, anchorY: y };
    }
  };

  const move = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    const [x, y] = toImage(event);
    if (current.kind === "move") {
      setRect(
        clampRect(
          { ...current.from, x: Math.round(current.from.x + x - current.startX), y: Math.round(current.from.y + y - current.startY) },
          imageWidth,
          imageHeight,
        ),
      );
    } else {
      setRect(spanRect(current.anchorX, current.anchorY, x, y, aspect, imageWidth, imageHeight));
    }
  };

  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    onCommit(latest.current);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = steps[event.key];
    if (!step || disabled) return;
    event.preventDefault();
    const unit = Math.max(1, Math.round(Math.max(imageWidth, imageHeight) / 64));
    const next = event.shiftKey
      ? (() => {
          const grow = (step[0] + -step[1]) * unit;
          const width = Math.max(MIN, rect.width + grow);
          return { ...rect, width, height: Math.round(width / aspect) };
        })()
      : { ...rect, x: rect.x + step[0] * unit, y: rect.y + step[1] * unit };
    const clamped = clampRect(next, imageWidth, imageHeight);
    setRect(clamped);
    clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(() => onCommit(clamped), 350);
  };

  const corners: Corner[] = ["nw", "ne", "sw", "se"];

  return (
    <div
      ref={areaRef}
      role="application"
      aria-label={`Zone de l'image qui devient la texture : ${rect.width} × ${rect.height} pixels à partir de (${rect.x}, ${rect.y}). Flèches pour déplacer, Maj + flèches pour agrandir ou réduire.`}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={(event) => start(event)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      className={cn(
        "relative shrink-0 cursor-crosshair touch-none select-none overflow-hidden rounded-md border border-border",
        "bg-[repeating-conic-gradient(var(--color-surface-2)_0%_25%,var(--color-surface-1)_0%_50%)] bg-[length:12px_12px]",
        disabled && "pointer-events-none opacity-60",
        focusRing,
      )}
      style={{ width: viewW, height: viewH }}
    >
      <img src={src} alt="Image reçue" draggable={false} className="absolute inset-0 size-full" />
      <div
        className="absolute cursor-move border border-accent shadow-[0_0_0_9999px_var(--color-scrim)]"
        style={{ left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale }}
      >
        {/* Tiers : aide au cadrage. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className="border-[0.5px] border-accent/25" />
          ))}
        </div>
        {corners.map((corner) => (
          <span
            key={corner}
            aria-hidden
            onPointerDown={(event) => start(event, corner)}
            className={cn(
              "absolute size-3 rounded-xs border border-accent-fg bg-accent",
              corner.includes("n") ? "-top-1.5" : "-bottom-1.5",
              corner.includes("w") ? "-left-1.5" : "-right-1.5",
              corner === "nw" || corner === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize",
            )}
          />
        ))}
      </div>
    </div>
  );
}
