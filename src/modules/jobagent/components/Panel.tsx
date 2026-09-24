import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/core/lib/cn";

/**
 * Pièces communes aux panneaux latéraux du module.
 *
 * Elles existent pour une seule raison : tenir le rythme du design system au même
 * endroit. Échelle d'espacement (design.md §5), hauteurs de contrôle 28/32/40,
 * libellés en `footnote`, valeurs en `body-sm`, anneau de focus visible au clavier.
 */

/** Anneau de focus commun à tous les contrôles du module (design.md §7.4). */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

/** Champ de saisie : 32 px de haut, rayon `md`, bordure qui s'allume au focus. */
export const inputClass = cn(
  "selectable h-8 w-full rounded-md border border-border bg-surface-1 px-3 text-body-sm text-text",
  "placeholder:text-text-subtle transition-colors hover:border-border-strong focus:border-accent",
  focusRing,
);

/** Colonne d'un panneau : une respiration constante, du haut en bas. */
export function PanelBody({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-5 py-5">{children}</div>
  );
}

/** Bloc de réglages : un titre, une phrase d'explication, puis les contrôles. */
export function Section({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-body font-semibold text-text">{title}</h2>
          {description ? (
            <p className="text-caption leading-relaxed text-text-subtle">{description}</p>
          ) : null}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** Libellé au-dessus d'un contrôle, avec une précision facultative en dessous. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-footnote font-medium text-text-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="text-caption leading-relaxed text-text-subtle">{hint}</p> : null}
    </div>
  );
}

/** Choix unique entre deux ou trois options tenant sur une ligne. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-md bg-surface-2 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-2",
            "text-footnote font-medium transition-colors duration-[80ms] ease-standard",
            focusRing,
            value === option.value
              ? "bg-surface-1 text-text shadow-xs"
              : "text-text-subtle hover:text-text",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Case à cocher au langage visuel du module (la case native ignore le thème). */
export function CheckRow({
  checked,
  onChange,
  children,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full cursor-pointer items-start gap-3 rounded-sm py-1 text-left transition-colors",
        focusRing,
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-xs border transition-colors",
          checked ? "border-transparent bg-accent text-accent-fg" : "border-border bg-surface-1",
        )}
      >
        {checked ? <Check size={14} strokeWidth={2.5} /> : null}
      </span>
      <span className="flex-1 space-y-1">
        <span className="block text-body-sm leading-snug text-text-muted">{children}</span>
        {hint ? (
          <span className="block text-caption leading-relaxed text-text-subtle">{hint}</span>
        ) : null}
      </span>
    </button>
  );
}

/** Interrupteur, repris des réglages pour rester cohérent d'un module à l'autre. */
export function Switch({
  checked,
  onChange,
  label,
  busy,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  busy?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={busy}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors",
        focusRing,
        checked ? "bg-accent" : "bg-surface-3",
        busy && "cursor-wait opacity-60",
      )}
    >
      <span
        className={cn(
          "size-4 rounded-full bg-text shadow-sm transition-transform duration-150 ease-standard",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}
