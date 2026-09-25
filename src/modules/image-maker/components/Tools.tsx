import { useEffect } from "react";
import {
  Brush,
  Check,
  CircleDashed,
  Columns2,
  Crop,
  Eraser,
  Eye,
  EyeOff,
  FlipHorizontal2,
  Hand,
  Lasso,
  Maximize,
  Minus,
  Move,
  Plus,
  Redo2,
  SquareDashed,
  SquareDashedMousePointer,
  Undo2,
  X,
  ZoomIn,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button, Select } from "@/design-system/primitives";
import { KIND_LABELS } from "../lib/format";
import { latestChild, parentOf } from "../lib/history";
import { RATIOS, clampRect, cropForRatio, fitSize, parseRatio } from "../lib/ratio";
import { currentNode, useImageMaker, type Tool } from "../store";
import { Chip, IconButton, Segmented, Slider } from "./ui";

const TOOLS: { id: Tool; label: string; key: string; Icon: typeof Hand }[] = [
  { id: "hand", label: "Main : déplacer la vue", key: "H", Icon: Hand },
  { id: "zoom", label: "Zoom (Alt pour dézoomer)", key: "Z", Icon: ZoomIn },
  { id: "rect", label: "Sélection rectangulaire", key: "M", Icon: SquareDashed },
  { id: "ellipse", label: "Sélection elliptique", key: "O", Icon: CircleDashed },
  { id: "lasso", label: "Lasso", key: "L", Icon: Lasso },
  { id: "brush", label: "Pinceau", key: "B", Icon: Brush },
  { id: "eraser", label: "Gomme", key: "E", Icon: Eraser },
  { id: "move", label: "Déplacer la sélection", key: "V", Icon: Move },
  { id: "crop", label: "Recadrer", key: "C", Icon: Crop },
];

const SWATCHES = ["#1f1f1f", "#ffffff", "#8a8a8a", "#c0392b", "#e67e22", "#f1c40f", "#27ae60", "#2980b9", "#8e44ad"];

/** Annuler : d'abord la sélection en cours, puis la version précédente (rien n'est effacé). */
export function undo() {
  const s = useImageMaker.getState();
  if (s.tool === "crop" && s.cropRect) return s.set({ cropRect: null });
  if (s.mask?.history.canUndo) return void s.mask.undo();
  s.stepBack();
}

export function redo() {
  const s = useImageMaker.getState();
  if (s.mask?.history.canRedo) return void s.mask.redo();
  s.stepForward();
}

export function applyCrop() {
  const s = useImageMaker.getState();
  const node = currentNode(s);
  if (!node || !s.cropRect) return;
  const rect = clampRect(s.cropRect, node.width, node.height);
  void s.local({ type: "crop", ...rect }).then((done) => done && s.set({ cropRect: null }));
}

export function ToolRail() {
  const tool = useImageMaker((s) => s.tool);
  const setTool = useImageMaker((s) => s.setTool);
  const hasImage = useImageMaker((s) => Boolean(currentNode(s)));
  const maskRevision = useImageMaker((s) => s.maskRevision);
  const canUndo = useImageMaker(
    (s) => Boolean(s.mask?.history.canUndo) || Boolean(parentOf(s.project?.nodes ?? [], s.project?.current ?? null)),
  );
  const canRedo = useImageMaker(
    (s) => Boolean(s.mask?.history.canRedo) || Boolean(latestChild(s.project?.nodes ?? [], s.project?.current ?? null)),
  );
  const compare = useImageMaker((s) => s.compare);
  const parent = useImageMaker((s) => parentOf(s.project?.nodes ?? [], s.project?.current ?? null));
  void maskRevision;

  return (
    <nav
      aria-label="Outils"
      className="flex min-h-0 w-12 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-border py-2 [scrollbar-width:none]"
    >
      {TOOLS.map(({ id, label, key, Icon }, index) => (
        <div key={id} className="contents">
          {(index === 2 || index === 5 || index === 7) && <div className="my-1 h-px w-6 bg-border" aria-hidden />}
          <IconButton label={label} shortcut={key} side="right" active={tool === id} disabled={!hasImage} onClick={() => setTool(id)}>
            <Icon size={16} strokeWidth={1.75} />
          </IconButton>
        </div>
      ))}
      <div className="flex-1" />
      <IconButton
        label="Comparer avec la version d'origine"
        shortcut="K"
        side="right"
        active={compare.mode !== "off"}
        disabled={!parent && compare.mode === "off"}
        onClick={() => toggleCompare()}
      >
        <Columns2 size={16} strokeWidth={1.75} />
      </IconButton>
      <IconButton label="Annuler" shortcut="Ctrl Z" side="right" disabled={!canUndo} onClick={undo}>
        <Undo2 size={16} strokeWidth={1.75} />
      </IconButton>
      <IconButton label="Rétablir" shortcut="Ctrl Maj Z" side="right" disabled={!canRedo} onClick={redo}>
        <Redo2 size={16} strokeWidth={1.75} />
      </IconButton>
    </nav>
  );
}

