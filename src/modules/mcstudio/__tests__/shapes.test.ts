import { describe, expect, it } from "vitest";
import { boxUvRects } from "../lib/models/geometry";
import { freeGroupName, groupAt, indicesOf, outline, parentOf, placeElements, removeElements, ungroup } from "../lib/models/groups";
import {
  carveCube,
  carveElement,
  copyCubeTexture,
  shapeBounds,
  shapeBoxes,
  spriteElements,
  subtractBox,
  type Aabb,
  type ShapeParams,
} from "../lib/models/shapes";
import type { BlockModel, ModelElement, Vec3 } from "../lib/models/types";

const volume = (boxes: Aabb[]) => boxes.reduce((sum, b) => sum + b.to.reduce((p, v, i) => p * (v - b.from[i]!), 1), 0);
const inside = (boxes: Aabb[], p: Vec3) => boxes.some((b) => p.every((v, i) => v > b.from[i]! && v < b.to[i]!));
const overlaps = (boxes: Aabb[]) =>
  boxes.some((a, i) => boxes.some((b, j) => j > i && a.from.every((v, k) => Math.max(v, b.from[k]!) < Math.min(a.to[k]!, b.to[k]!))));
const params = (over: Partial<ShapeParams>): ShapeParams => ({ kind: "cube", size: [8, 8, 8], axis: "y", step: 1, wall: 0, ...over });

describe("formes en cubes", () => {
  it("un cube plein reste un seul cube centré", () => {
    expect(shapeBoxes(params({ size: [4, 6, 2] }))).toEqual([{ from: [-2, -3, -1], to: [2, 3, 1] }]);
  });

  it("un cylindre tient dans sa boîte, sans chevauchement, en longs cubes le long de l'axe", () => {
    for (const axis of ["x", "y", "z"] as const) {
      const boxes = shapeBoxes(params({ kind: "cylinder", size: [8, 12, 0], axis }));
      expect(overlaps(boxes)).toBe(false);
      const bounds = shapeBounds(params({ kind: "cylinder", size: [8, 12, 0], axis }));
      for (const box of boxes) for (let i = 0; i < 3; i += 1) expect(Math.abs(box.to[i]!)).toBeLessThanOrEqual(bounds[i]! / 2 + 1e-9);
      // Section d'un disque de rayon 4 : entre un carré inscrit et le carré entier.
      const along = { x: 0, y: 1, z: 2 }[axis];
      expect(boxes.every((b) => b.to[along]! - b.from[along]! === 12)).toBe(true);
      expect(volume(boxes)).toBeGreaterThan(32 * 12);
      expect(volume(boxes)).toBeLessThan(64 * 12);
      expect(boxes.length).toBeLessThanOrEqual(8);
    }
    const y = shapeBoxes(params({ kind: "cylinder", size: [8, 12, 0], axis: "y" }));
    expect(inside(y, [0, 0, 0])).toBe(true);
    expect(inside(y, [3.9, 5, 3.9])).toBe(false);
  });

  it("un cône s'affine vers la pointe, une sphère est ronde, une forme creuse l'est vraiment", () => {
    const cone = shapeBoxes(params({ kind: "cone", size: [10, 10, 0], axis: "y", step: 1 }));
    expect(inside(cone, [0, -4.5, 0])).toBe(true);
    expect(inside(cone, [3.9, -4.5, 0.5])).toBe(true);
    expect(inside(cone, [4, 4, 0])).toBe(false);
    expect(overlaps(cone)).toBe(false);
    const sphere = shapeBoxes(params({ kind: "sphere", size: [10, 0, 0] }));
    expect(inside(sphere, [0, 0, 0])).toBe(true);
    expect(inside(sphere, [4.4, 4.4, 4.4])).toBe(false);
    const tube = shapeBoxes(params({ kind: "cylinder", size: [10, 6, 0], wall: 1 }));
    expect(inside(tube, [0, 0, 0])).toBe(false);
    expect(inside(tube, [4.5, 0, 0])).toBe(true);
    const box = shapeBoxes(params({ kind: "cube", size: [8, 8, 8], wall: 1 }));
    expect(inside(box, [0, 0, 0])).toBe(false);
    expect(volume(box)).toBe(8 * 8 * 8 - 6 * 6 * 6);
  });
});

