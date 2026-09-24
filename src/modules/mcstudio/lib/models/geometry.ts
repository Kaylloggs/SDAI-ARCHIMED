import { Euler, Matrix4, Vector3 } from "three";
import type { EntityBone } from "@/core/ipc/bindings/EntityBone";
import type { EntityCube } from "@/core/ipc/bindings/EntityCube";
import type { EntityModel } from "@/core/ipc/bindings/EntityModel";
import type { FaceName, ModelElement, Uv, Vec3 } from "./types";

/**
 * Géométrie des modèles, calculée comme le jeu : faces des blocs (UV par défaut, rotation des
 * UV, rotation d'un cube autour d'un axe) et cubes des entités (UV « en boîte »). Tout est en
 * pixels du monde (16 = un bloc), Y vers le haut.
 */

export type UvPoint = [number, number];

/** Quatre coins, dans le sens inverse des aiguilles d'une montre vu de l'extérieur. */
export type Quad = {
  positions: [Vec3, Vec3, Vec3, Vec3];
  /** UV normalisés (0 à 1, v vers le bas de l'image). */
  uvs: [UvPoint, UvPoint, UvPoint, UvPoint];
};

/** Morceau affichable : une face de cube de bloc, ou un cube d'entité (six faces). */
export type Part = {
  id: string;
  /** Ce que la sélection désigne : `e3` (cube de bloc), `c:head:0` (cube d'entité). */
  owner: string;
  face: FaceName | null;
  /** Texture (PNG du projet) ; `null` : texture du jeu ou manquante. */
  texture: string | null;
  quads: Quad[];
  /** Ombrage du jeu selon l'orientation (désactivé pour les plantes en croix). */
  shade: boolean;
};

// ── Blocs et objets ─────────────────────────────────────────────────────────

/** UV par défaut d'une face, déduite de la position du cube (comme le jeu). */
export function defaultUv(element: Pick<ModelElement, "from" | "to">, face: FaceName): Uv {
  const [fx, fy, fz] = element.from;
  const [tx, ty, tz] = element.to;
  switch (face) {
    case "down":
      return [fx, 16 - tz, tx, 16 - fz];
    case "up":
      return [fx, fz, tx, tz];
    case "north":
      return [16 - tx, 16 - ty, 16 - fx, 16 - fy];
    case "south":
      return [fx, 16 - ty, tx, 16 - fy];
    case "west":
      return [fz, 16 - ty, tz, 16 - fy];
    case "east":
      return [16 - tz, 16 - ty, 16 - fz, 16 - fy];
  }
}

/** Coins d'une face vue de l'extérieur : haut-gauche, haut-droite, bas-droite, bas-gauche. */
function faceCorners(from: Vec3, to: Vec3, face: FaceName): [Vec3, Vec3, Vec3, Vec3] {
  const [fx, fy, fz] = from;
  const [tx, ty, tz] = to;
  switch (face) {
    case "north":
      return [[tx, ty, fz], [fx, ty, fz], [fx, fy, fz], [tx, fy, fz]];
    case "south":
      return [[fx, ty, tz], [tx, ty, tz], [tx, fy, tz], [fx, fy, tz]];
    case "west":
      return [[fx, ty, fz], [fx, ty, tz], [fx, fy, tz], [fx, fy, fz]];
    case "east":
      return [[tx, ty, tz], [tx, ty, fz], [tx, fy, fz], [tx, fy, tz]];
    case "up":
      return [[fx, ty, fz], [tx, ty, fz], [tx, ty, tz], [fx, ty, tz]];
    case "down":
      return [[fx, fy, tz], [tx, fy, tz], [tx, fy, fz], [fx, fy, fz]];
  }
}

/** Matrice de la rotation d'un cube (axe, angle, remise à l'échelle), en pixels du bloc. */
export function elementMatrix(element: ModelElement): Matrix4 {
  const rotation = element.rotation;
  if (!rotation || !rotation.angle) return new Matrix4();
  const angle = (rotation.angle * Math.PI) / 180;
  const [ox, oy, oz] = rotation.origin;
  const turn = new Matrix4();
  if (rotation.axis === "x") turn.makeRotationX(angle);
  else if (rotation.axis === "y") turn.makeRotationY(angle);
  else turn.makeRotationZ(angle);
  if (rotation.rescale) {
    const factor = 1 / Math.cos(Math.abs(angle));
    const scale = new Matrix4().makeScale(
      rotation.axis === "x" ? 1 : factor,
      rotation.axis === "y" ? 1 : factor,
      rotation.axis === "z" ? 1 : factor,
    );
    turn.multiply(scale);
  }
  return new Matrix4().makeTranslation(ox, oy, oz).multiply(turn).multiply(new Matrix4().makeTranslation(-ox, -oy, -oz));
}

