import type { EntityBone } from "@/core/ipc/bindings/EntityBone";
import type { EntityCube } from "@/core/ipc/bindings/EntityCube";
import type { EntityModel } from "@/core/ipc/bindings/EntityModel";
import type { Vec3 } from "./types";

/**
 * Modèles d'entité de départ (géométrie du jeu) et armure portée. Espace des modèles du jeu :
 * pixels, Y vers le bas, pivot de la racine à 24 = hauteur 0.
 */

export const cube = (origin: Vec3, size: Vec3, uv: [number, number], extra: Partial<EntityCube> = {}): EntityCube => ({
  origin,
  size,
  uv,
  inflate: 0,
  mirror: false,
  ...extra,
});

const bone = (name: string, pivot: Vec3, cubes: EntityCube[], extra: Partial<EntityBone> = {}): EntityBone => ({
  name,
  parent: null,
  pivot,
  rotation: [0, 0, 0],
  cubes,
  ...extra,
});

/** Humanoïde (joueur, zombie) : tête, corps, bras, jambes ; texture 64 × 64. */
function humanoid(name: string): EntityModel {
  return {
    name,
    textureWidth: 64,
    textureHeight: 64,
    bones: [
      bone("head", [0, 0, 0], [cube([-4, -8, -4], [8, 8, 8], [0, 0])]),
      bone("body", [0, 0, 0], [cube([-4, 0, -2], [8, 12, 4], [16, 16])]),
      bone("right_arm", [-5, 2, 0], [cube([-3, -2, -2], [4, 12, 4], [40, 16])]),
      bone("left_arm", [5, 2, 0], [cube([-1, -2, -2], [4, 12, 4], [32, 48])]),
      bone("right_leg", [-1.9, 12, 0], [cube([-2, 0, -2], [4, 12, 4], [0, 16])]),
      bone("left_leg", [1.9, 12, 0], [cube([-2, 0, -2], [4, 12, 4], [16, 48])]),
    ],
  };
}

/** Quadrupède (cochon) : tête, corps couché, quatre pattes ; texture 64 × 32. */
function quadruped(name: string): EntityModel {
  const leg = (legName: string, pivot: Vec3) => bone(legName, pivot, [cube([-2, 0, -2], [4, 6, 4], [0, 16])]);
  return {
    name,
    textureWidth: 64,
    textureHeight: 32,
    bones: [
      bone("head", [0, 12, -6], [cube([-4, -4, -8], [8, 8, 8], [0, 0])]),
      bone("body", [0, 11, 2], [cube([-5, -10, -7], [10, 16, 8], [28, 8])], { rotation: [90, 0, 0] }),
      leg("right_hind_leg", [-3, 18, 7]),
      leg("left_hind_leg", [3, 18, 7]),
      leg("right_front_leg", [-3, 18, -5]),
      leg("left_front_leg", [3, 18, -5]),
    ],
  };
}

/** Un seul cube posé au sol ; texture 32 × 32. */
function blank(name: string): EntityModel {
  return {
    name,
    textureWidth: 32,
    textureHeight: 32,
    bones: [bone("root", [0, 24, 0], [cube([-4, -8, -4], [8, 8, 8], [0, 0])])],
  };
}

export const ENTITY_TEMPLATES = {
  humanoid: { label: "Humanoïde", hint: "tête, corps, bras, jambes (64 × 64)", make: humanoid },
  quadruped: { label: "Quadrupède", hint: "tête, corps, quatre pattes (64 × 32)", make: quadruped },
  blank: { label: "Vide", hint: "un cube de départ (32 × 32)", make: blank },
} as const;
export type EntityTemplate = keyof typeof ENTITY_TEMPLATES;

// ── Armure portée ───────────────────────────────────────────────────────────

/** Pièce d'armure et la couche de texture qu'elle utilise (1 : casque, plastron, bottes). */
export type ArmorPiece = "helmet" | "chestplate" | "leggings" | "boots";
export const ARMOR_PIECES: { value: ArmorPiece; label: string; layer: 0 | 1 }[] = [
  { value: "helmet", label: "Casque", layer: 0 },
  { value: "chestplate", label: "Plastron", layer: 0 },
  { value: "leggings", label: "Jambières", layer: 1 },
  { value: "boots", label: "Bottes", layer: 0 },
];

/**
 * Modèle d'armure du jeu (`HumanoidModel` gonflé) pour une pièce : couche 1 gonflée de 1 px
 * (casque, plastron, bottes), couche 2 de 0,5 px (jambières). Texture 64 × 32.
 */
export function armorModel(piece: ArmorPiece): EntityModel {
  const inflate = piece === "leggings" ? 0.5 : 1;
  const bones: EntityBone[] = [];
  const add = (b: EntityBone) => bones.push(b);
  if (piece === "helmet") {
    add(bone("head", [0, 0, 0], [cube([-4, -8, -4], [8, 8, 8], [0, 0], { inflate })]));
    add(bone("hat", [0, 0, 0], [cube([-4, -8, -4], [8, 8, 8], [32, 0], { inflate: inflate + 0.5 })]));
  }
  if (piece === "chestplate" || piece === "leggings") {
    add(bone("body", [0, 0, 0], [cube([-4, 0, -2], [8, 12, 4], [16, 16], { inflate })]));
  }
  if (piece === "chestplate") {
    add(bone("right_arm", [-5, 2, 0], [cube([-3, -2, -2], [4, 12, 4], [40, 16], { inflate })]));
    add(bone("left_arm", [5, 2, 0], [cube([-1, -2, -2], [4, 12, 4], [40, 16], { inflate, mirror: true })]));
  }
  if (piece === "leggings" || piece === "boots") {
    add(bone("right_leg", [-1.9, 12, 0], [cube([-2, 0, -2], [4, 12, 4], [0, 16], { inflate })]));
    add(bone("left_leg", [1.9, 12, 0], [cube([-2, 0, -2], [4, 12, 4], [0, 16], { inflate, mirror: true })]));
  }
  return { name: `armor_${piece}`, textureWidth: 64, textureHeight: 32, bones };
}

/** Mannequin gris sous l'armure (le corps du joueur, sans texture). */
export const MANNEQUIN: EntityModel = { ...humanoid("mannequin"), name: "mannequin" };

// ── Édition ─────────────────────────────────────────────────────────────────

/** Nom d'os libre, dérivé de `base` (`bone`, `bone_2`…). */
export function freeBoneName(model: EntityModel, base = "bone"): string {
  const taken = new Set(model.bones.map((b) => b.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/** Descendants d'un os (lui compris). */
export function subtree(model: EntityModel, name: string): Set<string> {
  const found = new Set([name]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of model.bones) {
      if (b.parent && found.has(b.parent) && !found.has(b.name)) {
        found.add(b.name);
        grew = true;
      }
    }
  }
  return found;
}

/** Nom d'os valide pour le code Java (lettres, chiffres, `_`). */
export function boneNameProblem(model: EntityModel, name: string, current?: string): string | null {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) return "Lettres, chiffres et _ seulement.";
  if (name !== current && model.bones.some((b) => b.name === name)) return "Un autre os porte ce nom.";
  return null;
}