describe("creuser", () => {
  it("une boîte moins un trou garde exactement le reste", () => {
    const box: Aabb = { from: [0, 0, 0], to: [16, 16, 16] };
    const pieces = subtractBox(box, { from: [4, 4, 4], to: [12, 20, 12] })!;
    expect(overlaps(pieces)).toBe(false);
    expect(volume(pieces)).toBe(16 ** 3 - 8 * 12 * 8);
    expect(inside(pieces, [8, 14, 8])).toBe(false);
    expect(inside(pieces, [8, 2, 8])).toBe(true);
    expect(subtractBox(box, { from: [20, 0, 0], to: [24, 4, 4] })).toBeNull();
    expect(subtractBox(box, { from: [16, 0, 0], to: [20, 4, 4] })).toBeNull();
  });

  it("les morceaux d'un cube de bloc gardent la texture au même endroit", () => {
    const element: ModelElement = {
      name: "table",
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: { north: { texture: "#side", uv: [0, 0, 16, 16] }, up: { texture: "#top" } },
    };
    const pieces = carveElement(element, { from: [0, 8, 8], to: [16, 16, 16] })!;
    expect(pieces.length).toBe(2);
    const low = pieces.find((p) => p.to[1] === 8)!;
    // Face nord du bas : la moitié basse de l'image.
    expect(low.faces.north?.uv).toEqual([0, 8, 16, 16]);
    // Coupe (dessus du bas, à mi-hauteur) : même texture que le dessus d'origine, UV automatiques.
    expect(low.faces.up).toEqual({ texture: "#top" });
    expect(pieces.every((p) => p.name?.startsWith("table_"))).toBe(true);
    expect(carveElement({ ...element, rotation: { origin: [8, 8, 8], axis: "y", angle: 22.5 } }, { from: [0, 0, 0], to: [4, 4, 4] })).toBeNull();
  });

  it("les morceaux d'un cube d'entité reprennent sa peau", () => {
    const cube = { origin: [0, 0, 0] as Vec3, size: [4, 4, 4] as Vec3, uv: [0, 0] as [number, number], inflate: 0, mirror: false };
    const pieces = carveCube(cube, { from: [2, -1, -1], to: [5, 5, 5] })!;
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.size).toEqual([2, 4, 4]);
    const width = 32;
    const pixels = { width, height: 32, data: new Uint8ClampedArray(width * 32 * 4) };
    // Face nord de l'original : moitié gauche rouge, moitié droite bleue.
    const [nx, ny, nw, nh] = boxUvRects(cube).north;
    for (let y = ny; y < ny + nh; y += 1) {
      for (let x = nx; x < nx + nw; x += 1) pixels.data.set(x < nx + nw / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * width + x) * 4);
    }
    const piece = { ...pieces[0]!, uv: [16, 16] as [number, number] };
    copyCubeTexture(pixels, cube, piece);
    const [px, py, pw] = boxUvRects(piece).north;
    const colors = new Set(Array.from({ length: pw }, (_, i) => pixels.data[((py + 1) * width + px + i) * 4]));
    // Le morceau (x de 0 à 2) couvre une seule moitié de la face d'origine.
    expect(colors.size).toBe(1);
  });
});

describe("objets en relief", () => {
  it("un objet à plat devient des cubes d'un pixel d'épaisseur regroupés en rectangles", () => {
    const w = 4;
    const data = new Uint8ClampedArray(w * w * 4);
    const set = (x: number, y: number) => data.set([200, 50, 50, 255], (y * w + x) * 4);
    for (let x = 0; x < 4; x += 1) set(x, 0);
    set(1, 1);
    const elements = spriteElements({ width: w, height: w, data }, "#layer0");
    expect(elements).toHaveLength(2);
    const top = elements[0]!;
    expect(top.from).toEqual([0, 12, 7.5]);
    expect(top.to).toEqual([16, 16, 8.5]);
    expect(top.faces.south?.uv).toEqual([0, 0, 16, 4]);
    expect(top.faces.north?.uv).toEqual([16, 0, 0, 4]);
    expect(top.faces.up).toBeDefined();
    expect(elements[1]!.faces.up).toBeUndefined();
  });
});

