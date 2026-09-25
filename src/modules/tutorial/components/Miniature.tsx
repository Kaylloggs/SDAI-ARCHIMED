import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MousePointer2, type LucideIcon } from "lucide-react";
import { cn } from "@/core/lib/cn";
import type { TutorialArea } from "@/core/modules";
import { duration, ease, spring } from "@/design-system/motion";

export const AREA_LABELS: Record<TutorialArea, string> = {
  rail: "le menu de gauche",
  top: "le haut de l'écran",
  left: "la colonne de gauche",
  center: "le centre de l'écran",
  right: "la colonne de droite",
  bottom: "la zone de saisie, en bas",
};

/** Traits gris qui évoquent du texte ou des contrôles, sans rien dire de précis. */
function Lines({ widths, className }: { widths: string[]; className?: string }) {
  return (
    <span className={cn("flex flex-col gap-1.5", className)}>
      {widths.map((w, i) => (
        <span key={i} className={cn("block h-1 rounded-full bg-text/12", w)} />
      ))}
    </span>
  );
}

/**
 * Une zone de la miniature. Allumée : voile laiton qui glisse d'une zone à l'autre entre
 * deux étapes (même `layoutId`), pastille de l'étape et pointeur. Éteinte : estompée.
 */
function Region({
  id,
  lit,
  icon: Icon,
  stepKey,
  className,
  children,
}: {
  id: TutorialArea;
  lit: TutorialArea;
  icon: LucideIcon;
  stepKey: string;
  className?: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const on = id === lit;
  return (
    <div className={cn("relative", className)}>
      <div className={cn("h-full transition-opacity duration-[220ms] ease-standard", on ? "opacity-100" : "opacity-45")}>
        {children}
      </div>
      {on && (
        <>
          <motion.div
            layoutId="tutorial-lit"
            transition={reduced ? { duration: 0 } : spring.gentle}
            className="pointer-events-none absolute inset-0 rounded-[inherit] bg-accent-soft ring-1 ring-accent"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <motion.span
              key={stepKey}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={reduced ? { duration: duration.fast } : spring.gentle}
              className="relative flex size-9 items-center justify-center rounded-full bg-accent text-accent-fg shadow-[0_6px_20px_-6px_var(--color-accent)]"
            >
              <Icon size={18} strokeWidth={2} />
              <motion.span
                initial={reduced ? { opacity: 0 } : { opacity: 0, x: 14, y: 14 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                transition={{ duration: duration.slow, ease: ease.emphasized, delay: reduced ? 0 : 0.12 }}
                className="absolute -bottom-3 -right-2.5 text-text drop-shadow-[0_1px_2px_oklch(0_0_0/0.5)]"
              >
                <MousePointer2 size={16} strokeWidth={1.75} fill="currentColor" />
              </motion.span>
            </motion.span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Miniature de la fenêtre d'ARCHIMED : menu, barre du haut, colonnes, zone de saisie.
 * Elle montre où se passe l'étape, pour tous les modules, présents et futurs.
 */
export function Miniature({
  area,
  icon,
  moduleIcon: ModuleIcon,
  stepKey,
}: {
  area: TutorialArea;
  icon: LucideIcon;
  moduleIcon: LucideIcon;
  stepKey: string;
}) {
  const region = { lit: area, icon, stepKey };
  return (
    <div
      role="img"
      aria-label={`Illustration : l'étape se passe dans ${AREA_LABELS[area]}.`}
      className="relative aspect-[16/10] w-full select-none overflow-hidden rounded-[20px] border border-border bg-bg p-2.5"
    >
      <div className="flex h-full gap-2">
        <Region id="rail" {...region} className="w-[10%] rounded-[12px]">
          <div className="flex h-full flex-col items-center gap-2 rounded-[inherit] bg-surface-2 py-2.5">
            <span className="size-3.5 rounded-full bg-accent/70" />
            <span className="mt-1 h-px w-1/2 bg-border-strong" />
            <span className="flex size-5 items-center justify-center rounded-[6px] bg-text/10 text-accent">
              <ModuleIcon size={11} strokeWidth={2} />
            </span>
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-5 rounded-[6px] bg-text/6" />
            ))}
            <span className="mt-auto size-5 rounded-[6px] bg-text/6" />
          </div>
        </Region>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Region id="top" {...region} className="h-[12%] rounded-[10px]">
            <div className="flex h-full items-center gap-3 px-2">
              <span className="h-1.5 w-[14%] rounded-full bg-text/25" />
              <span className="mx-auto h-[60%] w-[36%] rounded-full bg-surface-2" />
              <span className="h-[60%] w-[10%] rounded-full bg-surface-2" />
            </div>
          </Region>

          <div className="flex min-h-0 flex-1 gap-2 rounded-[14px] border border-border bg-surface-1 p-2">
            <Region id="left" {...region} className="w-[24%] rounded-[8px]">
              <div className="h-full rounded-[inherit] bg-surface-2/60 p-2">
                <Lines widths={["w-4/5", "w-3/5", "w-2/3", "w-1/2", "w-3/5"]} className="gap-2.5" />
              </div>
            </Region>

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Region id="center" {...region} className="flex-1 rounded-[8px]">
                <div className="flex h-full flex-col gap-2.5 p-2">
                  <span className="h-2 w-2/5 rounded-full bg-text/25" />
                  <Lines widths={["w-full", "w-11/12", "w-3/4"]} />
                  <span className="mt-1 h-[34%] w-4/5 rounded-[8px] bg-surface-2" />
                  <Lines widths={["w-5/6", "w-2/3"]} />
                </div>
              </Region>
              <Region id="bottom" {...region} className="h-[17%] rounded-[10px]">
                <div className="flex h-full items-center gap-2 rounded-[inherit] border border-border-strong bg-surface-2 px-2">
                  <span className="size-2.5 rounded-full bg-text/20" />
                  <span className="h-1 flex-1 rounded-full bg-text/12" />
                  <span className="size-4 rounded-full bg-accent/70" />
                </div>
              </Region>
            </div>

            <Region id="right" {...region} className="w-[26%] rounded-[8px]">
              <div className="h-full rounded-[inherit] bg-surface-2/60 p-2">
                <Lines widths={["w-3/5", "w-full", "w-4/5"]} />
                <span className="mt-2.5 block h-[28%] rounded-[6px] bg-surface-2" />
                <Lines widths={["w-full", "w-2/3"]} className="mt-2.5" />
              </div>
            </Region>
          </div>
        </div>
      </div>
    </div>
  );
}
