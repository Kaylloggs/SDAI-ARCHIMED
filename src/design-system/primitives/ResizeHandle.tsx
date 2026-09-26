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
  /**
   * `vertical` (défaut) : filet vertical entre deux colonnes, règle une largeur.
   * `horizontal` : filet horizontal entre deux rangées, règle une hauteur (`after` = panneau
   * du dessous, tirer vers le haut l'agrandit).
   */
  orientation?: "vertical" | "horizontal";
};

/** Poignée entre deux panneaux : souris (glisser) et clavier (flèches). */
export function ResizeHandle({ size, onResize, panel, label, defaultSize, orientation = "vertical" }: Props) {
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; size: number } | null>(null);
  const direction = panel === "before" ? 1 : -1;
  const horizontal = orientation === "horizontal";
  const [decrease, increase] = horizontal ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuenow={size}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: horizontal ? event.clientY : event.clientX, size };
        setDragging(true);
        document.body.classList.add("resizing");
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        const position = horizontal ? event.clientY : event.clientX;
        onResize(start.current.size + (position - start.current.x) * direction);
      }}
      onPointerUp={(event) => {
        start.current = null;
        setDragging(false);
        document.body.classList.remove("resizing");
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onDoubleClick={() => defaultSize && onResize(defaultSize)}
      onKeyDown={(event) => {
        if (event.key === decrease || event.key === increase) {
          event.preventDefault();
          const step = (event.shiftKey ? 48 : 16) * (event.key === increase ? 1 : -1);
          onResize(size + step * direction);
        }
      }}
      className={cn(
        "group relative z-10 shrink-0 touch-none outline-none",
        horizontal ? "-my-[3px] h-[6px] cursor-row-resize" : "-mx-[3px] w-[6px] cursor-col-resize",
      )}
    >
      <span
        className={cn(
          "absolute transition-colors",
          horizontal ? "inset-x-0 top-1/2 h-px -translate-y-1/2" : "inset-y-0 left-1/2 w-px -translate-x-1/2",
          dragging
            ? cn("bg-accent", horizontal ? "h-0.5" : "w-0.5")
            : "bg-border group-hover:bg-accent/60 group-focus-visible:bg-accent",
        )}
      />
    </div>
  );
}
