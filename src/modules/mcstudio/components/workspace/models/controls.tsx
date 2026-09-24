import { useEffect, useId, useState, type ReactNode } from "react";
import { Check, Loader2, Save } from "lucide-react";
import { Button } from "@/design-system/primitives";
import {
  Brush,
  Eraser,
  Minus,
  MousePointer2,
  PaintBucket,
  Pipette,
  Plus,
  Redo2,
  Undo2,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { BRUSH_SIZES, fromHex, toHex, type Rgba } from "../../../lib/pixels";
import { focusRing } from "../../ui";
import type { PaintTool, StudioMode } from "./useStudio";

const AXES = ["X", "Y", "Z"] as const;

/** Nombre modifiable : saisie libre, validée à la sortie du champ ou avec Entrée. */
export function NumberInput({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  disabled,
  className,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(Math.round(value * 1000) / 1000)), [value]);
  const commit = () => {
    const parsed = Number(text.replace(",", "."));
    if (!Number.isFinite(parsed)) return setText(String(value));
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    if (clamped !== value) onChange(clamped);
    setText(String(clamped));
  };
  return (
    <input
      aria-label={label}
      title={label}
      inputMode="decimal"
      value={text}
      disabled={disabled}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const delta = (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? step * 4 : step);
          const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value + delta));
          onChange(Math.round(next * 1000) / 1000);
        }
      }}
      className={cn(
        "selectable h-7 w-full min-w-0 rounded-sm border border-border bg-surface-1 px-1.5 text-right text-caption tabular-nums text-text",
        "transition-colors hover:border-border-strong focus:border-accent disabled:opacity-40",
        focusRing,
        className,
      )}
    />
  );
}

