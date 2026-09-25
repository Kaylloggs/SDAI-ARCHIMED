import type { EntityCube } from "@/core/ipc/bindings/EntityCube";
import { boxUvSize, cubeQuads, defaultUv, freeUvSpot, type Quad } from "./geometry";
import { FACES, type FaceName, type ModelElement, type ModelFace, type Uv, type Vec3 } from "./types";

/**
 * Formes de l'atelier 3D. Le jeu ne connaît que des cubes alignés sur les axes : un cylindre,
 * une sphère ou un cône sont faits de cubes (voxels regroupés en blocs aussi grands que
 * possible, comme les générateurs de formes de Blockbench). « Creuser » retire une boîte des
 * cubes qu'elle traverse en les recoupant en morceaux.
 */

export type ShapeKind = "cube" | "cylinder" | "sphere" | "cone";
export type Axis = "x" | "y" | "z";

export type ShapeParams = {
  kind: ShapeKind;
  /** Cube : taille X, Y, Z. Cylindre et cône : diamètre, longueur (le long de l'axe), inutilisé. Sphère : diamètre. */
  size: Vec3;
  /** Axe du cylindre et du cône (la pointe du cône vers +axe). */
  axis: Axis;
  /** Taille d'un voxel : 1 px par défaut, 0,5 pour des courbes plus fines. */
  step: number;
  /** Épaisseur de la paroi d'une forme creuse ; 0 : pleine. */
  wall: number;
};

export type Aabb = { from: Vec3; to: Vec3 };

export const SHAPE_LABEL: Record<ShapeKind, string> = {
  cube: "Cube",
  cylinder: "Cylindre",
  sphere: "Sphère",
  cone: "Cône",
};

