import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/core/lib/cn";
import type { WaveMode } from "../lib/status";
import { meter } from "../store";

type Blob = { left: number; width: number; phase: number };

/** Trois nappes de lumière au bas de l'écran, décalées pour que la lueur respire. */
const BLOBS: Blob[] = [
  { left: -10, width: 62, phase: 0 },
  { left: 22, width: 58, phase: 2.1 },
  { left: 52, width: 60, phase: 4.2 },
];

/**
 * Couleurs par état, tirées du thème : le laiton (accent) quand le micro écoute, l'information
 * quand l'assistant parle, un mélange pendant qu'il travaille. Un autre thème change la lueur.
 */
const PALETTE: Record<WaveMode, [string, string, string]> = {
  input: ["var(--color-accent)", "color-mix(in oklab, var(--color-accent) 70%, var(--color-info))", "var(--color-accent)"],
  output: ["var(--color-info)", "color-mix(in oklab, var(--color-info) 60%, var(--color-accent))", "var(--color-info)"],
  busy: ["var(--color-accent)", "var(--color-info)", "color-mix(in oklab, var(--color-accent) 50%, var(--color-info))"],
  paused: ["var(--color-text-subtle)", "var(--color-text-muted)", "var(--color-text-subtle)"],
  error: ["var(--color-danger)", "color-mix(in oklab, var(--color-danger) 60%, var(--color-accent))", "var(--color-danger)"],
  rest: ["var(--color-accent)", "var(--color-info)", "var(--color-accent)"],
};

/** Hauteur et intensité au repos (mouvement réduit, ou rien à entendre). */
const STILL: Record<WaveMode, { scale: number; opacity: number }> = {
  input: { scale: 0.8, opacity: 0.4 },
  output: { scale: 0.85, opacity: 0.42 },
  busy: { scale: 0.75, opacity: 0.36 },
  paused: { scale: 0.6, opacity: 0.18 },
  error: { scale: 0.7, opacity: 0.34 },
  rest: { scale: 0.55, opacity: 0.16 },
};

const shape = (level: number) => Math.min(1, Math.sqrt(Math.max(0, level)) * 1.3);

/**
 * Lueur de la vue de conversation (inspirée de Gemini Live) : elle monte avec la voix réelle
 * (micro ou assistant) et ondule doucement pendant un travail. Seules les transformations et
 * l'opacité changent ; une boucle `requestAnimationFrame` seulement quand quelque chose bouge.
 */
export function VoiceAura({ mode, animate = true, className }: { mode: WaveMode; animate?: boolean; className?: string }) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const reduced = useReducedMotion();
  const moving = animate && !reduced && (mode === "input" || mode === "output" || mode === "busy");

  useEffect(() => {
    const still = STILL[mode];
    const apply = (i: number, scale: number, opacity: number, shift: number) => {
      const node = refs.current[i];
      if (!node) return;
      node.style.transform = `translate3d(${shift.toFixed(2)}%, 0, 0) scaleY(${scale.toFixed(3)})`;
      node.style.opacity = opacity.toFixed(3);
    };
    if (!moving) {
      BLOBS.forEach((_, i) => apply(i, still.scale, still.opacity, 0));
      return;
    }
    const level = BLOBS.map(() => still.scale);
    let frame = 0;
    const tick = (now: number) => {
      const t = now / 1000;
      const raw = mode === "input" ? meter.input : mode === "output" ? meter.output() : 0;
      BLOBS.forEach((blob, i) => {
        const voice = shape(raw) * (0.75 + 0.25 * Math.sin(t * 3.1 + blob.phase));
        // Pendant un travail : une onde lente, sans son.
        const target = mode === "busy" ? 0.7 + 0.25 * (0.5 + 0.5 * Math.sin(t * 1.6 + blob.phase)) : 0.55 + 0.85 * voice;
        const rate = target > level[i]! ? 0.2 : 0.06;
        level[i] = level[i]! + (target - level[i]!) * rate;
        const drift = Math.sin(t * 0.35 + blob.phase) * 6;
        apply(i, level[i]!, Math.min(0.62, 0.2 + level[i]! * 0.3), drift);
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mode, moving]);

  const colors = PALETTE[mode];
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-[50%] overflow-hidden", className)}>
      {BLOBS.map((blob, i) => (
        <div
          key={i}
          ref={(node) => {
            refs.current[i] = node;
          }}
          className={cn(
            "absolute bottom-[-52%] h-full origin-bottom rounded-[50%] blur-[80px]",
            "transition-[background-color] duration-[600ms] ease-standard",
            // Thème clair : la lueur reste une teinte, jamais un aplat.
            "[:root[data-theme=light]_&]:blur-[96px]",
            !moving && "transition-[background-color,opacity,transform] duration-[360ms]",
          )}
          style={{ left: `${blob.left}%`, width: `${blob.width}%`, backgroundColor: colors[i], opacity: STILL[mode].opacity }}
        />
      ))}
      {/* Fondu vers le fond : le texte au-dessus reste lisible quelle que soit la lueur. */}
      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-[var(--color-bg)] to-transparent" />
    </div>
  );
}
