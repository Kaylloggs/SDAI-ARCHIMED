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