export function toggleCompare() {
  const s = useImageMaker.getState();
  if (s.compare.mode !== "off") return s.set({ compare: { mode: "off", other: null } });
  const parent = parentOf(s.project?.nodes ?? [], s.project?.current ?? null);
  if (parent) s.set({ compare: { mode: "slider", other: parent.id } });
}

/** Options de l'outil actif, au-dessus du canevas. */
export function ToolOptions() {
  const s = useImageMaker();
  const node = currentNode(s);
  if (!node) return <div className="h-11 shrink-0 border-b border-border" />;
  const comparing = s.compare.mode !== "off";

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 overflow-x-auto border-b border-border px-3">
      {comparing ? (
        <CompareOptions />
      ) : s.tool === "rect" || s.tool === "ellipse" || s.tool === "lasso" || s.tool === "move" ? (
        <SelectionOptions />
      ) : s.tool === "brush" || s.tool === "eraser" ? (
        <BrushOptions />
      ) : s.tool === "crop" ? (
        <CropOptions />
      ) : (
        <p className="truncate text-footnote text-text-subtle">
          {KIND_LABELS[node.kind]}
          {node.label !== KIND_LABELS[node.kind] && !node.label.startsWith(KIND_LABELS[node.kind]) ? ` · ${node.label}` : ""}
          {node.model ? ` · ${node.model}` : ""}
          {node.prompt ? ` · « ${node.prompt} »` : ""}
        </p>
      )}
      <div className="flex-1" />
      <ZoomControls />
    </div>
  );
}

function SelectionOptions() {
  const mask = useImageMaker((s) => s.mask);
  const tool = useImageMaker((s) => s.tool);
  const maskVisible = useImageMaker((s) => s.maskVisible);
  useImageMaker((s) => s.maskRevision);
  const empty = !mask || mask.isEmpty;
  return (
    <div className="flex items-center gap-1">
      <span className="mr-2 whitespace-nowrap text-footnote text-text-subtle">
        {tool === "move" ? "Glissez la sélection pour la déplacer" : "Maj : ajouter · Alt : retirer"}
      </span>
      <Button size="sm" variant="ghost" icon={<SquareDashedMousePointer size={14} />} onClick={() => mask?.push({ kind: "all" })}>
        Tout
      </Button>
      <Button size="sm" variant="ghost" icon={<FlipHorizontal2 size={14} />} disabled={empty} onClick={() => mask?.push({ kind: "invert" })}>
        Inverser
      </Button>
      <Button size="sm" variant="ghost" icon={<X size={14} />} disabled={empty} onClick={() => mask?.clear()}>
        Désélectionner
      </Button>
      <IconButton
        size="sm"
        label={maskVisible ? "Masquer la sélection" : "Afficher la sélection"}
        onClick={() => useImageMaker.getState().set({ maskVisible: !maskVisible })}
      >
        {maskVisible ? <Eye size={14} /> : <EyeOff size={14} />}
      </IconButton>
    </div>
  );
}

