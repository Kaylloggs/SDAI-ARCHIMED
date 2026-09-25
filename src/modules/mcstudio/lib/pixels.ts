import type { PixelData } from "@/core/ipc/bindings/PixelData";

/** Couleur RVBA, 0 à 255 par canal. */
export type Rgba = [number, number, number, number];

/** Pixels d'une texture, ligne par ligne (4 octets par pixel). */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

export const TRANSPARENT: Rgba = [0, 0, 0, 0];

export function decodePixels(source: PixelData): Pixels {
  const binary = atob(source.rgba);
  const data = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
  return { width: source.width, height: source.height, data };
}

export function encodePixels(pixels: Pixels): PixelData {
  // Par tranches : `String.fromCharCode(...grand tableau)` dépasse la pile.
  let binary = "";
  for (let i = 0; i < pixels.data.length; i += 0x8000) {
    binary += String.fromCharCode(...pixels.data.subarray(i, i + 0x8000));
  }
  return { width: pixels.width, height: pixels.height, rgba: btoa(binary) };
}

export function clonePixels(pixels: Pixels): Pixels {
  return { ...pixels, data: new Uint8ClampedArray(pixels.data) };
}

export function inside(pixels: Pixels, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < pixels.width && y < pixels.height;
}

export function getPixel(pixels: Pixels, x: number, y: number): Rgba {
  const i = (y * pixels.width + x) * 4;
  const d = pixels.data;
  return [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!];
}

export function sameColor(a: Rgba, b: Rgba): boolean {
  // Deux pixels transparents se valent, quelle que soit leur couleur cachée.
  if (a[3] === 0 && b[3] === 0) return true;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Peint un pixel ; `false` s'il avait déjà cette couleur (ou hors de l'image). */
export function setPixel(pixels: Pixels, x: number, y: number, color: Rgba): boolean {
  if (!inside(pixels, x, y) || sameColor(getPixel(pixels, x, y), color)) return false;
  pixels.data.set(color, (y * pixels.width + x) * 4);
  return true;
}

/** Tailles de pinceau proposées (pixels de côté). */
export const BRUSH_SIZES = [1, 2, 3, 4, 6, 8, 12, 16] as const;

/**
 * Pixels couverts par un pinceau de `size` pixels centré sur `(x, y)` : carré jusqu'à 3,
 * rond au-delà (comme les pinceaux des éditeurs de pixel art).
 */
export function brushCells(x: number, y: number, size: number): [number, number][] {
  const side = Math.max(1, Math.round(size));
  const start = -Math.floor((side - 1) / 2);
  const radius = side / 2;
  const cells: [number, number][] = [];
  for (let dy = 0; dy < side; dy += 1) {
    for (let dx = 0; dx < side; dx += 1) {
      const cx = dx + 0.5 - radius;
      const cy = dy + 0.5 - radius;
      if (side > 3 && cx * cx + cy * cy > radius * radius) continue;
      cells.push([x + start + dx, y + start + dy]);
    }
  }
  return cells;
}

/** Applique le pinceau en `(x, y)` ; `true` si au moins un pixel a changé. */
export function stamp(pixels: Pixels, x: number, y: number, size: number, color: Rgba): boolean {
  let changed = false;
  for (const [px, py] of brushCells(x, y, size)) changed = setPixel(pixels, px, py, color) || changed;
  return changed;
}

/** Remplit la zone de même couleur (voisins haut, bas, gauche, droite) ; pixels changés. */
export function floodFill(pixels: Pixels, x: number, y: number, color: Rgba): number {
  if (!inside(pixels, x, y)) return 0;
  const target = getPixel(pixels, x, y);
  if (sameColor(target, color)) return 0;
  let changed = 0;
  const stack: [number, number][] = [[x, y]];
  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!;
    if (!inside(pixels, cx, cy) || !sameColor(getPixel(pixels, cx, cy), target)) continue;
    pixels.data.set(color, (cy * pixels.width + cx) * 4);
    changed += 1;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return changed;
}

