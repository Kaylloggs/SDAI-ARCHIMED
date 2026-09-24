import type { SelectOption } from "@/design-system/primitives";
import type { BlockFace } from "@/core/ipc/bindings/BlockFace";
import type { BlockLayout } from "@/core/ipc/bindings/BlockLayout";
import type { GuiPreset } from "@/core/ipc/bindings/GuiPreset";
import type { ImageModel } from "@/core/ipc/bindings/ImageModel";
import type { ImageProvider } from "@/core/ipc/bindings/ImageProvider";
import type { PixelOptions } from "@/core/ipc/bindings/PixelOptions";
import type { TextureInfo } from "@/core/ipc/bindings/TextureInfo";
import type { TextureStyle } from "@/core/ipc/bindings/TextureStyle";
import type { TextureTarget } from "@/core/ipc/bindings/TextureTarget";
import type { Tiling } from "@/core/ipc/bindings/Tiling";

/** Longueurs maximales (mêmes limites que le backend). */
export const MAX_DESCRIPTION = 600;
export const MAX_EXTRA = 600;
export const MAX_PROMPT = 4000;

export const SIZE_CHOICES = [16, 32, 64].map((size) => ({ value: size, label: `${size} px` }));

export const COLOR_CHOICES: SelectOption[] = [
  { value: "8", label: "8 couleurs" },
  { value: "16", label: "16 couleurs", hint: "conseillé" },
  { value: "32", label: "32 couleurs" },
  { value: "0", label: "Sans limite" },
];

const BASE: Omit<PixelOptions, "size" | "colors" | "transparent"> = {
  tiling: "none",
  outline: false,
  width: null,
  height: null,
  atlas: false,
};

/**
 * Raccord de départ d'une face de bloc : dans les deux sens pour une matière (pierre,
 * minerai), en largeur seulement pour les côtés d'un bloc à dessus distinct (herbe : sa bande
 * reste en haut), aucun pour une face unique (avant, extrémité de bûche).
 */
export function defaultTiling(face: BlockFace | null, layout: BlockLayout | null): Tiling {
  if (face === null || face === "top" || face === "bottom") return "both";
  if (face === "side") return layout === "bottomTop" ? "horizontal" : "both";
  return "none";
}

/**
 * Réglages de départ : un objet est détouré, une face de bloc remplit sa case et se raccorde,
 * l'icône est plus fine, un élément d'interface garde la taille de son fichier.
 */
export function defaultOptions(target: TextureTarget, info?: Pick<TextureInfo, "width" | "height" | "layout" | "exists">): PixelOptions {
  switch (target.kind) {
    case "item":
      return { ...BASE, size: 16, colors: 16, transparent: true };
    case "block":
      return { ...BASE, size: 16, colors: 16, transparent: false, tiling: defaultTiling(target.face, info?.layout ?? null) };
    case "icon":
      return { ...BASE, size: 32, colors: 32, transparent: false };
    case "gui": {
      const known = info?.exists && info.width > 0 && info.height > 0;
      // Toile 256 × 256 : l'élément dessiné occupe la zone d'un écran de conteneur.
      const atlas = known && info.width === 256 && info.height === 256;
      return {
        ...BASE,
        size: 16,
        colors: 0,
        transparent: false,
        width: atlas ? 176 : known ? Math.min(info.width, 256) : 176,
        height: atlas ? 166 : known ? Math.min(info.height, 256) : 166,
        atlas: atlas || !known,
      };
    }
  }
}

export function targetKey(target: TextureTarget): string {
  switch (target.kind) {
    case "icon":
      return "icon";
    case "gui":
      return `gui:${target.name}`;
    case "block":
      return `block:${target.id}:${target.face ?? "all"}`;
    case "item":
      return `item:${target.id}`;
  }
}

/** Bloc d'une cible (`null` hors blocs) : ses faces se retrouvent ensemble. */
export function blockOf(target: TextureTarget): string | null {
  return target.kind === "block" ? target.id : null;
}

export const KIND_LABEL: Record<TextureTarget["kind"], string> = {
  icon: "Icône",
  item: "Objet",
  block: "Bloc",
  gui: "Interface",
};