function BrushOptions() {
  const s = useImageMaker();
  const node = currentNode(s);
  const painting = s.paintTarget === "image";
  const dirty = Boolean(s.paint?.dirty);
  void s.paintRevision;
  return (
    <div className="flex items-center gap-3">
      <Segmented
        label="Le pinceau agit sur"
        value={s.paintTarget}
        options={[
          { value: "mask", label: "Sélection" },
          { value: "image", label: "Image" },
        ]}
        onChange={(target) => {
          if (target === "image") void s.startPaint();
          else if (dirty) return s.notify("warning", "Enregistrez ou annulez d'abord la retouche au pinceau.");
          else void s.endPaint(false);
          s.set({ paintTarget: target });
        }}
      />
      <div className="w-36">
        <Slider
          label="Taille"
          value={s.brushSize}
          min={2}
          max={Math.max(64, Math.round(Math.max(node?.width ?? 512, node?.height ?? 512) / 4))}
          onChange={(brushSize) => s.set({ brushSize })}
          format={(v) => `${v} px`}
        />
      </div>
      {painting && (
        <>
          <div role="radiogroup" aria-label="Couleur du pinceau" className="flex items-center gap-1">
            {SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={s.paintColor === color}
                aria-label={`Couleur ${color}`}
                onClick={() => s.set({ paintColor: color })}
                className={cn(
                  "size-5 rounded-full border transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  s.paintColor === color ? "scale-110 border-text" : "border-border-strong",
                )}
                style={{ background: color }}
              />
            ))}
          </div>
          <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => void s.endPaint(false).then(() => s.startPaint())}>
            Annuler la retouche
          </Button>
          <Button size="sm" variant="primary" icon={<Check size={14} />} disabled={!dirty} onClick={() => void s.endPaint(true).then(() => s.set({ paintTarget: "mask" }))}>
            Enregistrer
          </Button>
        </>
      )}
    </div>
  );
}

function CropOptions() {
  const s = useImageMaker();
  const node = currentNode(s)!;
  const presets = s.settings?.formatPresets ?? [];
  const choose = (ratio: string) => {
    s.set({ cropRatio: ratio });
    const value = ratio === "original" ? node.width / node.height : parseRatio(ratio);
    if (value) s.set({ cropRect: cropForRatio(node.width, node.height, value) });
  };
  return (
    <div className="flex items-center gap-1.5">
      <Chip active={s.cropRatio === "free"} onClick={() => s.set({ cropRatio: "free" })}>
        Libre
      </Chip>
      {RATIOS.map((ratio) => (
        <Chip key={ratio} active={s.cropRatio === ratio} onClick={() => choose(ratio)}>
          {ratio}
        </Chip>
      ))}
      {presets.length > 0 && (
        <Select
          label="Recadrer et redimensionner à un format"
          value=""
          placeholder="Formats…"
          className="w-40"
          options={presets.map((p) => ({ value: p.id, label: p.name, hint: `${p.width} × ${p.height}` }))}
          onChange={(id) => {
            const preset = presets.find((p) => p.id === id);
            if (!preset) return;
            void cropThenResize(preset.width, preset.height);
          }}
        />
      )}
      <div className="mx-1 h-5 w-px bg-border" aria-hidden />
      <Button size="sm" variant="ghost" disabled={!s.cropRect} onClick={() => s.set({ cropRect: null })}>
        Annuler
      </Button>
      <Button size="sm" variant="primary" icon={<Crop size={14} />} disabled={!s.cropRect} onClick={applyCrop}>
        Recadrer
      </Button>
    </div>
  );
}

/** Format prédéfini : recadrage centré au bon rapport, puis mise à la taille exacte. */
async function cropThenResize(width: number, height: number) {
  const s = useImageMaker.getState();
  const node = currentNode(s);
  if (!node) return;
  const rect = s.cropRect && s.cropRatio === `${width}:${height}` ? s.cropRect : cropForRatio(node.width, node.height, width / height);
  const needsCrop = rect.width !== node.width || rect.height !== node.height;
  if (needsCrop && !(await s.local({ type: "crop", ...clampRect(rect, node.width, node.height) }))) return;
  const cropped = currentNode(useImageMaker.getState());
  if (cropped && (cropped.width !== width || cropped.height !== height)) {
    await useImageMaker.getState().local({ type: "resize", width, height });
  }
  useImageMaker.getState().set({ cropRect: null });
  if (width > node.width || height > node.height) {
    const fitted = fitSize(width, height, Math.max(node.width, node.height));
    s.notify(
      "info",
      `Image agrandie au-delà de sa taille d'origine (${fitted.width} × ${fitted.height} utiles) : « Améliorer » dans Retoucher peut affiner les détails.`,
    );
  }
}

