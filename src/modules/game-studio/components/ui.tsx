import { useEffect, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button } from "@/design-system/primitives";
import type { Tone } from "../lib/labels";

export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

/** Contrôle segmenté (choix exclusif parmi 2 à 5 options). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-md border border-border bg-surface-1 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.hint}
          onClick={() => onChange(option.value)}
          className={cn(
            "cursor-pointer rounded-sm font-medium transition-colors duration-[80ms]",
            focusRing,
            size === "sm" ? "h-6 px-2 text-caption" : "h-7 px-3 text-footnote",
            value === option.value ? "bg-surface-3 text-text" : "text-text-muted hover:text-text",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Libellé, aide et contrôle, sur une ligne de réglage. */
export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
      <div className="min-w-0 max-w-[46ch] space-y-0.5">
        <label htmlFor={htmlFor} className="text-body-sm font-medium">
          {label}
        </label>
        {hint && <p className="text-footnote text-text-muted">{hint}</p>}
      </div>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** Groupe de réglages ou d'informations (surface L2). */
export function Group({ title, description, actions, children, className }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2", className)} aria-label={title}>
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-title-3 font-semibold">{title}</h2>
          {description && <p className="text-footnote text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="rounded-lg border border-border bg-surface-1 px-4">{children}</div>
    </section>
  );
}

/** Champ de texte aux tokens. */
export function TextInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-8 min-w-0 rounded-md border border-border bg-bg px-2.5 text-body-sm text-text placeholder:text-text-subtle",
        "focus:border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
    />
  );
}

export function TextArea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-body text-text placeholder:text-text-subtle",
        "focus:border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
    />
  );
}

/** Pastille cochable (systèmes, plateformes). */
export function Chip({ selected, onClick, children, disabled, title }: { selected: boolean; onClick: () => void; children: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-footnote transition-colors duration-[80ms]",
        focusRing,
        "disabled:cursor-not-allowed disabled:opacity-60",
        selected ? "border-transparent bg-accent-soft text-text" : "border-border text-text-muted hover:border-border-strong hover:text-text",
      )}
    >
      {selected && <Check size={12} strokeWidth={2} className="text-accent" aria-hidden />}
      {children}
    </button>
  );
}

export function ToneBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <Badge tone={tone}>{children}</Badge>;
}

/** Bouton qui demande un second clic (3 s) avant une action qui efface ou remplace. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  icon,
  size = "sm",
  disabled,
  ariaLabel,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  icon?: ReactNode;
  size?: "sm" | "md";
  disabled?: boolean;
  /** Nom lu par les lecteurs d'écran quand le bouton n'a qu'une icône. */
  ariaLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <Button
      type="button"
      size={size}
      variant={armed ? "danger" : "ghost"}
      icon={icon}
      disabled={disabled}
      aria-label={armed ? confirmLabel : (ariaLabel ?? label)}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}

/** Message d'erreur en ligne, avec fermeture. */
export function ErrorLine({ message, onClose }: { message: string | null; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md bg-danger-soft px-3 py-2 text-footnote">
      <p className="min-w-0 flex-1">{message}</p>
      {onClose && (
        <button type="button" onClick={onClose} className={cn("cursor-pointer text-text-muted hover:text-text", focusRing)} aria-label="Fermer le message">
          Fermer
        </button>
      )}
    </div>
  );
}

/** Liste à puces discrète. */
export function Bullets({ items, empty }: { items: string[]; empty?: string }) {
  if (items.length === 0) return empty ? <p className="text-footnote text-text-subtle">{empty}</p> : null;
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-body-sm text-text-muted">
          <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-text-subtle" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}
