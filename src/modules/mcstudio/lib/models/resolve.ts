import type { BlockModel, ModelElement } from "./types";
import { VANILLA, vanillaKey } from "./vanilla";

/** Modèle prêt à afficher : cubes et textures hérités des parents. */
export type ResolvedModel = {
  /** Cubes : ceux du modèle, sinon du premier parent qui en a ; `null` si aucun. */
  elements: ModelElement[] | null;
  /** Les cubes viennent du modèle lui-même (modifiables sans le convertir). */
  own: boolean;
  /** Variables de texture fusionnées (celles de l'enfant l'emportent). */
  textures: Record<string, string>;
  /** Objet « à plat » (`item/generated`) : calques en relief. */
  generated: boolean;
  /** Parent du jeu que l'atelier ne sait pas reproduire (escalier, clôture…). */
  unknownParent: string | null;
  /** Parents traversés, du plus proche au plus lointain. */
  chain: string[];
};

const MAX_DEPTH = 16;

/**
 * Suit la chaîne des parents : ceux du mod sont lus dans le projet (`load`), ceux du jeu
 * viennent de la table `VANILLA`.
 */
export async function resolveModel(
  model: BlockModel,
  modId: string,
  load: (reference: string) => Promise<BlockModel | null>,
): Promise<ResolvedModel> {
  const maps: Record<string, string>[] = [];
  const chain: string[] = [];
  let elements: ModelElement[] | null = null;
  let own = false;
  let generated = false;
  let unknownParent: string | null = null;
  let current: BlockModel | null = model;
  let depth = 0;
  while (current && depth < MAX_DEPTH) {
    if (current.textures) maps.push(current.textures);
    if (!elements && Array.isArray(current.elements)) {
      elements = current.elements;
      own = depth === 0;
    }
    if ((current as { generated?: boolean }).generated) generated = true;
    const parent: string | undefined = current.parent;
    if (!parent) break;
    chain.push(parent);
    const key = vanillaKey(parent);
    if (key !== null) {
      const vanilla: BlockModel | undefined = VANILLA[key];
      if (!vanilla) {
        unknownParent = parent;
        break;
      }
      current = vanilla;
    } else if (parent.startsWith(`${modId}:`)) {
      current = await load(parent);
      if (!current) unknownParent = parent;
    } else {
      unknownParent = parent;
      current = null;
    }
    depth += 1;
  }
  const textures: Record<string, string> = {};
  for (const map of maps.reverse()) Object.assign(textures, map);
  return { elements: generated ? null : elements, own, textures, generated, unknownParent, chain };
}

/** `#side` → la référence finale (`dm:block/ruby`) ; `null` si la variable n'est pas définie. */
export function resolveTexture(value: string, textures: Record<string, string>): string | null {
  let current = value;
  for (let i = 0; i < 12; i += 1) {
    if (!current.startsWith("#")) return current;
    const next = textures[current.slice(1)];
    if (next === undefined) return null;
    current = next;
  }
  return null;
}

/** Référence de texture du mod → PNG du projet ; `null` pour une texture du jeu. */
export function textureFile(reference: string, modId: string): string | null {
  const [namespace, path] = reference.includes(":") ? reference.split(":", 2) : ["minecraft", reference];
  if (namespace !== modId || !path) return null;
  return `src/main/resources/assets/${modId}/textures/${path}.png`;
}

/** PNG du projet → référence de modèle (`dm:block/ruby`). */
export function textureReference(file: string, modId: string): string | null {
  const prefix = `src/main/resources/assets/${modId}/textures/`;
  if (!file.startsWith(prefix) || !file.endsWith(".png")) return null;
  return `${modId}:${file.slice(prefix.length, -".png".length)}`;
}