export const DESCRIPTION_PLACEHOLDER: Record<TextureTarget["kind"], string> = {
  item: "Ex. : une épée en rubis rouge, garde dorée, lame brillante",
  block: "Ex. : minerai de rubis, pierre grise avec des éclats rouges",
  icon: "Ex. : un dragon rouge enroulé autour d'une épée",
  gui: "Ex. : fond d'une forge, cadre en pierre sombre, emplacement central doré",
};

export const FACE_LABEL: Record<BlockFace, string> = {
  top: "Dessus",
  bottom: "Dessous",
  side: "Côtés",
  end: "Extrémités",
  north: "Nord",
  south: "Sud",
  east: "Est",
  west: "Ouest",
};

export const LAYOUTS: { value: Exclude<BlockLayout, "custom">; label: string; hint: string }[] = [
  { value: "all", label: "Une texture", hint: "la même sur les six faces (pierre, minerai)" },
  { value: "column", label: "Colonne", hint: "côtés + extrémités (bûche, pilier)" },
  { value: "bottomTop", label: "Dessus, dessous, côtés", hint: "comme l'herbe ou l'établi" },
  { value: "faces", label: "Six faces", hint: "une texture par face" },
];

export const TILING_CHOICES: { value: Tiling; label: string }[] = [
  { value: "none", label: "Aucun" },
  { value: "horizontal", label: "En largeur" },
  { value: "both", label: "Complet" },
];

export const STYLE_CHOICES: { value: TextureStyle; label: string }[] = [
  { value: "vanilla", label: "Jeu de base" },
  { value: "detailed", label: "Détaillé" },
  { value: "simple", label: "Simple" },
];

export const GUI_PRESETS: { value: GuiPreset; label: string; size: string }[] = [
  { value: "inventoryPanel", label: "Écran avec inventaire", size: "176 × 166" },
  { value: "panel", label: "Écran vide", size: "176 × 166" },
  { value: "button", label: "Bouton", size: "200 × 20" },
  { value: "slot", label: "Case d'inventaire", size: "18 × 18" },
  { value: "arrow", label: "Flèche de progression", size: "24 × 17" },
  { value: "blank", label: "Toile vide", size: "au choix" },
];

/** Qualité du raccord, en mots. */
export function seamVerdict(seam: number): { label: string; tone: "success" | "warning" | "danger" } {
  if (seam >= 85) return { label: "raccord invisible", tone: "success" };
  if (seam >= 65) return { label: "raccord discret", tone: "warning" };
  return { label: "raccord visible", tone: "danger" };
}

export const PROVIDER_LABEL: Record<ImageProvider, string> = {
  openRouter: "OpenRouter",
  gemini: "Google Gemini",
};

const PROVIDER_KEY = "mcstudio.textureProvider";

/** Dernier service choisi (préférence de ce poste ; OpenRouter par défaut). */
export function loadProvider(): ImageProvider {
  try {
    return localStorage.getItem(PROVIDER_KEY) === "gemini" ? "gemini" : "openRouter";
  } catch {
    return "openRouter";
  }
}

export function saveProvider(provider: ImageProvider): void {
  try {
    localStorage.setItem(PROVIDER_KEY, provider);
  } catch {
    // Stockage indisponible : le choix vaut pour cette fenêtre seulement.
  }
}

/** Modèles pour le menu : gratuits signalés, payants grisés tant qu'ils ne sont pas autorisés. */
export function modelOptions(models: ImageModel[], allowPaid: boolean, provider: ImageProvider = "openRouter"): SelectOption[] {
  return models.map((model) => ({
    value: model.id,
    label: model.name,
    hint: model.free ? "gratuit" : provider === "gemini" ? "facturé par Google" : "payant",
    disabled: !model.free && !allowPaid,
  }));
}

/** Garde le modèle choisi s'il est encore proposé, sinon le premier gratuit. */
export function pickModel(models: ImageModel[], current: string | null, allowPaid: boolean): string | null {
  const usable = models.filter((model) => model.free || allowPaid);
  if (current && usable.some((model) => model.id === current)) return current;
  return usable[0]?.id ?? null;
}
