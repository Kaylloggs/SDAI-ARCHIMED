import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Eraser,
  FlipHorizontal2,
  Grid3x3,
  Move,
  PaintBucket,
  Pencil,
  Pipette,
  Redo2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Kbd } from "@/design-system/primitives";
import {
  clonePixels,
  floodFill,
  fromHex,
  getPixel,
  inside,
  line,
  mirrored,
  paletteOf,
  setPixel,
  shade,
  toHex,
  TRANSPARENT,
  type Pixels,
  type Rgba,
} from "../../../lib/pixels";
import { focusRing, inputClass } from "../../ui";

type Tool = "pencil" | "eraser" | "fill" | "picker";

const TOOLS: { value: Tool; label: string; key: string; Icon: typeof Pencil }[] = [
  { value: "pencil", label: "Crayon", key: "B", Icon: Pencil },
  { value: "eraser", label: "Gomme (transparent)", key: "E", Icon: Eraser },
  { value: "fill", label: "Remplissage", key: "G", Icon: PaintBucket },
  { value: "picker", label: "Pipette", key: "I", Icon: Pipette },
];

const MAX_ZOOM = 32;
const HISTORY = 100;

function ToolButton({
  label,
  pressed,
  onClick,
  disabled,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-sm transition-colors disabled:opacity-40",
        pressed ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-2 hover:text-text",
        focusRing,
      )}
    >
      {children}
    </button>
  );
}

/** Interrupteur nommé de la barre (Grille, Cadrer) : visible sans survol. */
export function ToolToggle({
  label,
  title,
  pressed,
  onClick,
  disabled,
  icon,
}: {
  label: string;
  title: string;
  pressed: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-sm px-2 text-footnote transition-colors disabled:opacity-40",
        pressed ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-2 hover:text-text",
        focusRing,
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Décale l'image d'une demi-largeur et d'une demi-hauteur (en boucle) : les bords opposés se
 * retrouvent côte à côte au milieu, où l'on corrige le raccord. Deux décalages = retour. */
function shiftHalf(pixels: Pixels): Pixels {
  const out = clonePixels(pixels);
  const { width: w, height: h } = pixels;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      out.data.set(getPixel(pixels, x, y), (((y + (h >> 1)) % h) * w + ((x + (w >> 1)) % w)) * 4);
    }
  }
  return out;
}

/**
 * Éditeur de pixels : crayon, gomme, remplissage, pipette, miroir, grille, décalage pour
 * travailler le raccord, annuler/rétablir. Au clavier : flèches pour se déplacer, Espace pour
 * appliquer l'outil, B/E/G/I pour changer d'outil, Ctrl+Z / Ctrl+Y.
 * `onChange` reçoit l'image à la fin de chaque geste ; l'éditeur repart de `initial` (et vide
 * son historique) seulement quand `resetKey` change.
 */
