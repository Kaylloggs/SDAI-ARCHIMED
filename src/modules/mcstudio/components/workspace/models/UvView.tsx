import { useEffect, useRef } from "react";
import { cn } from "@/core/lib/cn";
import type { Pixels } from "../../../lib/pixels";
import type { FaceName } from "../../../lib/models/types";
import type { PaintPhase } from "./Viewport";

export type UvRect = { owner: string; face: FaceName | null; rect: [number, number, number, number] };

/**
 * La texture à plat avec les zones de chaque face (UV) : celles du cube choisi en couleur
 * d'accent. On y peint comme sur le modèle ; un clic choisit le cube d'une zone.
 */
export function UvView({
  pixels,
  texture,
  version,
  rects,
  selected,
  mode,
  onPaint,
  onPick,
  size = 256,
}: {
  pixels: Pixels | undefined;
  texture: string;
  version: number;
  rects: UvRect[];
  selected: string | null;
  mode: "select" | "paint";
  onPaint: (hit: { texture: string; x: number; y: number }, phase: PaintPhase) => void;
  onPick: (owner: string, face: FaceName | null) => void;
  size?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const down = useRef(false);
  const width = pixels?.width ?? 16;
  const height = pixels?.height ?? 16;
  const scale = Math.max(1, Math.floor(size / Math.max(width, height)));
  const shownWidth = width * scale;
  const shownHeight = height * scale;

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    context.clearRect(0, 0, element.width, element.height);
    // Damier sous les pixels transparents.
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        context.fillStyle = (x + y) % 2 === 0 ? "rgba(128,128,128,0.25)" : "rgba(128,128,128,0.12)";
        context.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    if (pixels) {
      const source = document.createElement("canvas");
      source.width = pixels.width;
      source.height = pixels.height;
      source.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
      context.imageSmoothingEnabled = false;
      context.drawImage(source, 0, 0, shownWidth, shownHeight);
    }
    const styles = getComputedStyle(element);
    const accent = styles.getPropertyValue("--color-accent").trim() || "orange";
    const faint = styles.getPropertyValue("--color-text-subtle").trim() || "gray";
    for (const pass of [false, true]) {
      for (const { owner, rect } of rects) {
        if ((owner === selected) !== pass) continue;
        context.strokeStyle = pass ? accent : faint;
        context.globalAlpha = pass ? 1 : 0.55;
        context.lineWidth = pass ? 2 : 1;
        const [x, y, w, h] = rect;
        context.strokeRect(x * scale + 0.5, y * scale + 0.5, Math.max(1, w * scale - 1), Math.max(1, h * scale - 1));
      }
    }
    context.globalAlpha = 1;
  }, [pixels, version, rects, selected, width, height, scale, shownWidth, shownHeight]);

  const cell = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const box = event.currentTarget.getBoundingClientRect();
    return [
      Math.min(width - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * width))),
      Math.min(height - 1, Math.max(0, Math.floor(((event.clientY - box.top) / box.height) * height))),
    ];
  };

  return (
    <canvas
      ref={canvas}
      width={shownWidth}
      height={shownHeight}
      role="img"
      aria-label={`Texture ${width} × ${height} avec les zones des faces`}
      className={cn(
        "block max-w-full rounded-sm border border-border [image-rendering:pixelated]",
        mode === "paint" ? "cursor-crosshair" : "cursor-pointer",
      )}
      style={{ width: shownWidth, height: shownHeight }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const [x, y] = cell(event);
        if (mode === "paint" && pixels) {
          down.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          onPaint({ texture, x, y }, "start");
          return;
        }
        // Zone la plus petite sous le clic (les zones d'un cube se touchent).
        const under = rects
          .filter(({ rect: [rx, ry, rw, rh] }) => x >= rx && x < rx + rw && y >= ry && y < ry + rh)
          .sort((a, b) => a.rect[2] * a.rect[3] - b.rect[2] * b.rect[3])[0];
        if (under) onPick(under.owner, under.face);
      }}
      onPointerMove={(event) => {
        if (down.current) onPaint({ texture, x: cell(event)[0], y: cell(event)[1] }, "move");
      }}
      onPointerUp={() => {
        if (!down.current) return;
        down.current = false;
        onPaint({ texture, x: -1, y: -1 }, "end");
      }}
    />
  );
}