/** Trois nombres (X, Y, Z) sous un libellé. */
export function Vec3Input({
  label,
  value,
  onChange,
  step = 1,
  min,
  disabled,
}: {
  label: string;
  value: [number, number, number];
  onChange: (value: [number, number, number]) => void;
  step?: number;
  min?: number;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="space-y-1">
      <p id={id} className="text-caption text-text-subtle">
        {label}
      </p>
      <div className="grid grid-cols-3 gap-1">
        {AXES.map((axis, i) => (
          <label key={axis} className="flex items-center gap-1">
            <span aria-hidden className="w-2 text-caption text-text-subtle">
              {axis}
            </span>
            <NumberInput
              label={`${label} ${axis}`}
              value={value[i]!}
              step={step}
              min={min}
              disabled={disabled}
              onChange={(next) => {
                const copy = [...value] as [number, number, number];
                copy[i] = next;
                onChange(copy);
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/** Section du panneau de droite. */
export function PanelSection({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2 border-b border-border px-3 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-caption font-semibold uppercase tracking-[0.04em] text-text-subtle">{title}</h3>
        {actions && <div className="flex items-center gap-0.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function IconButton({
  label,
  onClick,
  disabled,
  pressed,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  danger?: boolean;
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
        "flex size-7 shrink-0 items-center justify-center rounded-sm transition-colors disabled:opacity-40",
        pressed
          ? "bg-accent-soft text-accent"
          : danger
            ? "text-text-subtle hover:bg-danger-soft hover:text-danger"
            : "text-text-muted hover:bg-surface-2 hover:text-text",
        focusRing,
      )}
    >
      {children}
    </button>
  );
}

const TOOLS: { value: PaintTool; label: string; Icon: typeof Brush }[] = [
  { value: "pencil", label: "Crayon", Icon: Brush },
  { value: "eraser", label: "Gomme", Icon: Eraser },
  { value: "fill", label: "Remplissage", Icon: PaintBucket },
  { value: "picker", label: "Pipette", Icon: Pipette },
];

/**
 * Barre de l'atelier 3D : sélection ou peinture, outils de peinture, couleur, taille du
 * pinceau, annuler / rétablir, et les actions propres au modèle (`children`).
 */
export function StudioToolbar({
  mode,
  onMode,
  tool,
  onTool,
  color,
  onColor,
  brush,
  onBrush,
  canPaint,
  history,
  onUndo,
  onRedo,
  children,
}: {
  mode: StudioMode;
  onMode: (mode: StudioMode) => void;
  tool: PaintTool;
  onTool: (tool: PaintTool) => void;
  color: Rgba;
  onColor: (color: Rgba) => void;
  brush: number;
  onBrush: (size: number) => void;
  /** Une texture du mod est là pour être peinte. */
  canPaint: boolean;
  history: { undo: number; redo: number };
  onUndo: () => void;
  onRedo: () => void;
  children?: ReactNode;
}) {
  const [hex, setHex] = useState(toHex(color));
  useEffect(() => setHex(toHex(color)), [color]);
  const index = BRUSH_SIZES.indexOf(brush as (typeof BRUSH_SIZES)[number]);
  const step = (delta: number) => onBrush(BRUSH_SIZES[Math.max(0, Math.min(BRUSH_SIZES.length - 1, index + delta))] ?? brush);
  const painting = mode === "paint";
  return (
    <div role="toolbar" aria-label="Outils de l'atelier 3D" className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1">
      <IconButton label="Sélection : cliquer un cube (V)" pressed={!painting} onClick={() => onMode("select")}>
        <MousePointer2 size={15} strokeWidth={1.75} />
      </IconButton>
      <span aria-hidden className="mx-1 h-5 w-px bg-border" />
      {TOOLS.map(({ value, label, Icon }) => (
        <IconButton
          key={value}
          label={canPaint ? `${label} : peindre sur le modèle` : `${label} (créez d'abord la texture)`}
          pressed={painting && tool === value}
          disabled={!canPaint}
          onClick={() => {
            onTool(value);
            onMode("paint");
          }}
        >
          <Icon size={15} strokeWidth={1.75} />
        </IconButton>
      ))}
      <label
        className={cn("ml-1 flex items-center gap-1.5", !canPaint && "opacity-40")}
        title="Couleur du crayon et du remplissage"
      >
        <span
          aria-hidden
          className="size-6 shrink-0 rounded-sm border border-border-strong"
          style={{ backgroundColor: `rgba(${color.join(",")})` }}
        />
        <input
          aria-label="Couleur en hexadécimal"
          value={hex}
          spellCheck={false}
          disabled={!canPaint}
          onChange={(event) => {
            setHex(event.target.value);
            const parsed = fromHex(event.target.value);
            if (parsed) onColor(parsed);
          }}
          onBlur={() => setHex(toHex(color))}
          className={cn(
            "selectable h-7 w-[84px] rounded-sm border border-border bg-surface-1 px-1.5 font-mono text-caption uppercase text-text",
            focusRing,
          )}
        />
      </label>
      <span role="group" aria-label="Taille du pinceau" className={cn("ml-1 flex items-center", !canPaint && "opacity-40")}>
        <IconButton label="Pinceau plus petit" disabled={!canPaint || index <= 0} onClick={() => step(-1)}>
          <Minus size={13} />
        </IconButton>
        <span className="min-w-9 text-center text-caption tabular-nums text-text-muted">{brush} px</span>
        <IconButton label="Pinceau plus grand" disabled={!canPaint || index >= BRUSH_SIZES.length - 1} onClick={() => step(1)}>
          <Plus size={13} />
        </IconButton>
      </span>
      <span aria-hidden className="mx-1 h-5 w-px bg-border" />
      <IconButton label="Annuler (Ctrl+Z)" disabled={history.undo === 0} onClick={onUndo}>
        <Undo2 size={15} strokeWidth={1.75} />
      </IconButton>
      <IconButton label="Rétablir (Ctrl+Y)" disabled={history.redo === 0} onClick={onRedo}>
        <Redo2 size={15} strokeWidth={1.75} />
      </IconButton>
      {children && <span className="ml-auto flex items-center gap-1">{children}</span>}
    </div>
  );
}

/** En-tête d'un éditeur 3D : nom, fichier, état d'enregistrement, actions. */
export function StudioHeader({
  title,
  subtitle,
  dirty,
  saving,
  notice,
  onSave,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  dirty: boolean;
  saving: boolean;
  notice: string | null;
  onSave: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-1.5">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-body font-semibold">{title}</h2>
        <p className="selectable truncate text-caption text-text-subtle">{subtitle}</p>
      </div>
      <span aria-live="polite" className={cn("flex items-center gap-1 text-caption", notice ? "text-success" : "text-text-subtle")}>
        {notice ? (
          <>
            <Check size={12} aria-hidden /> {notice}
          </>
        ) : dirty ? (
          "Modifications non enregistrées"
        ) : null}
      </span>
      {children}
      <Button
        type="button"
        size="sm"
        variant="primary"
        disabled={!dirty || saving}
        onClick={onSave}
        title="Enregistrer (Ctrl+S)"
        icon={saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
      >
        Enregistrer
      </Button>
    </header>
  );
}