export function PixelEditor({
  initial: pixels,
  resetKey,
  onChange,
  disabled = false,
  suspended = false,
  fit,
  extraTools,
  children,
}: {
  initial: Pixels;
  resetKey: string;
  onChange: (pixels: Pixels) => void;
  disabled?: boolean;
  /** Un autre outil occupe le canevas (cadrage) : dessin en pause. */
  suspended?: boolean;
  /** Côté visé du canevas (px), selon la place disponible ; suivi tant qu'on n'a pas zoomé. */
  fit: number;
  /** Outils ajoutés dans la barre, à côté de la grille (cadrage). */
  extraTools?: ReactNode;
  /** Disposition des morceaux de l'éditeur : barre d'outils, canevas, palette. */
  children: (parts: { toolbar: ReactNode; canvas: ReactNode; palette: ReactNode }) => ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const work = useRef<Pixels>(clonePixels(pixels));
  const undo = useRef<Pixels[]>([]);
  const redo = useRef<Pixels[]>([]);
  const stroke = useRef<{ last: [number, number]; changed: boolean } | null>(null);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState<Rgba>(() => paletteOf(pixels, 1)[0] ?? [96, 96, 96, 255]);
  const [hex, setHex] = useState(() => toHex(color));
  const [mirror, setMirror] = useState(false);
  const [grid, setGrid] = useState(true);
  const fitted = Math.max(1, Math.min(MAX_ZOOM, Math.floor(fit / Math.max(pixels.width, pixels.height))));
  const [zoom, setZoomState] = useState(fitted);
  // La taille suit la fenêtre jusqu'à ce que la personne zoome elle-même.
  const zoomedByHand = useRef(false);
  useEffect(() => {
    if (!zoomedByHand.current) setZoomState(fitted);
  }, [fitted]);
  const setZoom = (update: (zoom: number) => number) => {
    zoomedByHand.current = true;
    setZoomState(update);
  };
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [palette, setPalette] = useState<Rgba[]>(() => paletteOf(pixels, 24));

  // Nouvelle image venue d'ailleurs (autre brouillon, reconversion) : on repart d'elle.
  const loaded = useRef(resetKey);
  useEffect(() => {
    if (loaded.current === resetKey) return;
    loaded.current = resetKey;
    work.current = clonePixels(pixels);
    undo.current = [];
    redo.current = [];
    setHistory({ undo: 0, redo: 0 });
    setPalette(paletteOf(pixels, 24));
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const pickColor = (next: Rgba) => {
    setColor(next);
    setHex(toHex(next));
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const { width, height, data } = work.current;
    const source = document.createElement("canvas");
    source.width = width;
    source.height = height;
    source.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, width * zoom, height * zoom);
    const styles = getComputedStyle(canvas);
    if (grid && zoom >= 4) {
      context.strokeStyle = styles.getPropertyValue("--color-border").trim() || "rgba(128,128,128,0.35)";
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 1; x < width; x += 1) {
        context.moveTo(x * zoom + 0.5, 0);
        context.lineTo(x * zoom + 0.5, height * zoom);
      }
      for (let y = 1; y < height; y += 1) {
        context.moveTo(0, y * zoom + 0.5);
        context.lineTo(width * zoom, y * zoom + 0.5);
      }
      context.stroke();
    }
    if (cursor) {
      context.strokeStyle = styles.getPropertyValue("--color-accent").trim() || "orange";
      context.lineWidth = 2;
      context.strokeRect(cursor[0] * zoom + 1, cursor[1] * zoom + 1, zoom - 2, zoom - 2);
    }
  }, [zoom, grid, cursor]);

  useEffect(() => draw(), [draw]);

  const snapshot = () => {
    undo.current = [...undo.current.slice(-(HISTORY - 1)), clonePixels(work.current)];
    redo.current = [];
  };

  const commit = () => {
    setHistory({ undo: undo.current.length, redo: redo.current.length });
    setPalette(paletteOf(work.current, 24));
    onChange(clonePixels(work.current));
  };

  /** Applique le crayon ou la gomme en `(x, y)`, et au symétrique en mode miroir. */
  const paint = (x: number, y: number): boolean => {
    const ink = tool === "eraser" ? TRANSPARENT : color;
    let changed = setPixel(work.current, x, y, ink);
    if (mirror) changed = setPixel(work.current, mirrored(work.current, x), y, ink) || changed;
    return changed;
  };

  /** Premier contact d'un geste : `true` s'il faut suivre le glisser. */
  const begin = (x: number, y: number): boolean => {
    if (!inside(work.current, x, y)) return false;
    if (tool === "picker") {
      const picked = getPixel(work.current, x, y);
      if (picked[3] > 0) pickColor(picked);
      setTool("pencil");
      return false;
    }
    snapshot();
    if (tool === "fill") {
      let changed = floodFill(work.current, x, y, color) > 0;
      if (mirror) changed = floodFill(work.current, mirrored(work.current, x), y, color) > 0 || changed;
      if (changed) {
        draw();
        commit();
      } else {
        undo.current.pop();
      }
      return false;
    }
    stroke.current = { last: [x, y], changed: paint(x, y) };
    draw();
    return true;
  };

  const extend = (x: number, y: number) => {
    const current = stroke.current;
    if (!current) return;
    const [lx, ly] = current.last;
    if (lx === x && ly === y) return;
    for (const [px, py] of line(lx, ly, x, y)) current.changed = paint(px, py) || current.changed;
    current.last = [x, y];
    draw();
  };

  const end = () => {
    const current = stroke.current;
    stroke.current = null;
    if (!current) return;
    if (current.changed) commit();
    else undo.current.pop();
  };

  const cellAt = (event: React.PointerEvent): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.floor((event.clientX - rect.left) / zoom), Math.floor((event.clientY - rect.top) / zoom)];
  };

  const step = (from: Pixels[], to: Pixels[]) => {
    const previous = from.pop();
    if (!previous) return;
    to.push(clonePixels(work.current));
    work.current = previous;
    draw();
    commit();
  };
  const doUndo = () => step(undo.current, redo.current);
  const doRedo = () => step(redo.current, undo.current);

  const shift = () => {
    snapshot();
    work.current = shiftHalf(work.current);
    draw();
    commit();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled || suspended || (event.target as HTMLElement).tagName === "INPUT") return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (ctrl && key === "z") {
      event.preventDefault();
      if (event.shiftKey) doRedo();
      else doUndo();
      return;
    }
    if (ctrl && key === "y") {
      event.preventDefault();
      doRedo();
      return;
    }
    if (ctrl) return;
    const byKey = TOOLS.find((t) => t.key.toLowerCase() === key);
    if (byKey) {
      event.preventDefault();
      setTool(byKey.value);
      return;
    }
    if (key === "m") {
      setMirror((v) => !v);
      return;
    }
    const moves: Record<string, [number, number]> = {
      arrowleft: [-1, 0],
      arrowright: [1, 0],
      arrowup: [0, -1],
      arrowdown: [0, 1],
    };
    const move = moves[key];
    if (move) {
      event.preventDefault();
      const [cx, cy] = cursor ?? [0, 0];
      setCursor([
        Math.max(0, Math.min(pixels.width - 1, cx + move[0])),
        Math.max(0, Math.min(pixels.height - 1, cy + move[1])),
      ]);
      return;
    }
    if ((key === " " || key === "enter") && cursor) {
      event.preventDefault();
      if (begin(cursor[0], cursor[1])) end();
    }
  };

  const colorLabel = color[3] === 0 ? "transparent" : toHex(color);
  const locked = disabled || suspended;

  const separator = <span aria-hidden className="mx-1 h-5 w-px bg-border" />;
  const toolbar = (
    <div role="toolbar" aria-label="Outils de retouche" className="flex flex-wrap items-center gap-0.5">
      {TOOLS.map(({ value, label, key, Icon }) => (
        <ToolButton key={value} label={`${label} (${key})`} pressed={!suspended && tool === value} disabled={locked} onClick={() => setTool(value)}>
          <Icon size={16} strokeWidth={1.75} />
        </ToolButton>
      ))}
      <ToolButton label="Miroir gauche-droite (M)" pressed={mirror} disabled={locked} onClick={() => setMirror((v) => !v)}>
        <FlipHorizontal2 size={16} strokeWidth={1.75} />
      </ToolButton>
      <ToolButton
        label="Décaler d'une demi-case : les bords se retrouvent au milieu pour corriger le raccord (deux fois pour revenir)"
        disabled={locked}
        onClick={shift}
      >
        <Move size={16} strokeWidth={1.75} />
      </ToolButton>
      {separator}
      <ToolToggle
        label="Grille"
        title="Afficher la grille des pixels"
        pressed={grid}
        disabled={suspended}
        onClick={() => setGrid((v) => !v)}
        icon={<Grid3x3 size={15} strokeWidth={1.75} />}
      />
      {extraTools}
      {separator}
      <ToolButton label="Annuler (Ctrl+Z)" disabled={locked || history.undo === 0} onClick={doUndo}>
        <Undo2 size={16} strokeWidth={1.75} />
      </ToolButton>
      <ToolButton label="Rétablir (Ctrl+Y)" disabled={locked || history.redo === 0} onClick={doRedo}>
        <Redo2 size={16} strokeWidth={1.75} />
      </ToolButton>
      <span className="ml-auto flex items-center gap-0.5">
        <ToolButton label="Réduire" disabled={suspended || zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z - (z > 8 ? 4 : 1)))}>
          <ZoomOut size={16} strokeWidth={1.75} />
        </ToolButton>
        <span className="w-8 text-center text-caption tabular-nums text-text-subtle">×{zoom}</span>
        <ToolButton label="Agrandir" disabled={suspended || zoom >= MAX_ZOOM} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + (z >= 8 ? 4 : 1)))}>
          <ZoomIn size={16} strokeWidth={1.75} />
        </ToolButton>
      </span>
    </div>
  );

  const canvas = (
    <canvas
      ref={canvasRef}
      width={pixels.width * zoom}
      height={pixels.height * zoom}
      tabIndex={locked ? -1 : 0}
      role="img"
      aria-label={`Texture ${pixels.width} × ${pixels.height} en cours de retouche. Flèches pour se déplacer, Espace pour appliquer l'outil.`}
      onPointerDown={(event) => {
        if (locked || event.button !== 0) return;
        event.currentTarget.focus();
        const [x, y] = cellAt(event);
        if (begin(x, y)) event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (stroke.current) extend(...cellAt(event));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onBlur={() => setCursor(null)}
      className={cn(
        "block touch-none rounded-md border border-border [image-rendering:pixelated]",
        "bg-[repeating-conic-gradient(var(--color-surface-2)_0%_25%,var(--color-surface-1)_0%_50%)] bg-[length:16px_16px]",
        tool === "picker" ? "cursor-copy" : "cursor-crosshair",
        focusRing,
      )}
    />
  );

  const paletteView = (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-7 shrink-0 rounded-sm border border-border-strong bg-[repeating-conic-gradient(var(--color-surface-2)_0%_25%,var(--color-surface-1)_0%_50%)] bg-[length:8px_8px]"
        >
          <span className="block size-full rounded-sm" style={{ backgroundColor: `rgba(${color.join(",")})` }} />
        </span>
        <input
          aria-label="Couleur en hexadécimal"
          value={hex}
          spellCheck={false}
          disabled={locked}
          onChange={(event) => {
            setHex(event.target.value);
            const parsed = fromHex(event.target.value);
            if (parsed) setColor(parsed);
          }}
          onBlur={() => setHex(toHex(color))}
          className={cn(inputClass, "h-7 font-mono uppercase")}
        />
      </div>
      <div className="flex gap-1">
        {[
          { label: "Plus clair", amount: 0.15 },
          { label: "Plus sombre", amount: -0.15 },
        ].map(({ label, amount }) => (
          <button
            key={label}
            type="button"
            disabled={locked}
            onClick={() => pickColor(shade(color, amount))}
            className={cn("h-7 flex-1 rounded-sm text-footnote text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40", focusRing)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="listbox" aria-label="Couleurs de la texture" className="grid grid-cols-8 gap-1">
        {palette.map((swatch) => {
          const active = toHex(swatch) === toHex(color);
          return (
            <button
              key={swatch.join(",")}
              type="button"
              role="option"
              aria-selected={active}
              aria-label={toHex(swatch)}
              title={toHex(swatch)}
              disabled={locked}
              onClick={() => pickColor(swatch)}
              className={cn(
                "aspect-square w-full rounded-xs border",
                active ? "border-accent ring-1 ring-accent" : "border-border hover:border-border-strong",
                focusRing,
              )}
              style={{ backgroundColor: `rgba(${swatch.join(",")})` }}
            />
          );
        })}
      </div>
      <p className="text-caption text-text-subtle">
        <span className="font-mono">{colorLabel}</span> · pipette <Kbd>I</Kbd>
      </p>
    </div>
  );

  return <div onKeyDown={onKeyDown} className="contents">{children({ toolbar, canvas, palette: paletteView })}</div>;
}
