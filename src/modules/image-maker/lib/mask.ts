/**
 * Sélection (masque) décrite par une liste d'opérations vectorielles : rejouées pour
 * dessiner, légères à garder pour annuler et rétablir, quelle que soit la taille de l'image.
 */

export type Point = { x: number; y: number };
export type MaskMode = "replace" | "add" | "subtract";

export type MaskOp =
  | { kind: "rect" | "ellipse"; mode: MaskMode; x: number; y: number; width: number; height: number }
  | { kind: "poly"; mode: MaskMode; points: Point[] }
  | { kind: "stroke"; mode: "add" | "subtract"; points: Point[]; size: number }
  /** Masque enregistré (zone laissée par un déplacement…), en coordonnées de l'image. */
  | { kind: "image"; mode: MaskMode; src: string }
  | { kind: "invert" }
  | { kind: "clear" }
  /** Toute l'image. */
  | { kind: "all" };

/** Mode d'une forme selon les touches : Maj ajoute, Alt retire, sinon remplace. */
export function shapeMode(shift: boolean, alt: boolean): MaskMode {
  if (alt) return "subtract";
  if (shift) return "add";
  return "replace";
}

export class MaskHistory {
  private ops: MaskOp[] = [];
  private undone: MaskOp[] = [];

  get list(): readonly MaskOp[] {
    return this.ops;
  }

  push(op: MaskOp): void {
    this.ops.push(op);
    this.undone = [];
  }

  undo(): boolean {
    const op = this.ops.pop();
    if (!op) return false;
    this.undone.push(op);
    return true;
  }

  redo(): boolean {
    const op = this.undone.pop();
    if (!op) return false;
    this.ops.push(op);
    return true;
  }

  reset(): void {
    this.ops = [];
    this.undone = [];
  }

  get canUndo(): boolean {
    return this.ops.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /**
   * Opérations utiles au rendu : tout ce qui précède le dernier effacement ou le dernier
   * « remplacer » n'a plus d'effet.
   */
  effective(): MaskOp[] {
    let start = 0;
    this.ops.forEach((op, index) => {
      if (op.kind === "clear" || op.kind === "all" || ("mode" in op && op.mode === "replace")) start = index;
    });
    const tail = this.ops.slice(start);
    return tail[0]?.kind === "clear" ? tail.slice(1) : tail;
  }

  /** Sélection vide par construction (sans rien dessiner). */
  get obviouslyEmpty(): boolean {
    const ops = this.effective();
    return ops.length === 0 || ops.every((op) => "mode" in op && op.mode === "subtract");
  }
}

/** Points trop proches retirés (un tracé à main levée en produit des centaines). */
export function simplify(points: Point[], minDistance: number): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out.at(-1);
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= minDistance) out.push(point);
  }
  const final = points.at(-1);
  if (final && out.at(-1) !== final) out.push(final);
  return out;
}