/** Pixels d'un segment (Bresenham) : un trait rapide reste continu. */
export function line(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const points: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let [x, y] = [x0, y0];
  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) break;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
  return points;
}

/** Couleurs visibles de la texture, les plus présentes d'abord. */
export function paletteOf(pixels: Pixels, limit = 32): Rgba[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (pixels.data[i + 3] === 0) continue;
    const key = ((pixels.data[i]! << 24) | (pixels.data[i + 1]! << 16) | (pixels.data[i + 2]! << 8) | pixels.data[i + 3]!) >>> 0;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([key]) => [(key >>> 24) & 255, (key >>> 16) & 255, (key >>> 8) & 255, key & 255]);
}

export function toHex(color: Rgba): string {
  return `#${color
    .slice(0, 3)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** `#rgb` ou `#rrggbb` (le `#` est facultatif) ; `null` si illisible. */
export function fromHex(text: string): Rgba | null {
  const hex = text.trim().replace(/^#/, "");
  const full = /^[0-9a-f]{3}$/i.test(hex) ? [...hex].map((c) => c + c).join("") : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), 255];
}

/** Même teinte, plus claire (`amount` > 0) ou plus sombre (`amount` < 0), en proportion. */
export function shade(color: Rgba, amount: number): Rgba {
  const mix = (v: number) =>
    Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  return [mix(color[0]), mix(color[1]), mix(color[2]), color[3]];
}

/** Image miroir : le pixel `(x, y)` et son symétrique gauche-droite. */
export function mirrored(pixels: Pixels, x: number): number {
  return pixels.width - 1 - x;
}

/** Même contenu, pixels identiques ? */
export function samePixels(a: Pixels, b: Pixels): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i += 1) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/** Nouvelle taille : les pixels communs sont gardés, le reste est transparent. */
export function resizePixels(pixels: Pixels, width: number, height: number): Pixels {
  const out: Pixels = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (let y = 0; y < Math.min(height, pixels.height); y += 1) {
    const row = pixels.data.subarray(y * pixels.width * 4, (y * pixels.width + Math.min(width, pixels.width)) * 4);
    out.data.set(row, y * width * 4);
  }
  return out;
}

/** Image vide (transparente). */
export function blankPixels(width: number, height: number): Pixels {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Remplit un rectangle (bornes comprises dans l'image). */
export function fillRect(pixels: Pixels, x: number, y: number, w: number, h: number, color: Rgba) {
  for (let py = Math.max(0, Math.floor(y)); py < Math.min(pixels.height, Math.ceil(y + h)); py += 1) {
    for (let px = Math.max(0, Math.floor(x)); px < Math.min(pixels.width, Math.ceil(x + w)); px += 1) {
      pixels.data.set(color, (py * pixels.width + px) * 4);
    }
  }
}

/** Image unie d'une couleur. */
export function solidPixels(width: number, height: number, color: Rgba): Pixels {
  const out = blankPixels(width, height);
  fillRect(out, 0, 0, width, height, color);
  return out;
}

/** Recopie `source` étirée (au plus proche) dans le rectangle `x, y, w, h` de `target`. */
export function drawScaled(target: Pixels, source: Pixels, x: number, y: number, w: number, h: number) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const width = Math.ceil(x + w) - Math.floor(x);
  const height = Math.ceil(y + h) - Math.floor(y);
  if (width <= 0 || height <= 0 || source.width === 0 || source.height === 0) return;
  for (let py = y0; py < Math.min(target.height, Math.floor(y) + height); py += 1) {
    const sy = Math.min(source.height - 1, Math.floor(((py - Math.floor(y) + 0.5) / height) * source.height));
    for (let px = x0; px < Math.min(target.width, Math.floor(x) + width); px += 1) {
      const sx = Math.min(source.width - 1, Math.floor(((px - Math.floor(x) + 0.5) / width) * source.width));
      const from = (sy * source.width + sx) * 4;
      target.data.set(source.data.subarray(from, from + 4), (py * target.width + px) * 4);
    }
  }
}
