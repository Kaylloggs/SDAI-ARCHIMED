import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, mcstudioApi } from "../../../api";
import {
  decodePixels,
  encodePixels,
  floodFill,
  getPixel,
  line,
  stamp,
  TRANSPARENT,
  type Pixels,
  type Rgba,
} from "../../../lib/pixels";
import type { PaintPhase } from "./Viewport";

export type PaintTool = "pencil" | "eraser" | "fill" | "picker";
export type StudioMode = "select" | "paint";

/** Un pas d'historique : le modèle, ou les pixels d'une texture, avant et après. */
type Step<M> =
  | { kind: "model"; before: M; after: M }
  | { kind: "pixels"; path: string; before: Uint8ClampedArray; after: Uint8ClampedArray };

const HISTORY = 200;

/**
 * État commun des éditeurs 3D : le modèle, ses textures (pixels en mémoire), la peinture et un
 * seul historique pour les deux (Ctrl+Z / Ctrl+Y), avec ce qui reste à enregistrer.
 */
export function useStudio<M>(projectId: string) {
  const [model, setModel] = useState<M | null>(null);
  const [modelDirty, setModelDirty] = useState(false);
  const [textures, setTextures] = useState<Map<string, Pixels>>(() => new Map());
  const [missing, setMissing] = useState<Set<string>>(() => new Set());
  const [dirtyTextures, setDirtyTextures] = useState<Set<string>>(() => new Set());
  const [textureVersion, setTextureVersion] = useState(0);
  const [mode, setMode] = useState<StudioMode>("select");
  const [tool, setTool] = useState<PaintTool>("pencil");
  const [color, setColor] = useState<Rgba>([180, 60, 60, 255]);
  const [brush, setBrush] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const undo = useRef<Step<M>[]>([]);
  const redo = useRef<Step<M>[]>([]);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const stroke = useRef<{ path: string; before: Uint8ClampedArray; last: [number, number] } | null>(null);
  const modelRef = useRef<M | null>(null);
  modelRef.current = model;
  const texturesRef = useRef(textures);
  texturesRef.current = textures;

  const syncHistory = () => setHistory({ undo: undo.current.length, redo: redo.current.length });
  const push = (step: Step<M>) => {
    undo.current = [...undo.current.slice(-(HISTORY - 1)), step];
    redo.current = [];
    syncHistory();
  };

  /** Nouveau modèle ouvert : historique vidé, rien à enregistrer. */
  const open = useCallback((next: M) => {
    setModel(next);
    setModelDirty(false);
    // Tout de suite : les textures demandées juste après doivent être relues.
    texturesRef.current = new Map();
    setTextures(new Map());
    setMissing(new Set());
    setDirtyTextures(new Set());
    undo.current = [];
    redo.current = [];
    syncHistory();
  }, []);

  /** Modification du modèle (copie profonde faite par l'appelant), inscrite à l'historique. */
  const change = useCallback((next: M) => {
    const before = modelRef.current;
    if (before === null) return;
    push({ kind: "model", before, after: next });
    setModel(next);
    setModelDirty(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Aperçu pendant un glisser (poignée) : le modèle change sans entrer dans l'historique. */
  const preview = useCallback((next: M) => {
    setModel(next);
    setModelDirty(true);
  }, []);

  /** Fin d'un glisser : un seul pas d'historique, depuis l'état d'avant. */
  const changeFrom = useCallback((before: M, next: M) => {
    push({ kind: "model", before, after: next });
    setModel(next);
    setModelDirty(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Lit les textures qui manquent encore en mémoire. */
  const loadTextures = useCallback(
    async (paths: string[]) => {
      const wanted = paths.filter((p) => p && !texturesRef.current.has(p));
      if (wanted.length === 0) return;
      const loaded = await Promise.all(
        wanted.map((path) =>
          mcstudioApi
            .texturePixels(projectId, path)
            .then((data) => [path, decodePixels(data)] as const)
            .catch(() => [path, null] as const),
        ),
      );
      setTextures((current) => {
        const next = new Map(current);
        for (const [path, pixels] of loaded) if (pixels) next.set(path, pixels);
        return next;
      });
      setMissing((current) => {
        const next = new Set(current);
        for (const [path, pixels] of loaded) {
          if (pixels) next.delete(path);
          else next.add(path);
        }
        return next;
      });
    },
    [projectId],
  );

  /** Crée (ou remplace) une texture en mémoire ; enregistrée avec le modèle. */
  const putTexture = useCallback((path: string, pixels: Pixels, record = true) => {
    const before = texturesRef.current.get(path);
    if (record && before && before.width === pixels.width && before.height === pixels.height) {
      push({ kind: "pixels", path, before: before.data.slice(), after: pixels.data.slice() });
    } else if (record) {
      // Taille changée : l'historique des pixels de cette texture ne s'applique plus.
      undo.current = undo.current.filter((s) => s.kind !== "pixels" || s.path !== path);
      redo.current = redo.current.filter((s) => s.kind !== "pixels" || s.path !== path);
      syncHistory();
    }
    setTextures((current) => new Map(current).set(path, pixels));
    setMissing((current) => {
      const next = new Set(current);
      next.delete(path);
      return next;
    });
    setDirtyTextures((current) => new Set(current).add(path));
    setTextureVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyStep = (step: Step<M>, direction: "before" | "after") => {
    if (step.kind === "model") {
      setModel(step[direction]);
      setModelDirty(true);
      return;
    }
    const pixels = texturesRef.current.get(step.path);
    if (!pixels || pixels.data.length !== step[direction].length) return;
    pixels.data.set(step[direction]);
    setDirtyTextures((current) => new Set(current).add(step.path));
    setTextureVersion((v) => v + 1);
  };

  const doUndo = useCallback(() => {
    const step = undo.current.pop();
    if (!step) return;
    redo.current.push(step);
    applyStep(step, "before");
    syncHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doRedo = useCallback(() => {
    const step = redo.current.pop();
    if (!step) return;
    undo.current.push(step);
    applyStep(step, "after");
    syncHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Peinture (vue 3D ou texture à plat) : crayon, gomme, remplissage, pipette. */
  const paint = useCallback(
    (hit: { texture: string; x: number; y: number }, phase: PaintPhase) => {
      if (phase === "end") {
        const current = stroke.current;
        stroke.current = null;
        if (!current) return;
        const pixels = texturesRef.current.get(current.path);
        if (!pixels) return;
        const after = pixels.data.slice();
        if (after.some((value, i) => value !== current.before[i])) {
          push({ kind: "pixels", path: current.path, before: current.before, after });
        }
        return;
      }
      const pixels = texturesRef.current.get(hit.texture);
      if (!pixels) return;
      if (tool === "picker") {
        const picked = getPixel(pixels, hit.x, hit.y);
        if (picked[3] > 0) setColor(picked);
        setTool("pencil");
        return;
      }
      if (phase === "start" || !stroke.current || stroke.current.path !== hit.texture) {
        if (stroke.current && stroke.current.path !== hit.texture) paint(hit, "end");
        stroke.current = { path: hit.texture, before: pixels.data.slice(), last: [hit.x, hit.y] };
      }
      const ink = tool === "eraser" ? TRANSPARENT : color;
      let changed = false;
      if (tool === "fill") {
        if (phase === "start") changed = floodFill(pixels, hit.x, hit.y, color) > 0;
      } else {
        const [lx, ly] = stroke.current.last;
        // Trait continu entre deux positions proches (un saut = autre face de la texture).
        const points: [number, number][] =
          phase === "move" && Math.abs(lx - hit.x) + Math.abs(ly - hit.y) <= 6 ? line(lx, ly, hit.x, hit.y) : [[hit.x, hit.y]];
        for (const [px, py] of points) changed = stamp(pixels, px, py, brush, ink) || changed;
      }
      stroke.current.last = [hit.x, hit.y];
      if (changed) {
        setDirtyTextures((current) => (current.has(hit.texture) ? current : new Set(current).add(hit.texture)));
        setTextureVersion((v) => v + 1);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tool, color, brush],
  );

  /** Enregistre les textures modifiées. */
  const saveTextures = useCallback(async () => {
    for (const path of dirtyTextures) {
      const pixels = texturesRef.current.get(path);
      if (pixels) await mcstudioApi.saveTexturePixels(projectId, path, encodePixels(pixels));
    }
    setDirtyTextures(new Set());
  }, [dirtyTextures, projectId]);

  // Raccourcis : annuler, rétablir, taille du pinceau.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true], .cm-editor")) return;
      if (!target.closest("[data-studio]") && target !== document.body) return;
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) doRedo();
        else doUndo();
      } else if (ctrl && event.key.toLowerCase() === "y") {
        event.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  return {
    model,
    open,
    change,
    preview,
    changeFrom,
    modelDirty,
    setModelDirty,
    textures,
    missing,
    textureVersion,
    loadTextures,
    putTexture,
    dirtyTextures,
    saveTextures,
    mode,
    setMode,
    tool,
    setTool,
    color,
    setColor,
    brush,
    setBrush,
    paint,
    undo: doUndo,
    redo: doRedo,
    history,
    error,
    setError,
    errorText,
  };
}

export type Studio<M> = ReturnType<typeof useStudio<M>>;
