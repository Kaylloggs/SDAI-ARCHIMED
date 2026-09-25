import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeftRight, ImagePlus, Loader2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import type { ImageNode } from "@/core/ipc/bindings/ImageNode";
import { shapeMode, simplify, type Point } from "../lib/mask";
import { clampRect, parseRatio, rectFromPoints, type Rect } from "../lib/ratio";
import { currentNode, useImageMaker, type View } from "../store";
import { checker } from "./ui";

const MIN_SCALE = 0.02;
const MAX_SCALE = 32;

/** Couleur d'accent du thème, lue sur la racine (le canevas 2D ne lit pas les variables CSS). */
function accentColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "white";
}

export function srcOf(path: string): string {
  return convertFileSrc(path);
}

type Live =
  | { kind: "rect" | "ellipse"; start: Point; rect: Rect }
  | { kind: "lasso"; points: Point[] }
  | { kind: "stroke"; points: Point[] }
  | { kind: "pan"; startX: number; startY: number; view: View }
  | { kind: "move"; start: Point; dx: number; dy: number }
  | { kind: "crop"; start: Point; mode: "draw" | "move" | "resize"; origin: Rect | null; anchor: Point | null }
  | { kind: "slider" };

function fitView(node: { width: number; height: number }, box: DOMRect): View {
  const margin = 32;
  const scale = Math.min(1, (box.width - margin * 2) / node.width, (box.height - margin * 2) / node.height);
  const s = Math.max(MIN_SCALE, scale);
  return { scale: s, x: (box.width - node.width * s) / 2, y: (box.height - node.height * s) / 2 };
}

/**
 * Canevas : image affichée, zoom et déplacement, sélection (masque), pinceau, recadrage,
 * comparaison avant / après. Coordonnées de travail : pixels de l'image.
 */
