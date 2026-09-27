import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/core/lib/cn";
import type { WaveMode } from "../lib/status";
import { meter } from "../store";

const BARS = 5;
/** Enveloppe : le centre bouge plus que les bords (forme de voix, pas d'égaliseur). */
const ENVELOPE = [0.55, 0.85, 1, 0.85, 0.55];
const FLOOR = 0.18;

/** Hauteurs fixes quand le mouvement est réduit : la forme dit l'état, le libellé le nomme. */
const STILL: Record<WaveMode, number[]> = {
  rest: [FLOOR, FLOOR, FLOOR, FLOOR, FLOOR],
  error: [FLOOR, FLOOR, FLOOR, FLOOR, FLOOR],
  paused: [0.5, 0.5, FLOOR, 0.5, 0.5],
  input: [0.35, 0.65, 0.9, 0.65, 0.35],
  output: [0.45, 0.8, 0.6, 0.8, 0.45],
  busy: [0.45, 0.45, 0.45, 0.45, 0.45],
};

/** Amplifie les petits niveaux : une voix posée doit se voir. */
const shape = (level: number) => Math.min(1, Math.sqrt(Math.max(0, level)) * 1.25);

function target(mode: WaveMode, i: number, t: number): number {
  switch (mode) {
    case "input":
    case "output": {
      const level = shape(mode === "input" ? meter.input : meter.output());
      // Légère variation par barre, pour que la vague respire avec la voix.
      const wobble = 0.78 + 0.22 * Math.sin(t * 7.3 + i * 1.9);
      return FLOOR + (1 - FLOOR) * level * ENVELOPE[i]! * wobble;
    }
    case "busy":
      // Onde qui avance de gauche à droite : un travail est en cours (équivalent d'un indicateur d'activité).
      return 0.28 + 0.4 * (0.5 + 0.5 * Math.sin(t * 5.2 - i * 0.95));
    default:
      return STILL[mode][i]!;
  }
}

/**
 * Vague de la pastille vocale : cinq barres pilotées par le niveau réel du micro (écoute) ou
 * de la voix (réponse). Une seule boucle `requestAnimationFrame`, uniquement quand il se passe
 * quelque chose ; seules les transformations changent (pas de mise en page, pas de rendu React).
 */
export function VoiceWave({ mode, animate = true, className }: { mode: WaveMode; animate?: boolean; className?: string }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const reduced = useReducedMotion();
  const moving = animate && !reduced && (mode === "input" || mode === "output" || mode === "busy");

  useEffect(() => {
    const apply = (values: number[]) => {
      values.forEach((value, i) => {
        const bar = bars.current[i];
        if (bar) bar.style.transform = `scaleY(${value.toFixed(3)})`;
      });
    };
    if (!moving) {
      apply(STILL[mode]);
      return;
    }
    const current = bars.current.map((bar) => {
      const match = /scaleY\(([\d.]+)\)/.exec(bar?.style.transform ?? "");
      return match ? Number(match[1]) : FLOOR;
    });
    let frame = 0;
    const tick = (now: number) => {
      const t = now / 1000;
      for (let i = 0; i < BARS; i += 1) {
        const goal = target(mode, i, t);
        // Monte vite (attaque), redescend doucement (relâchement) : lisible sans scintiller.
        const rate = goal > current[i]! ? 0.45 : 0.16;
        current[i] = current[i]! + (goal - current[i]!) * rate;
      }
      apply(current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mode, moving]);

  return (
    <span aria-hidden className={cn("flex h-4 items-center gap-[2px]", className)}>
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          ref={(node) => {
            bars.current[i] = node;
          }}
          className={cn(
            "block h-4 w-[2.5px] origin-center rounded-full bg-current",
            // Sans boucle, le passage d'un état à l'autre reste doux.
            !moving && "transition-transform duration-[220ms] ease-standard",
          )}
          style={{ transform: `scaleY(${STILL[mode][i]})` }}
        />
      ))}
    </span>
  );
}
