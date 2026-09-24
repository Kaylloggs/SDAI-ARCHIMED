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