export function Canvas() {
  const node = useImageMaker((s) => currentNode(s));
  const hasProject = useImageMaker((s) => Boolean(s.project));
  const tool = useImageMaker((s) => s.tool);
  const mask = useImageMaker((s) => s.mask);
  const maskRevision = useImageMaker((s) => s.maskRevision);
  const maskVisible = useImageMaker((s) => s.maskVisible);
  const paint = useImageMaker((s) => s.paint);
  const paintRevision = useImageMaker((s) => s.paintRevision);
  const paintTarget = useImageMaker((s) => s.paintTarget);
  const brushSize = useImageMaker((s) => s.brushSize);
  const paintColor = useImageMaker((s) => s.paintColor);
  const view = useImageMaker((s) => s.view);
  const viewRequest = useImageMaker((s) => s.viewRequest);
  const cropRect = useImageMaker((s) => s.cropRect);
  const cropRatio = useImageMaker((s) => s.cropRatio);
  const compare = useImageMaker((s) => s.compare);
  const other = useImageMaker((s) => s.project?.nodes.find((n) => n.id === s.compare.other) ?? null);
  const busy = useImageMaker((s) => s.busy);
  const running = useImageMaker((s) =>
    s.jobs.some((j) => j.projectId === s.project?.id && (j.status === "running" || j.status === "waiting")),
  );
  const store = useImageMaker.getState;

  const box = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const paintView = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [space, setSpace] = useState(false);
  const [split, setSplit] = useState(50);
  const [loaded, setLoaded] = useState<string | null>(null);
  const fitted = useRef<string | null>(null);

  const setView = useCallback((next: View) => store().set({ view: next }), [store]);

  // Ajuste la vue à chaque nouvelle image de taille différente, et à la demande.
  useLayoutEffect(() => {
    if (!node || !box.current) return;
    const key = `${node.width}x${node.height}`;
    if (fitted.current === key) return;
    fitted.current = key;
    setView(fitView(node, box.current.getBoundingClientRect()));
  }, [node, setView]);

  useEffect(() => {
    if (!node || !box.current || viewRequest.at === 0) return;
    const rect = box.current.getBoundingClientRect();
    if (viewRequest.kind === "fit") setView(fitView(node, rect));
    else if (viewRequest.kind === "actual") setView({ scale: 1, x: (rect.width - node.width) / 2, y: (rect.height - node.height) / 2 });
    else {
      // Zoom autour du centre de la vue.
      const v = store().view;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * (viewRequest.kind === "in" ? 1.25 : 0.8)));
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      setView({ scale, x: cx - ((cx - v.x) * scale) / v.scale, y: cy - ((cy - v.y) * scale) / v.scale });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRequest.at]);

  // Garde l'image centrée quand la fenêtre change de taille.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let last = element.getBoundingClientRect();
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect();
      const v = store().view;
      setView({ ...v, x: v.x + (next.width - last.width) / 2, y: v.y + (next.height - last.height) / 2 });
      last = next;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [setView, store]);

  // Teinte d'accent sur la sélection.
  useEffect(() => {
    const canvas = overlay.current;
    if (!canvas || !mask) return;
    canvas.width = mask.canvas.width;
    canvas.height = mask.canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(mask.canvas, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = accentColor();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [mask, maskRevision]);

  // Copie de travail du pinceau.
  useEffect(() => {
    const canvas = paintView.current;
    if (!canvas || !paint) return;
    canvas.width = paint.canvas.width;
    canvas.height = paint.canvas.height;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    ctx?.drawImage(paint.canvas, 0, 0);
  }, [paint, paintRevision]);

  // Espace maintenue : main temporaire.
  useEffect(() => {
    const typing = (event: KeyboardEvent) => (event.target as Element).closest?.("input, textarea, [contenteditable]");
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space" && !typing(event)) {
        event.preventDefault();
        setSpace(true);
      }
    };
    const up = (event: KeyboardEvent) => event.code === "Space" && setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const toImage = (event: { clientX: number; clientY: number }): Point => {
    const rect = box.current!.getBoundingClientRect();
    const v = store().view;
    return { x: (event.clientX - rect.left - v.x) / v.scale, y: (event.clientY - rect.top - v.y) / v.scale };
  };

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const rect = box.current!.getBoundingClientRect();
    const v = store().view;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    setView({ scale, x: px - ((px - v.x) * scale) / v.scale, y: py - ((py - v.y) * scale) / v.scale });
  };

  const comparing = compare.mode !== "off" && other !== null;
  const painting = (tool === "brush" || tool === "eraser") && paintTarget === "image";
  const panning = space || tool === "hand" || comparing;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!node || busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = toImage(event);
    if (event.button === 1 || panning) {
      setLive({ kind: "pan", startX: event.clientX, startY: event.clientY, view: store().view });
      return;
    }
    if (event.button !== 0) return;
    const clamp = (q: Point): Point => ({ x: Math.max(0, Math.min(node.width, q.x)), y: Math.max(0, Math.min(node.height, q.y)) });
    switch (tool) {
      case "zoom":
        zoomAt(event.clientX, event.clientY, event.altKey ? 1 / 1.6 : 1.6);
        return;
      case "rect":
      case "ellipse":
        setLive({ kind: tool, start: clamp(p), rect: { ...clamp(p), width: 0, height: 0 } });
        return;
      case "lasso":
        setLive({ kind: "lasso", points: [clamp(p)] });
        return;
      case "brush":
      case "eraser": {
        const erase = (tool === "eraser") !== event.altKey;
        if (painting) {
          if (!paint || paint.nodeId !== node.id) return;
          paint.stroke([p], brushSize, paintColor, erase);
          store().set({ paintRevision: store().paintRevision + 1 });
        } else {
          mask?.drawLive({ kind: "stroke", mode: erase ? "subtract" : "add", points: [p], size: brushSize });
        }
        setLive({ kind: "stroke", points: [p] });
        return;
      }
      case "move":
        if (!mask || mask.isEmpty) {
          store().notify("info", "Sélectionnez d'abord ce qu'il faut déplacer (rectangle, ellipse, lasso ou pinceau).");
          return;
        }
        setLive({ kind: "move", start: p, dx: 0, dy: 0 });
        return;
      case "crop": {
        const current = store().cropRect;
        const handle = current ? handleAt(current, p, 10 / store().view.scale) : null;
        if (current && handle) {
          setLive({ kind: "crop", start: p, mode: "resize", origin: current, anchor: handle });
        } else if (current && inside(current, p)) {
          setLive({ kind: "crop", start: p, mode: "move", origin: current, anchor: null });
        } else {
          setLive({ kind: "crop", start: clamp(p), mode: "draw", origin: null, anchor: null });
        }
        return;
      }
      default:
        return;
    }
  };

  const ratioValue = (): number | null => {
    if (!node) return null;
    if (cropRatio === "free") return null;
    if (cropRatio === "original") return node.width / node.height;
    return parseRatio(cropRatio);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!node) return;
    const p = toImage(event);
    setHover(p);
    if (!live) return;
    const clamp = (q: Point): Point => ({ x: Math.max(0, Math.min(node.width, q.x)), y: Math.max(0, Math.min(node.height, q.y)) });
    switch (live.kind) {
      case "pan":
        setView({ ...live.view, x: live.view.x + event.clientX - live.startX, y: live.view.y + event.clientY - live.startY });
        return;
      case "rect":
      case "ellipse": {
        const end = clamp(p);
        const rect = event.shiftKey && !event.altKey
          ? rectFromPoints(live.start, end, null)
          : rectFromPoints(live.start, end, event.ctrlKey ? 1 : null);
        setLive({ ...live, rect });
        return;
      }
      case "lasso": {
        const last = live.points.at(-1)!;
        const q = clamp(p);
        if (Math.hypot(q.x - last.x, q.y - last.y) * store().view.scale >= 2) setLive({ ...live, points: [...live.points, q] });
        return;
      }
      case "stroke": {
        const last = live.points.at(-1)!;
        if (Math.hypot(p.x - last.x, p.y - last.y) * store().view.scale < 1.5) return;
        const erase = (tool === "eraser") !== event.altKey;
        if (painting && paint) {
          paint.stroke([last, p], brushSize, paintColor, erase);
          store().set({ paintRevision: store().paintRevision + 1 });
        } else {
          mask?.drawLive({ kind: "stroke", mode: erase ? "subtract" : "add", points: [last, p], size: brushSize });
        }
        setLive({ ...live, points: [...live.points, p] });
        return;
      }
      case "move":
        setLive({ ...live, dx: Math.round(p.x - live.start.x), dy: Math.round(p.y - live.start.y) });
        return;
      case "crop": {
        const ratio = ratioValue();
        if (live.mode === "draw") {
          store().set({ cropRect: rectFromPoints(live.start, clamp(p), ratio) });
        } else if (live.mode === "move" && live.origin) {
          const o = live.origin;
          const x = Math.max(0, Math.min(node.width - o.width, o.x + p.x - live.start.x));
          const y = Math.max(0, Math.min(node.height - o.height, o.y + p.y - live.start.y));
          store().set({ cropRect: { ...o, x, y } });
        } else if (live.anchor) {
          store().set({ cropRect: rectFromPoints(live.anchor, clamp(p), ratio) });
        }
        return;
      }
      default:
        return;
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = live;
    setLive(null);
    if (!current || !node) return;
    const mode = shapeMode(event.shiftKey, event.altKey);
    switch (current.kind) {
      case "rect":
      case "ellipse": {
        const r = current.rect;
        if (r.width * store().view.scale < 3 || r.height * store().view.scale < 3) {
          if (mode === "replace") mask?.clear();
          return;
        }
        mask?.push({ kind: current.kind, mode, x: r.x, y: r.y, width: r.width, height: r.height });
        return;
      }
      case "lasso":
        if (current.points.length >= 3) {
          mask?.push({ kind: "poly", mode, points: simplify(current.points, 1.5 / store().view.scale) });
        }
        return;
      case "stroke": {
        const erase = (tool === "eraser") !== event.altKey;
        if (!painting) {
          mask?.push({
            kind: "stroke",
            mode: erase ? "subtract" : "add",
            points: simplify(current.points, 1 / store().view.scale),
            size: brushSize,
          });
        }
        return;
      }
      case "move":
        if ((current.dx !== 0 || current.dy !== 0) && mask && !mask.isEmpty) void moveSelection(current.dx, current.dy);
        return;
      case "crop": {
        const rect = store().cropRect;
        if (rect && (rect.width < 2 || rect.height < 2)) store().set({ cropRect: null });
        else if (rect) store().set({ cropRect: clampRect(rect, node.width, node.height) });
        return;
      }
      default:
        return;
    }
  };

  /** Déplace la zone sélectionnée (sur la machine), puis sélectionne la zone laissée. */
  const moveSelection = async (dx: number, dy: number) => {
    const state = store();
    if (!state.mask) return;
    const done = await state.local({ type: "move", mask_png: state.mask.toDataUrl(), dx, dy });
    if (!done) return;
    const moved = currentNode(store());
    if (moved?.mask && store().mask) {
      await store().mask!.pushImage(`${srcOf(moved.mask)}?mask`, "replace");
      store().setDraft({ task: "inpaint", inpaintMode: "remove" });
      store().set({ panel: "edit" });
      store().notify("info", "Zone laissée sélectionnée : « Effacer » dans Retoucher la comble avec le décor.");
    }
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!node) return;
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
    zoomAt(event.clientX, event.clientY, factor);
  };

  if (!hasProject) return null;
  if (!node) {
    return (
      <div ref={box} className="relative flex h-full items-center justify-center">
        <CanvasEmpty />
      </div>
    );
  }

  const cursor = panning
    ? live?.kind === "pan"
      ? "grabbing"
      : "grab"
    : tool === "zoom"
      ? "zoom-in"
      : tool === "move"
        ? "move"
        : tool === "brush" || tool === "eraser"
          ? "none"
          : "crosshair";

  const moving = live?.kind === "move" ? live : null;
  const showBrush = (tool === "brush" || tool === "eraser") && hover && !panning;

  return (
    <div
      ref={box}
      className="relative h-full touch-none select-none overflow-hidden"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onWheel={onWheel}
      onDoubleClick={() => tool === "hand" && store().set({ viewRequest: { kind: "fit", at: Date.now() } })}
      role="img"
      aria-label={`${node.label}, ${node.width} × ${node.height} pixels`}
    >
      {comparing && compare.mode === "side" ? (
        <SideBySide before={other!} after={node} />
      ) : (
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: node.width,
            height: node.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <div className={cn("absolute inset-0", checker)} />
          {comparing && other && (
            <img
              src={srcOf(other.file)}
              alt={`Avant : ${other.label}`}
              draggable={false}
              className="absolute inset-0 size-full object-contain"
            />
          )}
          <img
            key={node.id}
            src={srcOf(node.file)}
            alt={node.label}
            draggable={false}
            onLoad={() => setLoaded(node.id)}
            className={cn(
              "absolute inset-0 size-full transition-opacity duration-[140ms]",
              view.scale >= 4 && "[image-rendering:pixelated]",
              loaded === node.id ? "opacity-100" : "opacity-0",
            )}
            style={comparing ? { clipPath: `inset(0 0 0 ${split}%)` } : undefined}
          />
          {paint && paint.nodeId === node.id && (
            <canvas ref={paintView} className="absolute inset-0 size-full" aria-hidden />
          )}
          {!comparing && mask && (
            <canvas
              ref={overlay}
              aria-hidden
              className={cn("pointer-events-none absolute inset-0 size-full opacity-45", !maskVisible && "hidden")}
              style={moving ? { transform: `translate(${moving.dx}px, ${moving.dy}px)` } : undefined}
            />
          )}
          <svg
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
            viewBox={`0 0 ${node.width} ${node.height}`}
            aria-hidden
          >
            {live?.kind === "rect" && <rect {...live.rect} className="fill-accent/10 stroke-accent" strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
            {live?.kind === "ellipse" && (
              <ellipse
                cx={live.rect.x + live.rect.width / 2}
                cy={live.rect.y + live.rect.height / 2}
                rx={live.rect.width / 2}
                ry={live.rect.height / 2}
                className="fill-accent/10 stroke-accent"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {live?.kind === "lasso" && (
              <polyline
                points={live.points.map((p) => `${p.x},${p.y}`).join(" ")}
                className="fill-accent/10 stroke-accent"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {tool === "crop" && cropRect && <CropFrame rect={cropRect} width={node.width} height={node.height} scale={view.scale} />}
            {showBrush && (
              <circle
                cx={hover.x}
                cy={hover.y}
                r={brushSize / 2}
                className="fill-none stroke-text"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        </div>
      )}
      {comparing && compare.mode === "slider" && (
        <CompareHandle
          split={split}
          onChange={setSplit}
          box={box}
          view={view}
          width={node.width}
          height={node.height}
          beforeLabel={other!.label}
          afterLabel={node.label}
        />
      )}
      {(busy || running) && (
        <div className="glass pointer-events-none absolute right-3 top-3 flex items-center gap-2 rounded-full px-3 py-1.5 text-footnote text-text-muted">
          <Loader2 size={14} className="animate-spin text-accent" />
          {busy ?? "Génération en cours…"}
        </div>
      )}
    </div>
  );
}

function inside(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
}

/** Coin du cadre sous le pointeur → coin opposé (qui reste fixe pendant le redimensionnement). */
function handleAt(rect: Rect, p: Point, tolerance: number): Point | null {
  const corners = [
    { at: { x: rect.x, y: rect.y }, opposite: { x: rect.x + rect.width, y: rect.y + rect.height } },
    { at: { x: rect.x + rect.width, y: rect.y }, opposite: { x: rect.x, y: rect.y + rect.height } },
    { at: { x: rect.x, y: rect.y + rect.height }, opposite: { x: rect.x + rect.width, y: rect.y } },
    { at: { x: rect.x + rect.width, y: rect.y + rect.height }, opposite: { x: rect.x, y: rect.y } },
  ];
  return corners.find((c) => Math.hypot(c.at.x - p.x, c.at.y - p.y) <= tolerance)?.opposite ?? null;
}

function CropFrame({ rect, width, height, scale }: { rect: Rect; width: number; height: number; scale: number }) {
  const handle = 8 / scale;
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ];
  return (
    <g>
      <path
        d={`M0 0H${width}V${height}H0Z M${rect.x} ${rect.y}V${rect.y + rect.height}H${rect.x + rect.width}V${rect.y}Z`}
        fillRule="evenodd"
        className="fill-bg/60"
      />
      <rect {...rect} className="fill-none stroke-accent" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {[1, 2].map((i) => (
        <g key={i} className="stroke-text/30" strokeWidth={1}>
          <line x1={rect.x + (rect.width * i) / 3} x2={rect.x + (rect.width * i) / 3} y1={rect.y} y2={rect.y + rect.height} vectorEffect="non-scaling-stroke" />
          <line y1={rect.y + (rect.height * i) / 3} y2={rect.y + (rect.height * i) / 3} x1={rect.x} x2={rect.x + rect.width} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
      {corners.map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x! - handle / 2}
          y={y! - handle / 2}
          width={handle}
          height={handle}
          className="fill-text stroke-bg"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

/** Poignée du comparateur : glisser, ou flèches au clavier. */
function CompareHandle({
  split,
  onChange,
  box,
  view,
  width,
  height,
  beforeLabel,
  afterLabel,
}: {
  split: number;
  onChange: (value: number) => void;
  box: React.RefObject<HTMLDivElement | null>;
  view: View;
  width: number;
  height: number;
  beforeLabel: string;
  afterLabel: string;
}) {
  const x = view.x + (width * view.scale * split) / 100;
  const top = Math.max(0, view.y);
  const bottom = view.y + height * view.scale;
  const drag = (event: React.PointerEvent) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const value = ((event.clientX - rect.left - view.x) / (width * view.scale)) * 100;
    onChange(Math.max(0, Math.min(100, value)));
  };
  return (
    <>
      <div
        className="absolute w-px bg-text/80"
        style={{ left: x, top, height: Math.max(0, bottom - top) }}
        aria-hidden
      />
      <button
        type="button"
        role="slider"
        aria-label="Position du comparateur"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(split)}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => event.buttons === 1 && drag(event)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") onChange(Math.max(0, split - 2));
          if (event.key === "ArrowRight") onChange(Math.min(100, split + 2));
        }}
        className="absolute flex size-8 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-border-strong bg-surface-3 text-caption text-text shadow-[var(--shadow-float)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ left: x, top: (top + bottom) / 2 }}
      >
        <ArrowLeftRight size={14} aria-hidden />
      </button>
      <span className="glass pointer-events-none absolute bottom-3 left-3 max-w-[40%] truncate rounded-full px-2.5 py-1 text-footnote text-text-muted">
        Avant · {beforeLabel}
      </span>
      <span className="glass pointer-events-none absolute bottom-3 right-3 max-w-[40%] truncate rounded-full px-2.5 py-1 text-footnote text-text-muted">
        Après · {afterLabel}
      </span>
    </>
  );
}

function SideBySide({ before, after }: { before: ImageNode; after: ImageNode }) {
  return (
    <div className="grid h-full grid-cols-2 gap-2 p-4">
      {[
        { node: before, label: "Avant" },
        { node: after, label: "Après" },
      ].map(({ node, label }) => (
        <figure key={label} className="flex min-h-0 flex-col gap-2">
          <div className={cn("relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border", checker)}>
            <img src={srcOf(node.file)} alt={`${label} : ${node.label}`} draggable={false} className="absolute inset-0 size-full object-contain" />
          </div>
          <figcaption className="truncate text-center text-footnote text-text-muted">
            {label} · {node.label} · {node.width} × {node.height}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function CanvasEmpty() {
  const store = useImageMaker.getState;
  return (
    <div className="flex max-w-[420px] flex-col items-center gap-4 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-xl border border-border bg-surface-1 text-text-muted">
        <ImagePlus size={24} strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <p className="text-title-3 font-semibold">Une toile vide</p>
        <p className="text-body text-text-muted">
          Décrivez une image dans le panneau de droite, glissez-en une depuis l'Explorateur, ou collez-la avec Ctrl+V.
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          store().set({ panel: "create" });
          store().set({ focusPrompt: store().focusPrompt + 1 });
        }}
        className="text-body-sm font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Décrire une image
      </button>
    </div>
  );
}