function apply(matrix: Matrix4, point: Vec3): Vec3 {
  const v = new Vector3(...point).applyMatrix4(matrix);
  return [v.x, v.y, v.z];
}

/** Rapport d'une texture animée (bande verticale d'images) : on montre la première image. */
export type TextureSize = { width: number; height: number };

function frameScale(size: TextureSize | undefined): number {
  if (!size || size.height <= size.width || size.height % size.width !== 0) return 1;
  return size.width / size.height;
}

/**
 * Faces d'un cube de bloc. `textureOf` donne, pour la variable d'une face (`#side`), le PNG du
 * projet et sa taille.
 */
export function elementParts(
  element: ModelElement,
  index: number,
  textureOf: (variable: string) => { file: string | null; size?: TextureSize },
): Part[] {
  const matrix = elementMatrix(element);
  const parts: Part[] = [];
  for (const [name, face] of Object.entries(element.faces) as [FaceName, NonNullable<ModelElement["faces"][FaceName]>][]) {
    if (!face) continue;
    const [u1, v1, u2, v2] = face.uv ?? defaultUv(element, name);
    const { file, size } = textureOf(face.texture);
    const k = frameScale(size);
    const base: UvPoint[] = [
      [u1 / 16, (v1 / 16) * k],
      [u2 / 16, (v1 / 16) * k],
      [u2 / 16, (v2 / 16) * k],
      [u1 / 16, (v2 / 16) * k],
    ];
    // Rotation des UV (sens horaire) : le coin haut-gauche de l'image passe à droite, etc.
    const turns = ((face.rotation ?? 0) / 90) % 4;
    const uv = (corner: number): UvPoint => base[(corner - turns + 4) % 4]!;
    const corners = faceCorners(element.from, element.to, name).map((p) => apply(matrix, p)) as [Vec3, Vec3, Vec3, Vec3];
    parts.push({
      id: `e${index}:${name}`,
      owner: `e${index}`,
      face: name,
      texture: file,
      shade: element.shade !== false,
      // Haut-gauche, bas-gauche, bas-droite, haut-droite : sens inverse des aiguilles.
      quads: [{ positions: [corners[0], corners[3], corners[2], corners[1]], uvs: [uv(0), uv(3), uv(2), uv(1)] }],
    });
  }
  return parts;
}

/** Zone de texture d'une face de cube de bloc, en pixels de la texture. */
export function elementFaceRect(element: ModelElement, face: FaceName, size: TextureSize): [number, number, number, number] | null {
  const data = element.faces[face];
  if (!data) return null;
  const [u1, v1, u2, v2] = data.uv ?? defaultUv(element, face);
  const sx = size.width / 16;
  const sy = (size.height / 16) * frameScale(size);
  return [Math.min(u1, u2) * sx, Math.min(v1, v2) * sy, Math.abs(u2 - u1) * sx, Math.abs(v2 - v1) * sy];
}

/** Objet « à plat » : le calque en relief d'un pixel d'épaisseur (face avant, arrière, bords). */
export function spriteParts(
  pixels: { width: number; height: number; data: Uint8ClampedArray },
  texture: string,
  layer: number,
): Part[] {
  const { width: w, height: h, data } = pixels;
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3]! > 0;
  const px = 16 / w;
  const py = 16 / h;
  const z0 = 7.5 - layer * 0.01;
  const z1 = 8.5 + layer * 0.01;
  const quads: Quad[] = [
    // Avant (sud) et arrière (nord), toute l'image : les pixels transparents sont écartés au rendu.
    { positions: [[0, 16, z1], [0, 0, z1], [16, 0, z1], [16, 16, z1]], uvs: [[0, 0], [0, 1], [1, 1], [1, 0]] },
    { positions: [[16, 16, z0], [16, 0, z0], [0, 0, z0], [0, 16, z0]], uvs: [[1, 0], [1, 1], [0, 1], [0, 0]] },
  ];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!opaque(x, y)) continue;
      const x0 = x * px;
      const x1 = x0 + px;
      const top = 16 - y * py;
      const bottom = top - py;
      const uv: UvPoint[] = [
        [(x + 0.5) / w, (y + 0.5) / h],
        [(x + 0.5) / w, (y + 0.5) / h],
        [(x + 0.5) / w, (y + 0.5) / h],
        [(x + 0.5) / w, (y + 0.5) / h],
      ];
      const same = uv as Quad["uvs"];
      if (!opaque(x, y - 1)) quads.push({ positions: [[x0, top, z0], [x0, top, z1], [x1, top, z1], [x1, top, z0]], uvs: same });
      if (!opaque(x, y + 1)) quads.push({ positions: [[x0, bottom, z1], [x0, bottom, z0], [x1, bottom, z0], [x1, bottom, z1]], uvs: same });
      if (!opaque(x - 1, y)) quads.push({ positions: [[x0, top, z0], [x0, bottom, z0], [x0, bottom, z1], [x0, top, z1]], uvs: same });
      if (!opaque(x + 1, y)) quads.push({ positions: [[x1, top, z1], [x1, bottom, z1], [x1, bottom, z0], [x1, top, z0]], uvs: same });
    }
  }
  return [{ id: `layer${layer}`, owner: `layer${layer}`, face: null, texture, quads, shade: true }];
}

