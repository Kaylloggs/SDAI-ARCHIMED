import type { SelectOption } from "@/design-system/primitives";
import type { AssetKind } from "@/core/ipc/bindings/AssetKind";
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

const BASE: Omit<PixelOptions, "size" | "colors" | "transparent"> = {
  tiling: "none",
  outline: false,
  width: null,
  height: null,
  atlas: false,
  crop: null,
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

/** Taille d'une texture existante (16, 32 ou 64 px de côté, animée ou non), sinon 16. */
function keptSize(info?: Pick<TextureInfo, "width" | "height" | "exists">): number {
  if (!info?.exists) return 16;
  const { width, height } = info;
  return [16, 32, 64].includes(width) && height > 0 && height % width === 0 ? width : 16;
}

/** Taille de départ d'une texture libre qui n'existe pas encore (celles du jeu). */
const ASSET_SIZE: Record<AssetKind, [number, number]> = {
  overlay: [256, 256],
  entity: [64, 64],
  armor: [64, 32],
  particle: [8, 8],
  effect: [18, 18],
  painting: [32, 32],
  gui: [176, 166],
  other: [16, 16],
};

/** Familles dont les zones vides sont transparentes (le centre d'une superposition…). */
const ASSET_TRANSPARENT: Record<AssetKind, boolean> = {
  overlay: true,
  entity: true,
  armor: true,
  particle: true,
  effect: true,
  painting: false,
  gui: false,
  other: false,
};

/** Côté maximal d'une texture de taille libre (même limite que le backend). */
const FREE_MAX = 512;

/**
 * Réglages de départ, sans rien à choisir : un objet est détouré, une face de bloc remplit sa
 * case et se raccorde, la taille est celle de la texture en place (16 px sinon), l'icône est
 * plus fine, un élément d'interface ou une texture libre garde la taille de son fichier (celle
 * de sa famille dans le jeu si elle n'existe pas encore).
 */
export function defaultOptions(
  target: TextureTarget,
  info?: Pick<TextureInfo, "width" | "height" | "layout" | "exists"> & Partial<Pick<TextureInfo, "assetKind">>,
): PixelOptions {
  const size = keptSize(info);
  const colors = size === 16 ? 16 : 32;
  switch (target.kind) {
    case "item":
      return { ...BASE, size, colors, transparent: true };
    case "block":
      return { ...BASE, size, colors, transparent: false, tiling: defaultTiling(target.face, info?.layout ?? null) };
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
    case "asset": {
      const kind = info?.assetKind ?? "other";
      const known = info?.exists && info.width > 0 && info.height > 0;
      const [width, height] = known
        ? [Math.min(info.width, FREE_MAX), Math.min(info.height, FREE_MAX)]
        : ASSET_SIZE[kind];
      return {
        ...BASE,
        size: 16,
        // Grande image (superposition, écran) : couleurs gardées ; petite : palette de pixel art.
        colors: width * height > 64 * 64 ? 0 : 32,
        transparent: ASSET_TRANSPARENT[kind],
        width,
        height,
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
    case "asset":
      return `asset:${target.path}`;
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
  asset: "Texture",
};

/** Nom d'une famille de textures libres, au singulier (en-tête de l'atelier). */
export const ASSET_LABEL: Record<AssetKind, string> = {
  overlay: "Superposition",
  entity: "Entité",
  armor: "Armure",
  particle: "Particule",
  effect: "Effet",
  painting: "Tableau",
  gui: "Interface",
  other: "Texture",
};

export const ASSET_PLACEHOLDER: Record<AssetKind, string> = {
  overlay: "Ex. : vue à travers des lunettes à rayons X, bords sombres, reflets bleus",
  entity: "Ex. : golem de rubis, corps de pierre rouge veinée d'or",
  armor: "Ex. : armure en rubis, plaques rouges bordées d'or",
  particle: "Ex. : étincelle rouge vif",
  effect: "Ex. : œil bleu lumineux",
  painting: "Ex. : coucher de soleil sur des montagnes",
  gui: "Ex. : fond d'une forge, cadre en pierre sombre",
  other: "Ex. : ce que représente la texture",
};

/** Libellé de la famille d'une texture (objet, bloc… ou superposition, entité…). */
export function kindLabel(texture: Pick<TextureInfo, "target" | "assetKind">): string {
  return texture.assetKind ? ASSET_LABEL[texture.assetKind] : KIND_LABEL[texture.target.kind];
}

/** Exemple de description pour la texture. */
export function placeholderFor(texture: Pick<TextureInfo, "target" | "assetKind">): string {
  return texture.assetKind ? ASSET_PLACEHOLDER[texture.assetKind] : DESCRIPTION_PLACEHOLDER[texture.target.kind];
}

export const DESCRIPTION_PLACEHOLDER: Record<TextureTarget["kind"], string> = {
  item: "Ex. : une épée en rubis rouge, garde dorée, lame brillante",
  block: "Ex. : minerai de rubis, pierre grise avec des éclats rouges",
  icon: "Ex. : un dragon rouge enroulé autour d'une épée",
  gui: "Ex. : fond d'une forge, cadre en pierre sombre, emplacement central doré",
  asset: "Ex. : ce que représente la texture",
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

/** Proportions de la zone à sélectionner dans l'image reçue (largeur / hauteur). */
export function outputAspect(options: PixelOptions): number {
  return options.width && options.height ? options.width / options.height : 1;
}

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
