/**
 * Retouche au pinceau sur l'image : copie de travail (4096 px de côté au plus), pinceau de
 * couleur et gomme vers la transparence. Enregistrée comme nouvelle version, jamais par-dessus.
 */
import { strokePath } from "./mask-layer";
import type { Point } from "./mask";

export const PAINT_SIDE = 4096;

export class PaintLayer {
  readonly canvas = document.createElement("canvas");
  readonly scale: number;
  private ctx: CanvasRenderingContext2D | null = null;
  dirty = false;

  constructor(
    readonly nodeId: string,
    readonly width: number,
    readonly height: number,
  ) {
    this.scale = Math.min(1, PAINT_SIDE / Math.max(width, height));
    this.canvas.width = Math.max(1, Math.round(width * this.scale));
    this.canvas.height = Math.max(1, Math.round(height * this.scale));
    this.ctx = this.canvas.getContext("2d");
  }

  /** Charge l'image (le protocole d'assets autorise la lecture des pixels depuis la fenêtre). */
  async load(src: string): Promise<void> {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = src;
    await image.decode();
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx?.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
    this.dirty = false;
  }

  /** L'image perd en définition si elle dépasse la taille de travail. */
  get reduced(): boolean {
    return this.scale < 1;
  }

  stroke(points: Point[], size: number, color: string, erase: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    strokePath(ctx, points, size, this.scale);
    ctx.restore();
    this.dirty = true;
  }

  toDataUrl(): string {
    return this.canvas.toDataURL("image/png");
  }
}