/** Au-delà, le modèle devient lourd pour le jeu : l'interface prévient. */
export const MANY_CUBES = 160;

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Dimensions dans le repère de la forme : largeur A, profondeur B, longueur H (le long de l'axe). */
function frame(params: ShapeParams): [number, number, number] {
  const [a, b] = params.size;
  switch (params.kind) {
    case "cube":
      return [params.size[0], params.size[2], params.size[1]];
    case "sphere":
      return [a, a, a];
    default:
      return [a, a, b];
  }
}

/** Taille X, Y, Z de la boîte englobante. */
export function shapeBounds(params: ShapeParams): Vec3 {
  const [a, b, h] = frame(params);
  const axis = params.kind === "cube" || params.kind === "sphere" ? "y" : params.axis;
  return toWorld([a, b, h], axis);
}

/** Repère de la forme (a, b, h) → X, Y, Z. */
function toWorld([a, b, h]: Vec3, axis: Axis): Vec3 {
  if (axis === "x") return [h, a, b];
  if (axis === "z") return [a, b, h];
  return [a, h, b];
}

/** Le voxel (centre relatif au milieu de la base, h depuis la base) est-il plein ? */
function occupied(params: ShapeParams, [A, B, H]: Vec3, ca: number, cb: number, ch: number): boolean {
  const wall = Math.max(0, params.wall);
  switch (params.kind) {
    case "cube": {
      if (wall <= 0) return true;
      const inner = Math.abs(ca) < A / 2 - wall && Math.abs(cb) < B / 2 - wall && ch > wall && ch < H - wall;
      return !inner;
    }
    case "cylinder": {
      const r = A / 2;
      const d2 = ca * ca + cb * cb;
      if (d2 > r * r) return false;
      return wall <= 0 || d2 > Math.max(0, r - wall) ** 2;
    }
    case "cone": {
      const r = (A / 2) * (1 - ch / H);
      const d2 = ca * ca + cb * cb;
      if (d2 > r * r) return false;
      return wall <= 0 || d2 > Math.max(0, r - wall) ** 2;
    }
    case "sphere": {
      const r = A / 2;
      const dh = ch - H / 2;
      const d2 = ca * ca + cb * cb + dh * dh;
      if (d2 > r * r) return false;
      return wall <= 0 || d2 > Math.max(0, r - wall) ** 2;
    }
  }
}

/**
 * Cubes d'une forme, centrés sur (0, 0, 0) (milieu de la boîte englobante). Les voxels pleins
 * sont regroupés : d'abord le long de l'axe (un cylindre = quelques longs cubes), puis en
 * largeur et en profondeur.
 */
export function shapeBoxes(params: ShapeParams): Aabb[] {
  const dims = frame(params);
  const [A, B, H] = dims;
  if (params.kind === "cube" && params.wall <= 0) {
    const size = toWorld(dims, "y");
    return [{ from: size.map((v) => round(-v / 2)) as Vec3, to: size.map((v) => round(v / 2)) as Vec3 }];
  }
  const step = Math.max(0.25, params.step);
  const nA = Math.max(1, Math.round(A / step));
  const nB = Math.max(1, Math.round(B / step));
  const nH = Math.max(1, Math.round(H / step));
  const sa = A / nA;
  const sb = B / nB;
  const sh = H / nH;
  const index = (i: number, j: number, k: number) => (k * nB + j) * nA + i;
  const full = new Uint8Array(nA * nB * nH);
  for (let k = 0; k < nH; k += 1) {
    for (let j = 0; j < nB; j += 1) {
      for (let i = 0; i < nA; i += 1) {
        const ca = -A / 2 + (i + 0.5) * sa;
        const cb = -B / 2 + (j + 0.5) * sb;
        const ch = (k + 0.5) * sh;
        if (occupied(params, dims, ca, cb, ch)) full[index(i, j, k)] = 1;
      }
    }
  }
  const taken = new Uint8Array(full.length);
  const free = (i: number, j: number, k: number) => full[index(i, j, k)] === 1 && taken[index(i, j, k)] === 0;
  const axis = params.kind === "cube" || params.kind === "sphere" ? "y" : params.axis;
  const boxes: Aabb[] = [];
  for (let j = 0; j < nB; j += 1) {
    for (let i = 0; i < nA; i += 1) {
      for (let k = 0; k < nH; k += 1) {
        if (!free(i, j, k)) continue;
        // Le long de l'axe, puis en largeur (A), puis en profondeur (B).
        let k1 = k + 1;
        while (k1 < nH && free(i, j, k1)) k1 += 1;
        let i1 = i + 1;
        while (i1 < nA && range(k, k1).every((kk) => free(i1, j, kk))) i1 += 1;
        let j1 = j + 1;
        while (j1 < nB && range(i, i1).every((ii) => range(k, k1).every((kk) => free(ii, j1, kk)))) j1 += 1;
        for (let kk = k; kk < k1; kk += 1) for (let jj = j; jj < j1; jj += 1) for (let ii = i; ii < i1; ii += 1) taken[index(ii, jj, kk)] = 1;
        const from = toWorld([-A / 2 + i * sa, -B / 2 + j * sb, k * sh - H / 2], axis);
        const to = toWorld([-A / 2 + i1 * sa, -B / 2 + j1 * sb, k1 * sh - H / 2], axis);
        boxes.push({ from: from.map(round) as Vec3, to: to.map(round) as Vec3 });
      }
    }
  }
  return boxes;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}

/** Boîte décalée. */
export function offsetBox(box: Aabb, by: Vec3): Aabb {
  return { from: box.from.map((v, i) => round(v + by[i]!)) as Vec3, to: box.to.map((v, i) => round(v + by[i]!)) as Vec3 };
}

/** Boîte englobante d'une liste de boîtes. */
export function boundsOf(boxes: Aabb[]): Aabb | null {
  if (boxes.length === 0) return null;
  const from = [Infinity, Infinity, Infinity] as Vec3;
  const to = [-Infinity, -Infinity, -Infinity] as Vec3;
  for (const box of boxes) {
    for (let i = 0; i < 3; i += 1) {
      from[i] = Math.min(from[i]!, box.from[i]!, box.to[i]!);
      to[i] = Math.max(to[i]!, box.from[i]!, box.to[i]!);
    }
  }
  return { from, to };
}

/**
 * `box` moins `hole` : jusqu'à six morceaux (tranches en X, puis en Y, puis en Z) ; `null`
 * si la boîte n'est pas touchée.
 */
export function subtractBox(box: Aabb, hole: Aabb): Aabb[] | null {
  const lo = box.from.map((v, i) => Math.max(v, Math.min(hole.from[i]!, hole.to[i]!))) as Vec3;
  const hi = box.to.map((v, i) => Math.min(v, Math.max(hole.from[i]!, hole.to[i]!))) as Vec3;
  if (lo.some((v, i) => v >= hi[i]! - 1e-9)) return null;
  const [bx, by, bz] = box.from;
  const [tx, ty, tz] = box.to;
  const [lx, ly, lz] = lo;
  const [hx, hy, hz] = hi;
  const pieces: Aabb[] = [];
  const add = (from: Vec3, to: Vec3) => {
    if (from.every((v, i) => to[i]! - v > 1e-9)) pieces.push({ from: from.map(round) as Vec3, to: to.map(round) as Vec3 });
  };
  add([bx, by, bz], [lx, ty, tz]);
  add([hx, by, bz], [tx, ty, tz]);
  add([lx, by, bz], [hx, ly, tz]);
  add([lx, hy, bz], [hx, ty, tz]);
  add([lx, ly, bz], [hx, hy, lz]);
  add([lx, ly, hz], [hx, hy, tz]);
  return pieces;
}

// ── Blocs et objets ─────────────────────────────────────────────────────────

/** Cube de modèle de bloc tourné : on ne le recoupe pas (sa boîte n'est plus alignée). */
export function isRotated(element: ModelElement): boolean {
  return Boolean(element.rotation && element.rotation.angle);
}

/** Même face d'un morceau : UV imposés recalculés pour garder la même image au même endroit. */
function pieceFace(original: ModelElement, piece: Aabb, name: FaceName, face: ModelFace): ModelFace {
  const copy: ModelFace = { ...face };
  if (!face.uv || face.rotation) return copy;
  const [d1, e1, d2, e2] = defaultUv(original, name);
  const [p1, q1, p2, q2] = defaultUv(piece, name);
  const [u1, v1, u2, v2] = face.uv;
  const mapU = (d: number) => (d2 === d1 ? u1 : u1 + ((d - d1) * (u2 - u1)) / (d2 - d1));
  const mapV = (e: number) => (e2 === e1 ? v1 : v1 + ((e - e1) * (v2 - v1)) / (e2 - e1));
  copy.uv = [mapU(p1), mapV(q1), mapU(p2), mapV(q2)].map(round) as Uv;
  return copy;
}

/** La face `name` du morceau est-elle sur la face du cube d'origine (et non une coupe) ? */
function onOriginalFace(original: Aabb, piece: Aabb, name: FaceName): boolean {
  switch (name) {
    case "west":
      return piece.from[0] === original.from[0];
    case "east":
      return piece.to[0] === original.to[0];
    case "down":
      return piece.from[1] === original.from[1];
    case "up":
      return piece.to[1] === original.to[1];
    case "north":
      return piece.from[2] === original.from[2];
    case "south":
      return piece.to[2] === original.to[2];
  }
}

/**
 * Creuse `hole` dans un cube de bloc : ses morceaux, faces et UV gardés (les coupes prennent
 * la texture de la face de même orientation) ; `null` si le cube n'est pas touché ou tourné.
 */
export function carveElement(element: ModelElement, hole: Aabb): ModelElement[] | null {
  if (isRotated(element)) return null;
  const pieces = subtractBox(element, hole);
  if (!pieces) return null;
  const fallback = FACES.map((f) => element.faces[f]).find(Boolean);
  return pieces.map((piece, index) => {
    const faces: ModelElement["faces"] = {};
    for (const name of FACES) {
      const face = element.faces[name];
      if (onOriginalFace(element, piece, name)) {
        if (face) faces[name] = pieceFace(element, piece, name, face);
      } else {
        const source = face ?? fallback;
        if (source) faces[name] = { texture: source.texture, ...(source.tintindex !== undefined ? { tintindex: source.tintindex } : {}) };
      }
    }
    const { from: _from, to: _to, faces: _faces, name, ...rest } = element;
    return { ...rest, name: `${name ?? "cube"}_${index + 1}`, from: piece.from, to: piece.to, faces };
  });
}

/** Cube de bloc aux faces données (une texture par face, UV automatiques). */
export function boxElement(box: Aabb, name: string, textureOf: (face: FaceName) => string): ModelElement {
  const faces: ModelElement["faces"] = {};
  for (const face of FACES) faces[face] = { texture: textureOf(face) };
  return { name, from: box.from, to: box.to, faces };
}

type Sprite = { width: number; height: number; data: Uint8ClampedArray };

/**
 * Objet à plat → cubes d'un pixel d'épaisseur (comme le relief du jeu), modifiables : les
 * rangées de pixels opaques sont regroupées en rectangles.
 */
export function spriteElements(sprite: Sprite, texture: string): ModelElement[] {
  const { width: w, height: h, data } = sprite;
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3]! > 0;
  const taken = new Uint8Array(w * h);
  const su = 16 / w;
  const sv = 16 / h;
  const elements: ModelElement[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!opaque(x, y) || taken[y * w + x]) continue;
      let x1 = x + 1;
      while (x1 < w && opaque(x1, y) && !taken[y * w + x1]) x1 += 1;
      let y1 = y + 1;
      while (y1 < h && range(x, x1).every((xx) => opaque(xx, y1) && !taken[y1 * w + xx])) y1 += 1;
      for (let yy = y; yy < y1; yy += 1) for (let xx = x; xx < x1; xx += 1) taken[yy * w + xx] = 1;
      const u0 = round(x * su);
      const u1 = round(x1 * su);
      const v0 = round(y * sv);
      const v1 = round(y1 * sv);
      const faces: ModelElement["faces"] = {
        south: { uv: [u0, v0, u1, v1], texture },
        north: { uv: [u1, v0, u0, v1], texture },
      };
      // Bords seulement là où un pixel transparent les laisse voir.
      if (range(x, x1).some((xx) => !opaque(xx, y - 1))) faces.up = { uv: [u0, v0, u1, round(v0 + sv)], texture };
      if (range(x, x1).some((xx) => !opaque(xx, y1))) faces.down = { uv: [u0, round(v1 - sv), u1, v1], texture };
      if (range(y, y1).some((yy) => !opaque(x - 1, yy))) faces.west = { uv: [u0, v0, round(u0 + su), v1], texture };
      if (range(y, y1).some((yy) => !opaque(x1, yy))) faces.east = { uv: [round(u1 - su), v0, u1, v1], texture };
      elements.push({
        name: `pixel_${elements.length + 1}`,
        from: [u0, round(16 - v1), 7.5],
        to: [u1, round(16 - v0), 8.5],
        faces,
      });
    }
  }
  return elements;
}

