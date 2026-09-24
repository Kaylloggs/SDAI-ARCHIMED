import { describe, expect, it } from "vitest";
import { armorModel, ENTITY_TEMPLATES, subtree } from "../lib/models/entity";
import {
  boneMatrices,
  boxUvRects,
  cubeQuads,
  defaultUv,
  elementParts,
  entityParts,
  packBoxUv,
  quadNormal,
  shadeOf,
  spriteParts,
} from "../lib/models/geometry";
import { resolveModel, resolveTexture, textureFile, textureReference } from "../lib/models/resolve";
import type { BlockModel, ModelElement } from "../lib/models/types";

const full: ModelElement = { from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: "#all" }, up: { texture: "#all" } } };

describe("modèles de blocs", () => {
  it("résout les parents du mod et du jeu, textures de l'enfant d'abord", async () => {
    const base: BlockModel = { parent: "minecraft:block/cube_all", textures: { all: "dm:block/base" } };
    const model: BlockModel = { parent: "dm:block/base_model", textures: { all: "dm:block/lamp" } };
    const resolved = await resolveModel(model, "dm", async (ref) => (ref === "dm:block/base_model" ? base : null));
    expect(resolved.chain).toEqual(["dm:block/base_model", "minecraft:block/cube_all", "block/cube"]);
    expect(resolved.own).toBe(false);
    expect(resolved.elements).toHaveLength(1);
    expect(resolveTexture("#north", resolved.textures)).toBe("dm:block/lamp");
    expect(textureFile("dm:block/lamp", "dm")).toBe("src/main/resources/assets/dm/textures/block/lamp.png");
    expect(textureFile("block/stone", "dm")).toBeNull();
    expect(textureReference("src/main/resources/assets/dm/textures/item/ruby.png", "dm")).toBe("dm:item/ruby");

    const stairs = await resolveModel({ parent: "minecraft:block/stairs" }, "dm", async () => null);
    expect(stairs.unknownParent).toBe("minecraft:block/stairs");
    const item = await resolveModel({ parent: "item/handheld", textures: { layer0: "dm:item/sword" } }, "dm", async () => null);
    expect(item.generated).toBe(true);
    expect(item.elements).toBeNull();
  });

  it("calcule les UV par défaut comme le jeu", () => {
    const slab: ModelElement = { from: [0, 0, 0], to: [16, 8, 16], faces: {} };
    expect(defaultUv(slab, "north")).toEqual([0, 8, 16, 16]);
    expect(defaultUv(slab, "up")).toEqual([0, 0, 16, 16]);
    expect(defaultUv({ from: [2, 0, 4], to: [6, 1, 10] }, "down")).toEqual([2, 6, 6, 12]);
  });

  it("oriente chaque face vers l'extérieur et applique la rotation des UV", () => {
    const parts = elementParts(full, 0, () => ({ file: "t.png" }));
    const north = parts.find((p) => p.face === "north")!;
    expect(quadNormal(north.quads[0]!)[2]).toBeCloseTo(-1);
    const up = parts.find((p) => p.face === "up")!;
    expect(quadNormal(up.quads[0]!)[1]).toBeCloseTo(1);
    // Haut-gauche de la face nord (côté est) = haut-gauche de l'image.
    expect(north.quads[0]!.positions[0]).toEqual([16, 16, 0]);
    expect(north.quads[0]!.uvs[0]).toEqual([0, 0]);
    const turned = elementParts({ ...full, faces: { north: { texture: "#all", rotation: 90 } } }, 0, () => ({ file: null }))[0]!;
    // Tournée d'un quart : le coin haut-gauche montre le bas-gauche de l'image.
    expect(turned.quads[0]!.uvs[0]).toEqual([0, 1]);
    expect(shadeOf([0, 1, 0])).toBe(1);
    expect(shadeOf([0, -1, 0])).toBe(0.5);
    expect(shadeOf([1, 0, 0])).toBeCloseTo(0.6);
  });

  it("met un objet à plat en relief, bords seulement autour des pixels opaques", () => {
    const data = new Uint8ClampedArray(2 * 2 * 4);
    data[3] = 255; // un seul pixel opaque (0, 0)
    const [part] = spriteParts({ width: 2, height: 2, data }, "i.png", 0);
    expect(part!.quads).toHaveLength(2 + 4);
  });
});

describe("modèles d'entité", () => {
  it("découpe la texture en boîte comme le jeu", () => {
    const rects = boxUvRects({ uv: [0, 0], size: [8, 8, 8] });
    expect(rects.down).toEqual([8, 0, 8, 8]);
    expect(rects.north).toEqual([8, 8, 8, 8]);
    expect(rects.south).toEqual([24, 8, 8, 8]);
    const quads = cubeQuads({ origin: [-4, -8, -4], size: [8, 8, 8], uv: [0, 0], inflate: 0, mirror: false }, { width: 64, height: 64 });
    // Face nord : de u = 8 à 16, v = 8 à 16 (sur 64).
    const north = quads[3]!;
    expect(north.uvs.map(([u]) => u * 64).sort((a, b) => a - b)).toEqual([8, 8, 16, 16]);
    // Espace du modèle : la face nord regarde vers -Z.
    expect(quadNormal(north)[2]).toBeCloseTo(-1);
  });

  it("place les os dans le monde : sol à 0, la tête en haut", () => {
    const player = ENTITY_TEMPLATES.humanoid.make("steve");
    const parts = entityParts(player, "t.png");
    const heights = parts.flatMap((p) => p.quads.flatMap((q) => q.positions.map((v) => v[1])));
    expect(Math.min(...heights)).toBeCloseTo(0);
    expect(Math.max(...heights)).toBeCloseTo(32);
    const matrices = boneMatrices(player);
    expect(matrices.size).toBe(6);
    // Les faces restent tournées vers l'extérieur après le retournement.
    const head = parts.find((p) => p.owner === "c:head:0")!;
    const top = head.quads[0]!; // face « down » du jeu = dessus de la tête
    expect(quadNormal(top)[1]).toBeCloseTo(1);
    const front = head.quads[3]!; // nord du modèle = avant, vers +Z dans le monde
    expect(quadNormal(front)[2]).toBeCloseTo(1);
  });

  it("range les UV sans chevauchement", () => {
    const { uvs, width, height } = packBoxUv([[8, 8, 8], [8, 12, 4], [4, 12, 4], [4, 12, 4]], 64);
    expect(width).toBe(64);
    const rects = uvs.map(([u, v], i) => {
      const [w, h, d] = ([[8, 8, 8], [8, 12, 4], [4, 12, 4], [4, 12, 4]] as const)[i]!;
      return [u, v, 2 * (w + d), d + h] as const;
    });
    for (const [i, a] of rects.entries()) {
      expect(a[0] + a[2]).toBeLessThanOrEqual(width);
      expect(a[1] + a[3]).toBeLessThanOrEqual(height);
      for (const b of rects.slice(i + 1)) {
        const apart = a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1];
        expect(apart).toBe(true);
      }
    }
  });

  it("armure du jeu : couches et gonflement", () => {
    expect(armorModel("helmet").bones.map((b) => b.name)).toEqual(["head", "hat"]);
    expect(armorModel("leggings").bones[0]!.cubes[0]!.inflate).toBe(0.5);
    expect(armorModel("chestplate").bones.find((b) => b.name === "left_arm")!.cubes[0]!.mirror).toBe(true);
    const model = ENTITY_TEMPLATES.humanoid.make("x");
    model.bones[1]!.parent = "head";
    expect([...subtree(model, "head")].sort()).toEqual(["body", "head"]);
  });
});