// ── Entités ─────────────────────────────────────────────────────────────────

/** Zones d'un cube d'entité dans la texture (UV « en boîte » du jeu), en pixels. */
export function boxUvRects(cube: Pick<EntityCube, "uv" | "size">): Record<FaceName, [number, number, number, number]> {
  const [u, v] = cube.uv;
  const [w, h, d] = cube.size;
  return {
    down: [u + d, v, w, d],
    up: [u + d + w, v, w, d],
    west: [u, v + d, d, h],
    north: [u + d, v + d, w, h],
    east: [u + d + w, v + d, d, h],
    south: [u + 2 * d + w, v + d, w, h],
  };
}

/** Largeur et hauteur de la zone de texture d'un cube d'entité. */
export function boxUvSize(size: Vec3 | [number, number, number]): [number, number] {
  const [w, h, d] = size;
  return [2 * (w + d), d + h];
}

/**
 * Faces d'un cube d'entité, exactement comme `ModelPart.Cuboid` : huit sommets, six faces,
 * UV en boîte, gonflement sans changer la texture, miroir gauche-droite.
 */
export function cubeQuads(cube: EntityCube, texture: TextureSize): Quad[] {
  const [ox, oy, oz] = cube.origin;
  const [w, h, d] = cube.size;
  const g = cube.inflate ?? 0;
  let x = ox - g;
  const y = oy - g;
  const z = oz - g;
  let f = ox + w + g;
  const gy = oy + h + g;
  const hz = oz + d + g;
  if (cube.mirror) [x, f] = [f, x];
  const v0: Vec3 = [x, y, z];
  const v1: Vec3 = [f, y, z];
  const v2: Vec3 = [f, gy, z];
  const v3: Vec3 = [x, gy, z];
  const v4: Vec3 = [x, y, hz];
  const v5: Vec3 = [f, y, hz];
  const v6: Vec3 = [f, gy, hz];
  const v7: Vec3 = [x, gy, hz];
  const [u, v] = cube.uv;
  const j = u;
  const k = u + d;
  const l = u + d + w;
  const m = u + d + w + w;
  const n = u + d + w + d;
  const o = u + d + w + d + w;
  const p = v;
  const q = v + d;
  const r = v + d + h;
  const quad = (vertices: [Vec3, Vec3, Vec3, Vec3], u1: number, v1: number, u2: number, v2: number): Quad => {
    const tw = texture.width;
    const th = texture.height;
    const uvs: Quad["uvs"] = [
      [u2 / tw, v1 / th],
      [u1 / tw, v1 / th],
      [u1 / tw, v2 / th],
      [u2 / tw, v2 / th],
    ];
    if (!cube.mirror) return { positions: vertices, uvs };
    return {
      positions: [vertices[3], vertices[2], vertices[1], vertices[0]],
      uvs: [uvs[3], uvs[2], uvs[1], uvs[0]],
    };
  };
  return [
    quad([v5, v4, v0, v1], k, p, l, q), // down
    quad([v2, v3, v7, v6], l, q, m, p), // up
    quad([v0, v4, v7, v3], j, q, k, r), // west
    quad([v1, v0, v3, v2], k, q, l, r), // north
    quad([v5, v1, v2, v6], l, q, n, r), // east
    quad([v4, v5, v6, v7], n, q, o, r), // south
  ];
}

/** Du modèle d'entité au monde : Y vers le haut, le sol à 24 px sous le haut du modèle, face avant vers +Z. */
export const ENTITY_ROOT = new Matrix4().makeTranslation(0, 24, 0).multiply(new Matrix4().makeScale(1, -1, -1));

