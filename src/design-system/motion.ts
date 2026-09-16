/** Presets d'animation — seule source autorisée (design.md §6). */
import type { Transition, Variants } from "motion/react";

export const duration = {
  instant: 0.08,
  fast: 0.14,
  base: 0.22,
  slow: 0.36,
} as const;

export const ease = {
  standard: [0.2, 0, 0, 1],
  emphasized: [0.32, 0.72, 0, 1],
  exit: [0.4, 0, 1, 1],
} as const;

export const spring = {
  snappy: { type: "spring", stiffness: 500, damping: 38 } satisfies Transition,
  gentle: { type: "spring", stiffness: 260, damping: 30 } satisfies Transition,
} as const;

/** Entrée standard d'un élément de timeline (message, carte). */
export const enterUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.base, ease: ease.emphasized },
  },
  exit: { opacity: 0, transition: { duration: duration.fast, ease: ease.exit } },
};

/** Entrée d'une carte interactive (question). */
export const enterCard: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: spring.gentle },
  exit: {
    opacity: 0,
    scale: 0.98,
    transition: { duration: duration.fast, ease: ease.exit },
  },
};

/** Changement de page/module : fondu croisé court. */
export const pageFade: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.fast, ease: ease.standard },
  },
  exit: { opacity: 0, transition: { duration: duration.instant } },
};

/** Surgissement d'une couche flottante (palette, popover). */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: duration.fast, ease: ease.emphasized },
  },
  exit: { opacity: 0, scale: 0.98, transition: { duration: duration.instant } },
};
