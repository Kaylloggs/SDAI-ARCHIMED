import { useCallback, useRef, useState } from "react";
import { cn } from "@/core/lib/cn";

/**
 * Largeur de panneau redimensionnable, mémorisée par poste (`localStorage`, confort seulement).
 */
export function usePanelSize(key: string, initial: number, min: number, max: number) {
  const clamp = useCallback((value: number) => Math.round(Math.min(max, Math.max(min, value))), [min, max]);
  const [size, setSize] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(`archimed.panel.${key}`));
      return Number.isFinite(stored) && stored > 0 ? clamp(stored) : initial;
    } catch {
      return initial;
    }
  });

  const update = useCallback(
    (value: number) => {
      const next = clamp(value);
      setSize(next);
      try {
        localStorage.setItem(`archimed.panel.${key}`, String(next));
      } catch {
        // stockage indisponible : la taille n'est pas mémorisée
      }
    },
    [clamp, key],
  );

  return [size, update] as const;
}

type Props = {
  /** Largeur actuelle du panneau contrôlé. */
  size: number;
  onResize: (size: number) => void;
  /**
   * `after` : le panneau est à droite de la poignée (tirer à gauche l'agrandit).
   * `before` : le panneau est à gauche (tirer à droite l'agrandit).
   */
  panel: "before" | "after";
  label: string;
  /** Double clic : taille par défaut. */
  defaultSize?: number;
};

/** Poignée verticale entre deux panneaux : souris (glisser) et clavier (flèches). */
export function ResizeHandle({ size, onResize, panel, label, defaultSize }: Props) {
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; size: number } | null>(null);
  const direction = panel === "before" ? 1 : -1;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={size}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, size };
        setDragging(true);
        document.body.classList.add("resizing");
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        onResize(start.current.size + (event.clientX - start.current.x) * direction);
      }}
      onPointerUp={(event) => {
        start.current = null;
        setDragging(false);
        document.body.classList.remove("resizing");
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onDoubleClick={() => defaultSize && onResize(defaultSize)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const step = (event.shiftKey ? 48 : 16) * (event.key === "ArrowRight" ? 1 : -1);
          onResize(size + step * direction);
        }
      }}
      className="group relative z-10 -mx-[3px] w-[6px] shrink-0 cursor-col-resize touch-none outline-none"
    >
      <span
        className={cn(
          "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors",
          dragging ? "w-0.5 bg-accent" : "bg-border group-hover:bg-accent/60 group-focus-visible:bg-accent",
        )}
      />
    </div>
  );
}
