/**
 * Presets de thème : chaque preset redéfinit les tokens de couleur de `tokens.css`
 * via `:root[data-theme="<id>"]`. Ajouter un preset = une entrée ici + un bloc CSS.
 * Les tokens non redéfinis héritent du thème sombre par défaut.
 */
export type ThemeId =
  | "archimed"
  | "light"
  | "tokyo-neon"
  | "nord"
  | "solar-terra"
  | "monochrome";

export type ThemePreset = {
  id: ThemeId;
  name: string;
  description: string;
  mode: "dark" | "light";
  /** Aperçu : fond, surface, accent. */
  swatch: [string, string, string];
};

export const THEMES: ThemePreset[] = [
  {
    id: "archimed",
    name: "Archimède",
    description: "Sombre profond, accent laiton. Thème par défaut.",
    mode: "dark",
    swatch: ["oklch(0.155 0.006 265)", "oklch(0.235 0.008 265)", "oklch(0.8 0.115 80)"],
  },
  {
    id: "light",
    name: "Papier",
    description: "Clair, contrasté, accent ocre.",
    mode: "light",
    swatch: ["oklch(0.985 0.002 265)", "oklch(0.94 0.004 265)", "oklch(0.62 0.12 75)"],
  },
  {
    id: "tokyo-neon",
    name: "Tokyo Néon",
    description: "Nuit indigo, accent magenta électrique.",
    mode: "dark",
    swatch: ["oklch(0.17 0.035 280)", "oklch(0.25 0.045 285)", "oklch(0.74 0.19 330)"],
  },
  {
    id: "nord",
    name: "Nord",
    description: "Bleu ardoise froid, accent glacier.",
    mode: "dark",
    swatch: ["oklch(0.24 0.02 250)", "oklch(0.31 0.02 250)", "oklch(0.78 0.09 220)"],
  },
  {
    id: "solar-terra",
    name: "Terra",
    description: "Sombre chaud, accent terracotta.",
    mode: "dark",
    swatch: ["oklch(0.18 0.012 45)", "oklch(0.26 0.016 45)", "oklch(0.72 0.14 40)"],
  },
  {
    id: "monochrome",
    name: "Encre",
    description: "Gris neutres, accent blanc. Zéro distraction.",
    mode: "dark",
    swatch: ["oklch(0.14 0 0)", "oklch(0.24 0 0)", "oklch(0.92 0 0)"],
  },
];

export const DEFAULT_THEME: ThemeId = "archimed";

export function applyTheme(id: ThemeId): void {
  document.documentElement.setAttribute("data-theme", id);
}