/** Matrice de chaque os (pivot puis rotation Z, Y, X comme le jeu), parents compris. */
export function boneMatrices(model: Pick<EntityModel, "bones">, root: Matrix4 = ENTITY_ROOT): Map<string, Matrix4> {
  const byName = new Map(model.bones.map((bone) => [bone.name, bone]));
  const result = new Map<string, Matrix4>();
  const visit = (bone: EntityBone, depth: number): Matrix4 => {
    const known = result.get(bone.name);
    if (known) return known;
    const parent = bone.parent ? byName.get(bone.parent) : undefined;
    const base = parent && depth < 64 ? visit(parent, depth + 1) : root;
    const [rx, ry, rz] = bone.rotation.map((a) => (a * Math.PI) / 180) as Vec3;
    const local = new Matrix4()
      .makeTranslation(...bone.pivot)
      .multiply(new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz, "ZYX")));
    const matrix = base.clone().multiply(local);
    result.set(bone.name, matrix);
    return matrix;
  };
  for (const bone of model.bones) visit(bone, 0);
  return result;
}

export function cubeOwner(bone: string, index: number): string {
  return `c:${bone}:${index}`;
}

/** Morceaux d'un modèle d'entité (un par cube), placés dans le monde. */
export function entityParts(model: EntityModel, texture: string | null, root: Matrix4 = ENTITY_ROOT): Part[] {
  const matrices = boneMatrices(model, root);
  const size = { width: model.textureWidth, height: model.textureHeight };
  const parts: Part[] = [];
  for (const bone of model.bones) {
    const matrix = matrices.get(bone.name)!;
    bone.cubes.forEach((cube, index) => {
      const quads = cubeQuads(cube, size).map((q) => ({
        uvs: q.uvs,
        positions: q.positions.map((p) => apply(matrix, p)) as Quad["positions"],
      }));
      parts.push({ id: cubeOwner(bone.name, index), owner: cubeOwner(bone.name, index), face: null, texture, quads, shade: true });
    });
  }
  return parts;
}

/**
 * Range les zones de texture des cubes sans chevauchement (étagères, les plus grandes d'abord).
 * Renvoie l'UV de chaque cube et la taille de texture nécessaire (largeur gardée si possible).
 */
export function packBoxUv(
  sizes: [number, number, number][],
  width: number,
): { uvs: [number, number][]; width: number; height: number } {
  const boxes = sizes.map((size, index) => {
    const [bw, bh] = boxUvSize(size);
    return { index, w: Math.ceil(bw), h: Math.ceil(bh) };
  });
  const maxWidth = Math.max(width, ...boxes.map((b) => b.w));
  const order = [...boxes].sort((a, b) => b.h - a.h || b.w - a.w);
  const uvs: [number, number][] = sizes.map(() => [0, 0]);
  let x = 0;
  let y = 0;
  let row = 0;
  for (const box of order) {
    if (x + box.w > maxWidth) {
      x = 0;
      y += row;
      row = 0;
    }
    uvs[box.index] = [x, y];
    x += box.w;
    row = Math.max(row, box.h);
  }
  const used = y + row;
  // Hauteur arrondie au multiple de 16 (au moins la largeur / 2, format courant du jeu).
  const height = Math.max(16, Math.ceil(used / 16) * 16);
  const pow = (value: number) => 2 ** Math.ceil(Math.log2(Math.max(1, value)));
  return { uvs, width: pow(maxWidth), height: pow(height) };
}

/** Normale (unitaire) d'un quadrilatère. */
export function quadNormal(quad: Quad): Vec3 {
  const [a, b, c] = quad.positions;
  const ab = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const ac = new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const n = ab.cross(ac).normalize();
  return [n.x, n.y, n.z];
}

/** Ombrage du jeu : dessus 100 %, dessous 50 %, nord et sud 80 %, est et ouest 60 %. */
export function shadeOf(normal: Vec3): number {
  const [x, y, z] = normal;
  return x * x * 0.6 + y * y * (y > 0 ? 1 : 0.5) + z * z * 0.8;
}

/** Première place libre (de haut en bas, de gauche à droite) pour une zone `w × h`. */
export function freeUvSpot(
  taken: [number, number, number, number][],
  w: number,
  h: number,
  texture: TextureSize,
): [number, number] | null {
  const width = Math.ceil(w);
  const height = Math.ceil(h);
  for (let y = 0; y + height <= texture.height; y += 1) {
    for (let x = 0; x + width <= texture.width; x += 1) {
      const clear = taken.every(([tx, ty, tw, th]) => x + width <= tx || tx + tw <= x || y + height <= ty || ty + th <= y);
      if (clear) return [x, y];
    }
  }
  return null;
}

/** Zone totale (rectangle englobant) de la texture d'un cube d'entité. */
export function boxUvBounds(cube: Pick<EntityCube, "uv" | "size">): [number, number, number, number] {
  const [w, h] = boxUvSize(cube.size as [number, number, number]);
  return [cube.uv[0], cube.uv[1], w, h];
}