function CompareOptions() {
  const s = useImageMaker();
  const node = currentNode(s);
  const others = (s.project?.nodes ?? []).filter((n) => n.id !== node?.id);
  return (
    <div className="flex items-center gap-2">
      <Segmented
        label="Mode de comparaison"
        value={s.compare.mode === "side" ? "side" : "slider"}
        options={[
          { value: "slider", label: "Curseur" },
          { value: "side", label: "Côte à côte" },
        ]}
        onChange={(mode) => s.set({ compare: { ...s.compare, mode } })}
      />
      <Select
        label="Comparer avec"
        value={s.compare.other ?? ""}
        className="w-52"
        options={others.map((n) => ({ value: n.id, label: n.label, hint: `${n.width} × ${n.height}` }))}
        onChange={(other) => s.set({ compare: { ...s.compare, other } })}
      />
      <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => s.set({ compare: { mode: "off", other: null } })}>
        Fermer
      </Button>
    </div>
  );
}

function ZoomControls() {
  const scale = useImageMaker((s) => s.view.scale);
  const set = useImageMaker((s) => s.set);
  const zoom = (kind: "in" | "out") => set({ viewRequest: { kind, at: Date.now() } });
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <IconButton size="sm" label="Zoom arrière" shortcut="Ctrl −" onClick={() => zoom("out")}>
        <Minus size={14} />
      </IconButton>
      <button
        type="button"
        onClick={() => set({ viewRequest: { kind: "actual", at: Date.now() } })}
        className="h-7 w-14 rounded-sm text-footnote tabular-nums text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label="Taille réelle (100 %)"
      >
        {Math.round(scale * 100)} %
      </button>
      <IconButton size="sm" label="Zoom avant" shortcut="Ctrl +" onClick={() => zoom("in")}>
        <Plus size={14} />
      </IconButton>
      <IconButton size="sm" label="Ajuster à la fenêtre" shortcut="Ctrl 0" onClick={() => set({ viewRequest: { kind: "fit", at: Date.now() } })}>
        <Maximize size={14} />
      </IconButton>
    </div>
  );
}

/** Raccourcis du studio (ignorés pendant la saisie d'un texte). */
export function useStudioShortcuts(submit: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as Element).closest?.("input, textarea, [contenteditable], [role=listbox], [role=dialog]");
      const s = useImageMaker.getState();
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.key === "Enter") {
        event.preventDefault();
        submit();
        return;
      }
      if (typing) return;
      const key = event.key.toLowerCase();
      if (ctrl && key === "z") {
        event.preventDefault();
        return event.shiftKey ? redo() : undo();
      }
      if (ctrl && key === "y") {
        event.preventDefault();
        return redo();
      }
      if (ctrl && key === "a") {
        event.preventDefault();
        return s.mask?.push({ kind: "all" });
      }
      if (ctrl && key === "d") {
        event.preventDefault();
        return s.mask?.clear();
      }
      if (ctrl && event.shiftKey && key === "i") {
        event.preventDefault();
        return s.mask?.push({ kind: "invert" });
      }
      if (ctrl && key === "0") {
        event.preventDefault();
        return s.set({ viewRequest: { kind: "fit", at: Date.now() } });
      }
      if (ctrl && (key === "+" || key === "=" || key === "-")) {
        event.preventDefault();
        return s.set({ viewRequest: { kind: key === "-" ? "out" : "in", at: Date.now() } });
      }
      if (ctrl && key === "1") {
        event.preventDefault();
        return s.set({ viewRequest: { kind: "actual", at: Date.now() } });
      }
      if (ctrl || event.altKey) return;
      if (event.key === "Enter" && s.tool === "crop" && s.cropRect) {
        event.preventDefault();
        return applyCrop();
      }
      if (event.key === "Escape") {
        if (s.cropRect) return s.set({ cropRect: null });
        if (s.compare.mode !== "off") return s.set({ compare: { mode: "off", other: null } });
        return;
      }
      if (event.key === "[") return s.set({ brushSize: Math.max(2, Math.round(s.brushSize / 1.25)) });
      if (event.key === "]") return s.set({ brushSize: Math.min(2048, Math.round(s.brushSize * 1.25) + 1) });
      if (key === "k") return toggleCompare();
      const tool = TOOLS.find((t) => t.key.toLowerCase() === key);
      if (tool && currentNode(s)) {
        event.preventDefault();
        s.setTool(tool.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit]);
}