describe("groupes façon Blockbench", () => {
  const model = (): BlockModel => ({
    elements: [0, 1, 2, 3].map((i) => ({ from: [i, 0, 0], to: [i + 1, 1, 1], faces: {} })) as ModelElement[],
  });

  it("des cubes rangés dans un groupe, retirés, renumérotés", () => {
    const m = model();
    expect(outline(m)).toEqual([0, 1, 2, 3]);
    const path = placeElements(m, [1, 2], { group: { name: "pied", origin: [8, 0, 8] } })!;
    expect(outline(m)).toEqual([0, 3, { name: "pied", origin: [8, 0, 8], color: 0, children: [1, 2] }]);
    expect(indicesOf(groupAt(outline(m), path)!)).toEqual([1, 2]);
    expect(parentOf(outline(m), 2)).toBe(path);
    expect(freeGroupName(m, "pied")).toBe("pied_2");
    removeElements(m, [0, 1]);
    expect(m.elements).toHaveLength(2);
    expect(outline(m)).toEqual([1, { name: "pied", origin: [8, 0, 8], color: 0, children: [0] }]);
    removeElements(m, [0]);
    expect(m.groups).toBeUndefined();
    expect(outline(m)).toEqual([0]);
  });

  it("groupes illisibles écartés, cubes oubliés ajoutés, dégroupement", () => {
    const m = model();
    m.groups = [{ name: "a", origin: [0, 0, 0], children: [0, 9, { name: "b", origin: [0, 0, 0], children: [1] }] }, "x", 0];
    expect(outline(m)).toEqual([{ name: "a", origin: [0, 0, 0], children: [0, { name: "b", origin: [0, 0, 0], children: [1] }] }, 2, 3]);
    ungroup(m, "0");
    expect(outline(m)).toEqual([0, { name: "b", origin: [0, 0, 0], children: [1] }, 2, 3]);
  });
});

describe("remplacement de cubes dans leurs groupes", () => {
  it("les morceaux prennent la place du cube, dans son groupe", async () => {
    const { replaceElements } = await import("../lib/models/groups");
    const m: BlockModel = {
      elements: [0, 1, 2].map((i) => ({ name: `c${i}`, from: [i, 0, 0], to: [i + 1, 1, 1], faces: {} })) as ModelElement[],
      groups: [0, { name: "g", origin: [0, 0, 0], children: [1] }, 2],
    };
    const piece = (name: string): ModelElement => ({ name, from: [0, 0, 0], to: [1, 1, 1], faces: {} });
    const mapping = replaceElements(m, new Map([[1, [piece("a"), piece("b")]]]));
    expect(m.elements!.map((e) => e.name)).toEqual(["c0", "a", "b", "c2"]);
    expect(mapping.get(1)).toEqual([1, 2]);
    expect(outline(m)).toEqual([0, { name: "g", origin: [0, 0, 0], children: [1, 2] }, 3]);
  });
});

describe("zones de texture des nouveaux cubes d'entité", () => {
  it("chaque cube a sa place, la texture grandit quand elle est pleine", async () => {
    const { allocateBoxUv } = await import("../lib/models/shapes");
    const small = allocateBoxUv([[0, 0, 16, 16]], [[4, 4, 4]], { width: 16, height: 16 });
    // 16 × 16 déjà pris : la texture double en hauteur, le cube va dessous.
    expect(small.height).toBe(32);
    expect(small.uvs[0]).toEqual([0, 16]);
    const many = allocateBoxUv([], [[2, 2, 2], [2, 2, 2], [2, 2, 2]], { width: 64, height: 32 });
    const rects = many.uvs.map(([u, v]) => ({ from: [u, v, 0] as Vec3, to: [u + 8, v + 4, 1] as Vec3 }));
    expect(overlaps(rects)).toBe(false);
    expect(many.width).toBe(64);
  });
});
