import type { GameAssetEntry } from "@/core/ipc/bindings/GameAssetEntry";
import type { GameAssetKind } from "@/core/ipc/bindings/GameAssetKind";
import type { GameEngine } from "@/core/ipc/bindings/GameEngine";
import type { GameGeneration } from "@/core/ipc/bindings/GameGeneration";
import type { GameModelFormat } from "@/core/ipc/bindings/GameModelFormat";
import type { ModelCapabilities } from "@/core/ipc/bindings/ModelCapabilities";
import type { ProviderModel } from "@/core/ipc/bindings/ProviderModel";
import { ASSET_KIND, ENGINE_LABEL } from "./labels";

export type AssetFilter = "all" | "images" | "models" | "audio" | "other";

const GROUP: Record<GameAssetKind, Exclude<AssetFilter, "all">> = {
  texture: "images",
  sprite: "images",
  ui: "images",
  concept: "images",
  vfx: "images",
  material: "images",
  model: "models",
  animation: "models",
  scene: "models",
  prefab: "models",
  audio: "audio",
  music: "audio",
  script: "other",
  shader: "other",
  font: "other",
  data: "other",
  other: "other",
};

export function assetGroup(kind: GameAssetKind): Exclude<AssetFilter, "all"> {
  return GROUP[kind];
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;

/** Le fichier s'affiche dans un `<img>` (les formats des moteurs, TGA ou EXR, non). */
export function isPreviewable(path: string | null | undefined): boolean {
  return Boolean(path && IMAGE_EXT.test(path));
}

export function isBlend(path: string | null | undefined): boolean {
  return Boolean(path && /\.blend$/i.test(path));
}

/** Filtre de la liste : famille de ressource, puis texte cherché dans le nom, le chemin et la nature. */
export function filterAssets(entries: GameAssetEntry[], filter: AssetFilter, query: string): GameAssetEntry[] {
  const words = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  return entries.filter((entry) => {
    if (filter !== "all" && assetGroup(entry.asset.kind) !== filter) return false;
    if (words.length === 0) return true;
    const haystack = `${entry.asset.name} ${entry.asset.path ?? ""} ${ASSET_KIND[entry.asset.kind]}`
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
    return words.every((w) => haystack.includes(w));
  });
}

/** Format d'export conseillé : GLB pour Godot, FBX pour Unity et Unreal. */
export function defaultFormat(engine: GameEngine | null): GameModelFormat {
  return engine === "unity" || engine === "unreal" ? "fbx" : "glb";
}

export function importVerb(engine: GameEngine | null): string {
  return engine ? `Importer dans ${ENGINE_LABEL[engine]}` : "Importer dans le moteur";
}

/** Coût annoncé par le fournisseur pour cette génération (jamais estimé ici). */
export function generationCost(generation: GameGeneration): string | null {
  const usage = (generation.params as { usage?: { costUsd?: number | null } } | null)?.usage;
  const cost = usage?.costUsd;
  if (typeof cost !== "number") return null;
  return `${cost.toLocaleString("fr-FR", { maximumFractionDigits: 4 })} $`;
}

/** Demande d'origine (sans l'usage ni la charte ajoutés par Game Studio). */
export function generationRequest(generation: GameGeneration): string {
  const request = (generation.params as { request?: unknown } | null)?.request;
  return typeof request === "string" && request.trim() ? request : generation.prompt;
}

/** Modèles qui produisent une image à partir d'un texte. */
export function imageModels(models: ProviderModel[]): ProviderModel[] {
  return models.filter((m) => m.capabilities.textToImage);
}

/** Prix par image quand le fournisseur le publie. */
export function modelPrice(model: ProviderModel | undefined): string | null {
  if (!model) return null;
  if (model.free) return "sans frais selon le fournisseur";
  const line = model.pricing.find((p) => p.unit === "image") ?? model.pricing[0];
  if (!line) return null;
  return `${line.costUsd.toLocaleString("fr-FR", { maximumFractionDigits: 4 })} $ par ${line.unit}`;
}

/** Fond transparent proposé seulement si le modèle le sait, et hors textures répétées. */
export function canBeTransparent(capabilities: ModelCapabilities | undefined, kind: GameAssetKind): boolean {
  return Boolean(capabilities?.transparentBackground) && kind !== "texture" && kind !== "material";
}

/** Nom proposé à partir de la demande : « Une caisse en bois usée » → « Caisse en bois usée ». */
export function suggestName(prompt: string): string {
  const cleaned = prompt
    .trim()
    .split(/[.,;:!\n]/)[0]!
    .replace(/^(une?|des|la|le|les|l')\s+/i, "")
    .trim();
  const short = cleaned.split(/\s+/).slice(0, 5).join(" ");
  return short ? short.charAt(0).toUpperCase() + short.slice(1) : "";
}
