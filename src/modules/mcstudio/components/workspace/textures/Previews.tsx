import { useMemo } from "react";
import { cn } from "@/core/lib/cn";
import type { Pixels } from "../../../lib/pixels";

/** Image PNG (data URL) des pixels, pour les aperçus pendant la retouche. */
export function pixelsToDataUrl(pixels: Pixels): string {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  return canvas.toDataURL("image/png");
}

export function useDataUrl(pixels: Pixels | null): string | null {
  return useMemo(() => (pixels ? pixelsToDataUrl(pixels) : null), [pixels]);
}

const checker =
  "bg-[repeating-conic-gradient(var(--color-surface-2)_0%_25%,var(--color-surface-1)_0%_50%)] bg-[length:12px_12px]";

/**
 * La texture répétée 3 × 3, comme un mur ou un sol : un raccord raté se voit aussitôt.
 * `outline` souligne la case du milieu.
 */
export function TilePreview({
  src,
  width,
  height,
  side = 192,
  outline = false,
}: {
  src: string;
  width: number;
  height: number;
  /** Largeur totale de l'aperçu. */
  side?: number;
  outline?: boolean;
}) {
  const tile = Math.max(1, Math.floor(side / 3 / width)) * width;
  const tileHeight = (tile / width) * height;
  return (
    <div
      role="img"
      aria-label="Texture répétée trois fois trois"
      className={cn("relative shrink-0 overflow-hidden rounded-md border border-border", checker)}
      style={{ width: tile * 3, height: tileHeight * 3 }}
    >
      <div
        className="absolute inset-0 [image-rendering:pixelated]"
        style={{ backgroundImage: `url("${src}")`, backgroundSize: `${tile}px ${tileHeight}px`, backgroundRepeat: "repeat" }}
      />
      {outline && (
        <div
          aria-hidden
          className="absolute border border-dashed border-accent/70"
          style={{ left: tile, top: tileHeight, width: tile, height: tileHeight }}
        />
      )}
    </div>
  );
}

/** Faces visibles du bloc en vue d'inventaire : dessus, face gauche (nord), face droite (est). */
export type CubeFaces = { top: string | null; left: string | null; right: string | null };

function Face({ src, transform, light }: { src: string | null; transform: string; light: number }) {
  return (
    <div
      className="absolute inset-0 bg-surface-3 [backface-visibility:hidden] [image-rendering:pixelated]"
      style={{
        transform,
        backgroundImage: src ? `url("${src}")` : undefined,
        backgroundSize: "100% 100%",
        // Ombrage du jeu : dessus plein jour, côtés plus sombres.
        filter: `brightness(${light})`,
      }}
    />
  );
}

/** Le bloc tel qu'il apparaît dans l'inventaire (cube isométrique). */
export function BlockPreview({ faces, size = 96 }: { faces: CubeFaces; size?: number }) {
  const half = size / 2;
  return (
    <div
      role="img"
      aria-label="Aperçu du bloc en trois dimensions"
      className="flex shrink-0 items-center justify-center"
      style={{ width: size * 1.8, height: size * 1.8 }}
    >
      <div
        className="relative [transform-style:preserve-3d]"
        style={{ width: size, height: size, transform: "rotateX(-30deg) rotateY(-45deg)" }}
      >
        <Face src={faces.top} light={1} transform={`rotateX(90deg) translateZ(${half}px)`} />
        <Face src={faces.left} light={0.8} transform={`translateZ(${half}px)`} />
        <Face src={faces.right} light={0.62} transform={`rotateY(90deg) translateZ(${half}px)`} />
      </div>
    </div>
  );
}
