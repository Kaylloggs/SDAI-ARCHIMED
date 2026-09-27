import { useId, type ReactNode } from "react";
import { Cloud, HardDrive } from "lucide-react";
import { cn } from "@/core/lib/cn";
import type { Location } from "../lib/privacy";

/** Interrupteur (pas de case à cocher native, design.md). */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-[140ms] disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "bg-accent" : "bg-text-subtle/45",
      )}
    >
      <span
        className={cn(
          "size-4 rounded-full bg-white shadow-sm transition-transform duration-[140ms] ease-standard",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

/** Choix exclusif court (2 à 4 options), rendu en boutons segmentés. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-sm border border-border bg-surface-1 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-6 cursor-pointer rounded-xs px-2.5 text-footnote transition-colors duration-[80ms]",
            option.value === value ? "bg-surface-3 font-medium text-text" : "text-text-muted hover:text-text",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Curseur avec sa valeur lisible. */
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  format = (v) => v.toFixed(2),
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  label: string;
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  return (
    <div className="flex w-56 shrink-0 items-center gap-2">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
      />
      <span className="w-12 shrink-0 text-right font-mono text-caption text-text-muted tabular-nums">{format(value)}</span>
    </div>
  );
}

/** Ligne de réglage : libellé et aide à gauche, contrôle à droite. */
export function Row({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-h-12 items-center gap-4 py-2.5">
      <div className="min-w-0 flex-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-body-sm text-text">
            {label}
          </label>
        ) : (
          <p className="text-body-sm text-text">{label}</p>
        )}
        {hint && <p className="max-w-[60ch] text-footnote text-text-subtle">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** Groupe de lignes séparées par un filet. */
export function Group({ title, description, children, actions }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="pb-8">
      <div className="flex items-end justify-between gap-3 pb-2">
        <div className="min-w-0">
          <h2 id={id} className="text-title-3 font-semibold">
            {title}
          </h2>
          {description && <p className="max-w-[70ch] pt-0.5 text-footnote text-text-subtle">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className="divide-y divide-border rounded-md border border-border bg-surface-1 px-4">{children}</div>
    </section>
  );
}

/** Champ texte compact aux tokens de l'application. */
export function TextInput({
  value,
  onChange,
  label,
  placeholder,
  type = "text",
  className,
  id,
  onEnter,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  type?: "text" | "password" | "url";
  className?: string;
  id?: string;
  onEnter?: () => void;
}) {
  return (
    <input
      id={id}
      type={type}
      aria-label={label}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && onEnter) onEnter();
      }}
      className={cn(
        "h-7 w-64 shrink-0 rounded-sm border border-border bg-surface-2 px-2 text-footnote text-text placeholder:text-text-subtle",
        "transition-colors duration-[80ms] hover:border-border-strong focus:border-border-strong",
        className,
      )}
    />
  );
}

/** Où se passe une étape : sur l'ordinateur ou en ligne. L'icône double la couleur. */
export function LocationTag({ location, compact }: { location: Location; compact?: boolean }) {
  const local = location === "local";
  const Icon = local ? HardDrive : Cloud;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-xs px-1.5 py-0.5 text-caption font-medium",
        local ? "bg-success-soft text-success" : "bg-info-soft text-info",
      )}
    >
      <Icon size={11} strokeWidth={2} aria-hidden />
      {compact ? (local ? "Local" : "En ligne") : local ? "Sur l'ordinateur" : "En ligne"}
    </span>
  );
}
