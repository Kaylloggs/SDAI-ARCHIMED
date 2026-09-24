import { useRef, useState } from "react";
import { Gauge } from "lucide-react";
import { cn } from "@/core/lib/cn";
import type { EffortOption } from "@/core/engine/types";

type Props = {
  efforts: EffortOption[];
  /** Niveau affiché ; `null` : aucun niveau reconnu, le curseur se place au premier cran. */
  value: EffortOption | null;
  onChange: (effort: EffortOption) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Curseur d'effort du modèle : un cran par niveau, du plus économe au plus poussé. Le niveau
 * n'est appliqué qu'au relâchement (changer de modèle arrête le tour en cours), les flèches
 * du clavier l'appliquent cran par cran.
 */
export function EffortSlider({ efforts, value, onChange, disabled, className }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  /** Cran survolé pendant un glissement, avant d'être appliqué. */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const current = Math.max(0, value ? efforts.findIndex((e) => e.id === value.id) : 0);
  const index = dragIndex ?? current;
  const last = efforts.length - 1;
  const shown = efforts[index];
  if (!shown || last < 1) return null;

  const commit = (next: number) => {
    const clamped = Math.min(last, Math.max(0, next));
    const effort = efforts[clamped];
    if (effort && clamped !== current) onChange(effort);
  };

  const indexAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return index;
    return Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * last);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
    if (event.key in step) {
      event.preventDefault();
      commit(current + (step[event.key] ?? 0));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      commit(event.key === "Home" ? 0 : last);
    }
  };

  const percent = (index / last) * 100;

  return (
    <div
      className={cn("flex h-7 shrink-0 items-center gap-2 rounded-sm border border-border bg-surface-1 px-2", className)}
      title="Effort de réflexion : plus il est élevé, plus le modèle réfléchit (et consomme)"
    >
      <Gauge size={13} strokeWidth={1.75} className="shrink-0 text-text-subtle" aria-hidden />
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Effort"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={index}
        aria-valuetext={shown.label}
        aria-disabled={disabled || undefined}
        onKeyDown={disabled ? undefined : onKeyDown}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragIndex(indexAt(event.clientX));
        }}
        onPointerMove={(event) => {
          if (dragIndex !== null) setDragIndex(indexAt(event.clientX));
        }}
        onPointerUp={(event) => {
          if (dragIndex === null) return;
          commit(indexAt(event.clientX));
          setDragIndex(null);
        }}
        onPointerCancel={() => setDragIndex(null)}
        className={cn(
          "relative flex h-5 w-20 cursor-pointer touch-none items-center rounded-full",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <div ref={trackRef} className="relative mx-1.5 h-1 flex-1 rounded-full bg-surface-3">
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${percent}%` }} />
          {efforts.map((effort, stop) => (
            <span
              key={effort.id}
              aria-hidden
              className={cn(
                "absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full",
                stop <= index ? "bg-accent-fg/70" : "bg-text-subtle/60",
              )}
              style={{ left: `${(stop / last) * 100}%` }}
            />
          ))}
          <span
            aria-hidden
            className={cn(
              "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent bg-surface-1 shadow-sm",
              dragIndex === null && "transition-[left] duration-100",
            )}
            style={{ left: `${percent}%` }}
          />
        </div>
      </div>
      <span className="w-[4.5rem] truncate text-footnote text-text-muted" aria-hidden>
        {shown.label}
      </span>
    </div>
  );
}
