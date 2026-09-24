import { useState, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { cn } from "@/core/lib/cn";
import { joinPath } from "../lib/format";

/** Anneau de focus clavier (design.md §7.4). */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

export const inputClass = cn(
  "selectable h-8 w-full rounded-md border border-border bg-surface-1 px-3 text-body-sm text-text",
  "placeholder:text-text-subtle transition-colors hover:border-border-strong focus:border-accent",
  focusRing,
);

/** Champ avec libellé, aide et erreur reliés pour les lecteurs d'écran. */
export function Field({
  id,
  label,
  hint,
  problem,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  problem?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-footnote font-medium text-text-muted">
        {label}
      </label>
      {children}
      {problem ? (
        <p id={`${id}-problem`} role="alert" className="text-footnote text-danger">
          {problem}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-footnote text-text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Icône du mod, lue dans le projet (`assets/<modid>/icon.png`) et affichée pixel pour
 * pixel : c'est une image de jeu, pas une photo à lisser.
 */
export function ModIcon({
  root,
  modId,
  name,
  size = 40,
  version = 0,
}: {
  root: string;
  modId: string;
  name: string;
  size?: 32 | 40 | 64;
  /** Change après une régénération pour contourner le cache de l'image. */
  version?: number;
}) {
  const [failed, setFailed] = useState(false);
  const file = convertFileSrc(joinPath(root, "src", "main", "resources", "assets", modId, "icon.png"));
  const src = version > 0 ? `${file}?v=${version}` : file;
  const box = { 32: "size-8 rounded-sm", 40: "size-10 rounded-md", 64: "size-16 rounded-lg" }[size];
  if (failed) {
    return (
      <div
        aria-hidden
        className={cn(box, "flex shrink-0 items-center justify-center border border-border bg-surface-2 font-mono text-body-sm text-text-muted")}
      >
        {name.trim().charAt(0).toUpperCase() || "?"}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      className={cn(box, "shrink-0 border border-border bg-surface-2 [image-rendering:pixelated]")}
    />
  );
}

/** Ligne libellé / valeur des fiches (dashboard, récapitulatif). */
export function Fact({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-footnote text-text-subtle">{label}</dt>
      <dd className={cn("min-w-0 truncate text-right text-body-sm", mono && "selectable font-mono text-footnote")}>{children}</dd>
    </div>
  );
}

/** Interrupteur aux couleurs du thème (pas de case à cocher native, design.md §7.4). */
export function Switch({
  checked,
  onChange,
  disabled = false,
  className,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-sm px-2 text-footnote text-text-muted transition-colors hover:text-text disabled:opacity-40",
        focusRing,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
          checked ? "border-accent bg-accent" : "border-border-strong bg-surface-2",
        )}
      >
        <span
          className={cn(
            // `left-0` : sans lui, la pastille hérite du centrage du bouton.
            "absolute left-0 top-0.5 size-2.5 rounded-full transition-transform duration-[140ms]",
            checked ? "translate-x-3.5 bg-accent-fg" : "translate-x-0.5 bg-text-muted",
          )}
        />
      </span>
      {children}
    </button>
  );
}

/** Choix exclusif court (2 à 4 valeurs), navigable au clavier comme un groupe radio. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const move = (step: number) => {
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + step + options.length) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-md border border-border bg-surface-1 p-0.5"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 rounded-sm px-2.5 text-footnote tabular-nums transition-colors disabled:opacity-40",
              active ? "bg-surface-3 text-text shadow-sm" : "text-text-muted hover:text-text",
              focusRing,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Damier : la transparence d'une texture se voit. */
export function Checker({ size, children, className }: { size: number; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border",
        "bg-[repeating-conic-gradient(var(--color-surface-2)_0%_25%,var(--color-surface-1)_0%_50%)] bg-[length:12px_12px]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {children}
    </div>
  );
}

/** Texture affichée pixel pour pixel (`version` contourne le cache après une écriture). */
export function PixelImage({ path, version, size, alt = "" }: { path: string; version: number | string; size: number; alt?: string }) {
  return (
    <img
      src={`${convertFileSrc(path)}?v=${version}`}
      alt={alt}
      draggable={false}
      className="[image-rendering:pixelated]"
      style={{ width: size, height: size }}
    />
  );
}