/** Réglages d'affichage de `item/generated` et `item/handheld` (en main, au sol, sur la tête…). */
export function itemDisplay(handheld: boolean): Record<string, unknown> {
  return {
    ground: { rotation: [0, 0, 0], translation: [0, 2, 0], scale: [0.5, 0.5, 0.5] },
    head: { rotation: [0, 180, 0], translation: [0, 13, 7], scale: [1, 1, 1] },
    thirdperson_righthand: handheld
      ? { rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85] }
      : { rotation: [0, 0, 0], translation: [0, 3, 1], scale: [0.55, 0.55, 0.55] },
    thirdperson_lefthand: handheld
      ? { rotation: [0, 90, -55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85] }
      : { rotation: [0, 0, 0], translation: [0, 3, 1], scale: [0.55, 0.55, 0.55] },
    firstperson_righthand: { rotation: [0, -90, 25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68] },
    firstperson_lefthand: { rotation: [0, 90, -25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68] },
    fixed: { rotation: [0, 180, 0], scale: [1, 1, 1] },
  };
}

// ── Entités ─────────────────────────────────────────────────────────────────

/** Cube d'entité → boîte (espace de son os). */
export function cubeBox(cube: Pick<EntityCube, "origin" | "size">): Aabb {
  return { from: cube.origin, to: cube.origin.map((v, i) => round(v + cube.size[i]!)) as Vec3 };
}

