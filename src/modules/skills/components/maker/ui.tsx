import type { ReactNode } from "react";
import { cn } from "@/core/lib/cn";

/** Anneau de focus clavier (design.md §7.4). */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

export const inputClass = cn(
  "selectable h-8 w-full rounded-md border border-border bg-surface-1 px-3 text-body-sm text-text",
  "placeholder:text-text-subtle transition-colors hover:border-border-strong focus:border-accent",
  focusRing,
);

export const textareaClass = cn(
  "selectable w-full resize-none rounded-md border border-border bg-surface-1 px-3 py-2 text-body-sm text-text",
  "placeholder:text-text-subtle transition-colors hover:border-border-strong focus:border-accent",
  focusRing,
);

/** Libellé de champ : discret, sans majuscules forcées. */
export function Label({ htmlFor, children, aside }: { htmlFor?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={htmlFor} className="text-footnote font-medium text-text-muted">
        {children}
      </label>
      {aside}
    </div>
  );
}

/** Choix exclusif compact (onglets, langue). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  stretch = true,
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode; count?: number }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
  /** Options de même largeur sur toute la ligne ; sinon à la taille du texte. */
  stretch?: boolean;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("flex items-center gap-0.5 rounded-sm border border-border bg-surface-1 p-0.5", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex h-6 items-center justify-center gap-1.5 rounded-xs px-2 text-footnote transition-colors",
            stretch ? "min-w-0 flex-1" : "shrink-0",
            focusRing,
            value === option.value ? "bg-surface-3 font-medium text-text" : "text-text-muted hover:text-text",
          )}
        >
          {option.icon}
          <span className="truncate">{option.label}</span>
          {option.count !== undefined && option.count > 0 && (
            <span className="shrink-0 rounded-xs bg-surface-2 px-1 font-mono text-caption tabular-nums text-text-subtle">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}
