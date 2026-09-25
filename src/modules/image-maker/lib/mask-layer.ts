/**
 * Sélection dessinée : un canevas hors écran (blanc opaque = choisi, transparent = non)
 * rejoué depuis `MaskHistory`. Plafonné à 2048 px de côté : le backend remet le masque à la
 * taille de l'image, et un masque n'a pas besoin de plus de finesse qu'un trait de pinceau.
 */
import { MaskHistory, type MaskOp, type Point } from "./mask";

const MASK_SIDE = 2048;
const WHITE = "#ffffff";

/** Masque enregistré (niveaux de gris, blanc = zone) → canevas alpha prêt à dessiner. */
async function loadAlphaMask(src: string): Promise<HTMLCanvasElement> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = src;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.data.length; i += 4) {
    const luminance = (data.data[i]! + data.data[i + 1]! + data.data[i + 2]!) / 3;
    data.data[i] = 255;
    data.data[i + 1] = 255;
    data.data[i + 2] = 255;
    data.data[i + 3] = Math.round((luminance * data.data[i + 3]!) / 255);
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export class MaskLayer {
  readonly history = new MaskHistory();
  readonly canvas: HTMLCanvasElement;
  /** Pixels du masque par pixel d'image (≤ 1). */
  readonly scale: number;
  private ctx: CanvasRenderingContext2D | null;
  private images = new Map<string, HTMLCanvasElement>();
  private listeners = new Set<() => void>();
  private empty = true;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.scale = Math.min(1, MASK_SIDE / Math.max(width, height));
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.max(1, Math.round(width * this.scale));
    this.canvas.height = Math.max(1, Math.round(height * this.scale));
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.empty = this.history.obviouslyEmpty || this.measureEmpty();
    this.listeners.forEach((listener) => listener());
  }

  get isEmpty(): boolean {
    return this.empty;
  }

  push(op: MaskOp): void {
    this.history.push(op);
    this.render();
  }

  /** Ajoute un masque enregistré (zone laissée par un déplacement…). */
  async pushImage(src: string, mode: "replace" | "add" = "replace"): Promise<void> {
    if (!this.images.has(src)) this.images.set(src, await loadAlphaMask(src));
    this.push({ kind: "image", mode, src });
  }

  undo(): boolean {
    const done = this.history.undo();
    if (done) this.render();
    return done;
  }

  redo(): boolean {
    const done = this.history.redo();
    if (done) this.render();
    return done;
  }

  clear(): void {
    if (this.history.obviouslyEmpty) return;
    this.push({ kind: "clear" });
  }

  render(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width, height } = this.canvas;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, width, height);
    for (const op of this.history.effective()) this.draw(ctx, op);
    ctx.restore();
    this.changed();
  }

  /** Trait en cours, dessiné sans attendre la fin du geste. */
  drawLive(op: Extract<MaskOp, { kind: "stroke" }>): void {
    if (!this.ctx) return;
    this.ctx.save();
    this.draw(this.ctx, op);
    this.ctx.restore();
    this.listeners.forEach((listener) => listener());
  }

  private draw(ctx: CanvasRenderingContext2D, op: MaskOp): void {
    const s = this.scale;
    const { width, height } = this.canvas;
    ctx.fillStyle = WHITE;
    ctx.strokeStyle = WHITE;
    if (op.kind === "clear") {
      ctx.clearRect(0, 0, width, height);
      return;
    }
    if (op.kind === "all") {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillRect(0, 0, width, height);
      return;
    }
    if (op.kind === "invert") {
      ctx.globalCompositeOperation = "xor";
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
      return;
    }
    if (op.mode === "replace") ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = op.mode === "subtract" ? "destination-out" : "source-over";
    switch (op.kind) {
      case "rect":
        ctx.fillRect(op.x * s, op.y * s, op.width * s, op.height * s);
        break;
      case "ellipse":
        ctx.beginPath();
        ctx.ellipse(
          (op.x + op.width / 2) * s,
          (op.y + op.height / 2) * s,
          Math.max(0.5, (op.width / 2) * s),
          Math.max(0.5, (op.height / 2) * s),
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        break;
      case "poly":
        if (op.points.length < 3) break;
        ctx.beginPath();
        op.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * s, p.y * s) : ctx.lineTo(p.x * s, p.y * s)));
        ctx.closePath();
        ctx.fill();
        break;
      case "stroke":
        strokePath(ctx, op.points, op.size, s);
        break;
      case "image": {
        const source = this.images.get(op.src);
        if (source) ctx.drawImage(source, 0, 0, width, height);
        break;
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private measureEmpty(): boolean {
    if (!this.ctx) return true;
    const { data } = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    for (let i = 3; i < data.length; i += 16) if (data[i]! > 16) return false;
    return true;
  }

  /** Rectangle englobant de la sélection, en pixels d'image. */
  bounds(): { x: number; y: number; width: number; height: number } | null {
    if (!this.ctx || this.empty) return null;
    const { width, height } = this.canvas;
    const { data } = this.ctx.getImageData(0, 0, width, height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3]! > 16) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const s = this.scale;
    return {
      x: Math.floor(minX / s),
      y: Math.floor(minY / s),
      width: Math.min(this.width, Math.ceil((maxX - minX + 1) / s)),
      height: Math.min(this.height, Math.ceil((maxY - minY + 1) / s)),
    };
  }

  /** PNG du masque (blanc opaque = zone choisie), tel que l'attend le backend. */
  toDataUrl(): string {
    return this.canvas.toDataURL("image/png");
  }
}

export function strokePath(ctx: CanvasRenderingContext2D, points: Point[], size: number, scale: number): void {
  if (points.length === 0) return;
  ctx.lineWidth = Math.max(1, size * scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (points.length === 1) {
    const p = points[0]!;
    ctx.beginPath();
    ctx.arc(p.x * scale, p.y * scale, Math.max(0.5, (size * scale) / 2), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * scale, p.y * scale) : ctx.lineTo(p.x * scale, p.y * scale)));
  ctx.stroke();
}