/** Morceaux d'un cube d'entité creusé ; `null` s'il n'est pas touché. */
export function carveCube(cube: EntityCube, hole: Aabb): EntityCube[] | null {
  const pieces = subtractBox(cubeBox(cube), hole);
  if (!pieces) return null;
  return pieces.map((piece) => ({
    ...cube,
    origin: piece.from,
    size: piece.to.map((v, i) => round(v - piece.from[i]!)) as Vec3,
  }));
}

type Raster = { width: number; height: number; data: Uint8ClampedArray };

/** Point du quadrilatère (rectangle) pour des coordonnées de texture données. */
function pointAt(quad: Quad, u: number, v: number): Vec3 | null {
  const [p0, p1, , p3] = quad.positions;
  const [t0, t1, , t3] = quad.uvs;
  // Deux côtés alignés sur la texture : l'un porte u, l'autre v.
  const du1 = t1[0] - t0[0];
  const dv1 = t1[1] - t0[1];
  const du3 = t3[0] - t0[0];
  const dv3 = t3[1] - t0[1];
  const det = du1 * dv3 - du3 * dv1;
  if (Math.abs(det) < 1e-9) return null;
  const s = ((u - t0[0]) * dv3 - (v - t0[1]) * du3) / det;
  const t = ((v - t0[1]) * du1 - (u - t0[0]) * dv1) / det;
  return [0, 1, 2].map((i) => p0[i]! + s * (p1[i]! - p0[i]!) + t * (p3[i]! - p0[i]!)) as Vec3;
}

