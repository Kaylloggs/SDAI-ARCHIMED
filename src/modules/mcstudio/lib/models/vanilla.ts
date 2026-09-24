import type { BlockModel, FaceName, ModelElement } from "./types";

/**
 * Modèles parents du jeu que l'atelier sait reproduire (on n'a pas les fichiers du jeu) :
 * cubes, colonnes, dalles, croix des plantes, tapis, et les objets « à plat ».
 */

const full = (textures: Record<FaceName, string>, extra: Partial<ModelElement> = {}): ModelElement => ({
  from: [0, 0, 0],
  to: [16, 16, 16],
  faces: {
    down: { texture: textures.down, cullface: "down" },
    up: { texture: textures.up, cullface: "up" },
    north: { texture: textures.north, cullface: "north" },
    south: { texture: textures.south, cullface: "south" },
    west: { texture: textures.west, cullface: "west" },
    east: { texture: textures.east, cullface: "east" },
  },
  ...extra,
});

const sides = (all: string) => ({ north: all, south: all, east: all, west: all });

const slab = (top: boolean): ModelElement => ({
  from: [0, top ? 8 : 0, 0],
  to: [16, top ? 16 : 8, 16],
  faces: {
    down: { texture: "#bottom", cullface: top ? undefined : "down" },
    up: { texture: "#top", cullface: top ? "up" : undefined },
    north: { texture: "#side", cullface: "north", uv: top ? [0, 0, 16, 8] : [0, 8, 16, 16] },
    south: { texture: "#side", cullface: "south", uv: top ? [0, 0, 16, 8] : [0, 8, 16, 16] },
    west: { texture: "#side", cullface: "west", uv: top ? [0, 0, 16, 8] : [0, 8, 16, 16] },
    east: { texture: "#side", cullface: "east", uv: top ? [0, 0, 16, 8] : [0, 8, 16, 16] },
  },
});

const cross = (texture: string): ModelElement[] => [
  {
    from: [0.8, 0, 8],
    to: [15.2, 16, 8],
    shade: false,
    rotation: { origin: [8, 8, 8], axis: "y", angle: 45, rescale: true },
    faces: { north: { texture }, south: { texture } },
  },
  {
    from: [8, 0, 0.8],
    to: [8, 16, 15.2],
    shade: false,
    rotation: { origin: [8, 8, 8], axis: "y", angle: 45, rescale: true },
    faces: { west: { texture }, east: { texture } },
  },
];

export type VanillaModel = BlockModel & {
  /** Objet « à plat » : les calques `layer0`, `layer1`… en relief. */
  generated?: boolean;
};

export const VANILLA: Record<string, VanillaModel> = {
  "block/block": {},
  "block/thin_block": {},
  "block/cube": {
    elements: [
      full({ down: "#down", up: "#up", north: "#north", south: "#south", west: "#west", east: "#east" }),
    ],
    textures: { particle: "#north" },
  },
  "block/cube_all": {
    parent: "block/cube",
    textures: { particle: "#all", down: "#all", up: "#all", ...sides("#all") },
  },
  "block/cube_mirrored_all": { parent: "block/cube_all" },
  "block/leaves": { parent: "block/cube_all" },
  "block/cube_column": {
    parent: "block/cube",
    textures: { particle: "#side", down: "#end", up: "#end", ...sides("#side") },
  },
  "block/cube_column_horizontal": { parent: "block/cube_column" },
  "block/cube_bottom_top": {
    parent: "block/cube",
    textures: { particle: "#side", down: "#bottom", up: "#top", ...sides("#side") },
  },
  "block/cube_top": {
    parent: "block/cube",
    textures: { particle: "#side", down: "#side", up: "#top", ...sides("#side") },
  },
  "block/orientable_with_bottom": {
    parent: "block/cube",
    textures: { particle: "#front", down: "#bottom", up: "#top", north: "#front", south: "#side", east: "#side", west: "#side" },
  },
  "block/orientable": { parent: "block/orientable_with_bottom", textures: { bottom: "#top" } },
  "block/slab": { elements: [slab(false)], textures: { particle: "#side" } },
  "block/slab_top": { elements: [slab(true)], textures: { particle: "#side" } },
  "block/cross": { elements: cross("#cross"), textures: { particle: "#cross" } },
  "block/tinted_cross": { parent: "block/cross" },
  "block/carpet": {
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 1, 16],
        faces: {
          down: { texture: "#wool", cullface: "down" },
          up: { texture: "#wool" },
          north: { texture: "#wool", cullface: "north", uv: [0, 15, 16, 16] },
          south: { texture: "#wool", cullface: "south", uv: [0, 15, 16, 16] },
          west: { texture: "#wool", cullface: "west", uv: [0, 15, 16, 16] },
          east: { texture: "#wool", cullface: "east", uv: [0, 15, 16, 16] },
        },
      },
    ],
    textures: { particle: "#wool" },
  },
  "item/generated": { generated: true },
  "builtin/generated": { generated: true },
  "item/handheld": { parent: "item/generated" },
  "item/handheld_rod": { parent: "item/handheld" },
};

/** `minecraft:block/cube_all` → `block/cube_all` ; `null` pour un modèle d'un autre mod. */
export function vanillaKey(reference: string): string | null {
  if (!reference.includes(":")) return reference;
  const [namespace, path] = reference.split(":", 2);
  return namespace === "minecraft" ? (path ?? null) : null;
}
