/** Formats d'image : rapports, recadrage centré, agrandissement de la toile. */

/** Formats proposés partout dans le module (recadrage, extension, génération). */
export const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"] as const;

/** Plus grand côté accepté par le backend. */
export const MAX_SIDE = 16384;

export type Rect = { x: number; y: number; width: number; height: number };

/** Ancre de l'image d'origine sur la nouvelle toile : début, milieu ou fin de chaque axe. */
export type Anchor = { x: 0 | 0.5 | 1; y: 0 | 0.5 | 1 };
export const CENTER: Anchor = { x: 0.5, y: 0.5 };

/** « 16:9 » → 1.777… ; `null` si illisible. */
export function parseRatio(ratio: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)\s*$/.exec(ratio);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  return a > 0 && b > 0 ? a / b : null;
}

/** Plus grand rectangle au format `ratio`, centré dans l'image. */
export function cropForRatio(width: number, height: number, ratio: number): Rect {
  if (width / height > ratio) {
    const w = Math.max(1, Math.round(height * ratio));
    return { x: Math.floor((width - w) / 2), y: 0, width: w, height };
  }
  const h = Math.max(1, Math.round(width / ratio));
  return { x: 0, y: Math.floor((height - h) / 2), width, height: h };
}

/**
 * Toile agrandie (jamais réduite) pour atteindre `ratio`, et place de l'original.
 * `null` si l'image a déjà ce format ou si la toile dépasserait la taille maximale.
 */
export function extendToRatio(
  width: number,
  height: number,
  ratio: number,
  anchor: Anchor = CENTER,
): { width: number; height: number; offsetX: number; offsetY: number } | null {
  let w = width;
  let h = height;
  if (width / height < ratio) w = Math.round(height * ratio);
  else h = Math.round(width / ratio);
  if (w === width && h === height) return null;
  if (w > MAX_SIDE || h > MAX_SIDE) return null;
  return {
    width: w,
    height: h,
    offsetX: Math.round((w - width) * anchor.x),
    offsetY: Math.round((h - height) * anchor.y),
  };
}

/** Rectangle remis dans l'image, côtés d'au moins 1 pixel, coordonnées entières. */
export function clampRect(rect: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(Math.round(rect.x), width - 1));
  const y = Math.max(0, Math.min(Math.round(rect.y), height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(rect.width), width - x)),
    height: Math.max(1, Math.min(Math.round(rect.height), height - y)),
  };
}

/** Rectangle entre deux points, contraint à `ratio` si donné (le côté le plus long l'emporte). */
export function rectFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
  ratio: number | null,
): Rect {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (ratio) {
    const w = Math.abs(dx);
    const h = Math.abs(dy);
    if (w / Math.max(h, 1e-6) > ratio) dy = Math.sign(dy || 1) * (w / ratio);
    else dx = Math.sign(dx || 1) * (h * ratio);
  }
  return {
    x: Math.min(a.x, a.x + dx),
    y: Math.min(a.y, a.y + dy),
    width: Math.abs(dx),
    height: Math.abs(dy),
  };
}

/** Taille qui tient dans `max` en gardant les proportions (jamais agrandie). */
export function fitSize(width: number, height: number, max: number): { width: number; height: number } {
  const side = Math.max(width, height);
  if (side <= max) return { width, height };
  const scale = max / side;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Format le plus proche parmi `RATIOS` (« 16:9 »), pour l'étiquette d'une image. */
export function nearestRatio(width: number, height: number, ratios: readonly string[] = RATIOS): string {
  const target = Math.log(width / height);
  let best = ratios[0] ?? "1:1";
  let gap = Infinity;
  for (const ratio of ratios) {
    const value = parseRatio(ratio);
    if (!value) continue;
    const distance = Math.abs(Math.log(value) - target);
    if (distance < gap) {
      gap = distance;
      best = ratio;
    }
  }
  return best;
}