/** Coordonnées de texture d'un point projeté sur le quadrilatère (bords inclus). */
function uvAt(quad: Quad, point: Vec3): [number, number] {
  const [p0, p1, , p3] = quad.positions;
  const [t0, t1, , t3] = quad.uvs;
  const along = (a: Vec3, b: Vec3) => {
    const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = e[0]! ** 2 + e[1]! ** 2 + e[2]! ** 2;
    if (len === 0) return 0;
    const t = ((point[0] - a[0]) * e[0]! + (point[1] - a[1]) * e[1]! + (point[2] - a[2]) * e[2]!) / len;
    return Math.min(1, Math.max(0, t));
  };
  const s = along(p0, p1);
  const t = along(p0, p3);
  return [t0[0] + s * (t1[0] - t0[0]) + t * (t3[0] - t0[0]), t0[1] + s * (t1[1] - t0[1]) + t * (t3[1] - t0[1])];
}

/**
 * Peint la zone de texture de `target` d'après celle de `source` (même os) : chaque pixel
 * prend la couleur du point correspondant de la face de même orientation du cube d'origine.
 * Les faces de coupe prolongent ainsi la peau de l'original. `origin` : image lue (par défaut
 * une copie de `pixels` avant la peinture).
 */
export function copyCubeTexture(pixels: Raster, source: EntityCube, target: EntityCube, origin?: Raster): void {
  const unit = { width: 1, height: 1 };
  const from = cubeQuads({ ...source, inflate: 0 }, unit);
  const to = cubeQuads({ ...target, inflate: 0 }, unit);
  const before = origin && origin.width === pixels.width && origin.height === pixels.height ? origin.data : pixels.data.slice();
  const { width, height } = pixels;
  to.forEach((quad, face) => {
    const src = from[face]!;
    const us = quad.uvs.map((uv) => uv[0]);
    const vs = quad.uvs.map((uv) => uv[1]);
    const x0 = Math.floor(Math.min(...us));
    const x1 = Math.ceil(Math.max(...us));
    const y0 = Math.floor(Math.min(...vs));
    const y1 = Math.ceil(Math.max(...vs));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const point = pointAt(quad, x + 0.5, y + 0.5);
        if (!point) continue;
        const [u, v] = uvAt(src, point);
        const sx = Math.min(width - 1, Math.max(0, Math.floor(u)));
        const sy = Math.min(height - 1, Math.max(0, Math.floor(v)));
        const from4 = (sy * width + sx) * 4;
        const to4 = (y * width + x) * 4;
        pixels.data.set(before.subarray(from4, from4 + 4), to4);
      }
    }
  });
}

/**
 * Zones de texture (UV en boîte) pour de nouveaux cubes d'entité, sans chevaucher `taken` :
 * la texture s'agrandit (hauteur, puis largeur, jusqu'à 1024) quand la place manque.
 */
export function allocateBoxUv(
  taken: [number, number, number, number][],
  sizes: Vec3[],
  texture: { width: number; height: number },
): { uvs: [number, number][]; width: number; height: number } {
  let { width, height } = texture;
  const used = [...taken];
  const uvs: [number, number][] = [];
  for (const size of sizes) {
    const [w, h] = boxUvSize(size);
    let spot = freeUvSpot(used, w, h, { width, height });
    while (!spot && (height < 1024 || width < 1024)) {
      if (Math.ceil(w) > width) width = Math.min(1024, width * 2);
      else if (height < 1024) height = Math.min(1024, height * 2);
      else width = Math.min(1024, width * 2);
      spot = freeUvSpot(used, w, h, { width, height });
    }
    const uv = spot ?? [0, 0];
    uvs.push(uv);
    used.push([uv[0], uv[1], Math.ceil(w), Math.ceil(h)]);
  }
  return { uvs, width, height };
}
