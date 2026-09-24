/**
 * Modèles de blocs et d'objets au format JSON du jeu (`assets/<modid>/models/…`). Seuls les
 * champs utiles à l'atelier sont typés ; les autres (display, gui_light…) sont gardés tels quels.
 */

export type Vec3 = [number, number, number];
export type Uv = [number, number, number, number];

export type FaceName = "north" | "south" | "east" | "west" | "up" | "down";
export const FACES: FaceName[] = ["north", "south", "east", "west", "up", "down"];

export const FACE_LABEL: Record<FaceName, string> = {
  north: "Nord",
  south: "Sud",
  east: "Est",
  west: "Ouest",
  up: "Dessus",
  down: "Dessous",
};

export type ModelFace = {
  /** Zone de la texture, en 16ᵉ de texture ; absente : déduite de la position de la face. */
  uv?: Uv;
  /** Variable de texture (`#all`) ou référence directe. */
  texture: string;
  rotation?: 0 | 90 | 180 | 270;
  cullface?: FaceName;
  tintindex?: number;
};

export type ElementRotation = {
  origin: Vec3;
  axis: "x" | "y" | "z";
  /** Le jeu n'accepte que -45, -22.5, 0, 22.5 et 45. */
  angle: number;
  rescale?: boolean;
};

export type ModelElement = {
  name?: string;
  from: Vec3;
  to: Vec3;
  rotation?: ElementRotation;
  shade?: boolean;
  faces: Partial<Record<FaceName, ModelFace>>;
  [key: string]: unknown;
};

export type BlockModel = {
  parent?: string;
  textures?: Record<string, string>;
  elements?: ModelElement[];
  [key: string]: unknown;
};

export const ROTATION_ANGLES = [-45, -22.5, 0, 22.5, 45] as const;

/** Copie profonde (les modèles sont de simples objets JSON). */
export function cloneModel<T>(model: T): T {
  return JSON.parse(JSON.stringify(model)) as T;
}
