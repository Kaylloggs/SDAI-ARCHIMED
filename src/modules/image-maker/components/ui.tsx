import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { popIn } from "@/design-system/motion";
import { Tooltip } from "@/design-system/primitives";

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

/** Libellé de section du panneau : discret, sans majuscules forcées. */
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

/** Bouton carré à icône, avec infobulle aux couleurs du thème. */
export function IconButton({
  label,
  onClick,
  active = false,
  disabled = false,
  size = "md",
  side = "bottom",
  shortcut,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
  side?: "right" | "bottom" | "top";
  shortcut?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip
      side={side}
      label={
        shortcut ? (
          <span className="flex items-center gap-2">
            {label}
            <kbd className="rounded-xs bg-surface-3 px-1 font-mono text-caption text-text-muted">{shortcut}</kbd>
          </span>
        ) : (
          label
        )
      }
    >
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-[80ms] disabled:pointer-events-none disabled:opacity-35",
          size === "md" ? "size-8" : "size-7",
          active ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-2 hover:text-text",
          focusRing,
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** Interrupteur (pas de case à cocher native, design.md §7.4). */
export function Switch({
  checked,
  onChange,
  disabled = false,
  children,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-sm text-footnote text-text-muted transition-colors hover:text-text disabled:opacity-40",
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
            "absolute left-0 top-0.5 size-2.5 rounded-full transition-transform duration-[140ms]",
            checked ? "translate-x-3.5 bg-accent-fg" : "translate-x-0.5 bg-text-muted",
          )}
        />
      </span>
      {children}
    </button>
  );
}

/** Choix exclusif court, navigable au clavier comme un groupe radio. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  stretch = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; hint?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  stretch?: boolean;
}) {
  const enabled = options.filter((o) => !o.disabled);
  const move = (step: number) => {
    const index = enabled.findIndex((option) => option.value === value);
    const next = enabled[(index + step + enabled.length) % enabled.length];
    if (next) onChange(next.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("rounded-md border border-border bg-surface-1 p-0.5", stretch ? "flex" : "inline-flex")}
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
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 whitespace-nowrap rounded-sm px-2.5 text-footnote tabular-nums transition-colors disabled:opacity-35",
              stretch && "flex-1",
              active ? "bg-surface-3 text-text" : "text-text-muted hover:text-text",
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

/** Pastille à bascule (formats, éléments à garder…). */
export function Chip({
  active,
  onClick,
  disabled,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      aria-label={title}
      className={cn(
        "h-7 rounded-full border px-2.5 text-footnote tabular-nums transition-colors disabled:opacity-35",
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border text-text-muted hover:border-border-strong hover:text-text",
        focusRing,
      )}
    >
      {children}
    </button>
  );
}

/** Curseur aux couleurs du thème, avec sa valeur lisible. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (v) => String(v),
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  const id = useId();
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-footnote text-text-muted">
          {label}
        </label>
        <span className="text-footnote tabular-nums text-text">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{
          background: `linear-gradient(to right, var(--color-accent) ${percent}%, var(--color-surface-3) ${percent}%)`,
        }}
        className={cn(
          "h-1 w-full cursor-pointer appearance-none rounded-full disabled:opacity-40",
          "[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
          "[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border-strong [&::-webkit-slider-thumb]:bg-text",
          focusRing,
        )}
      />
    </div>
  );
}

/** Champ numérique court (largeur, hauteur, graine…). */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  placeholder,
  suffix,
  className,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  suffix?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <label htmlFor={id} className="text-footnote text-text-muted">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          inputMode="numeric"
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(event) => {
            const raw = event.target.value.replace(/[^\d]/g, "");
            if (!raw) return onChange(null);
            let next = Number(raw);
            if (max !== undefined) next = Math.min(max, next);
            onChange(next);
          }}
          onBlur={() => {
            if (value !== null && min !== undefined && value < min) onChange(min);
          }}
          className={cn(inputClass, "tabular-nums", suffix && "pr-8")}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-footnote text-text-subtle">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

/** Damier : la transparence se voit. */
export const checker =
  "bg-[repeating-conic-gradient(var(--color-surface-2)_0%_25%,var(--color-surface-1)_0%_50%)] bg-[length:16px_16px]";

/**
 * Fenêtre modale (couche L4) : voile, Échap, focus contenu, retour du focus à la fermeture.
 * Réservée aux tâches qui demandent de l'attention (connexions, export).
 */
export function Dialog({
  open,
  title,
  description,
  onClose,
  width = 560,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() =>
      panel.current?.querySelector<HTMLElement>("input, textarea, button:not([data-close]), [tabindex='0']")?.focus(),
    );
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !(event.target as Element).closest?.("[role=listbox]")) {
        event.stopPropagation();
        onClose();
      }
      if (event.key === "Tab" && panel.current) {
        const focusable = [...panel.current.querySelectorAll<HTMLElement>("button, input, textarea, [tabindex='0']")].filter(
          (el) => !el.hasAttribute("disabled"),
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onPointerDown={(event) => event.target === event.currentTarget && onClose()}
        >
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            variants={popIn}
            initial="hidden"
            animate="visible"
            exit="exit"
            style={{ width, maxWidth: "100%" }}
            className="flex max-h-[min(760px,calc(100vh-48px))] flex-col overflow-hidden rounded-xl border border-border-strong bg-surface-3 shadow-[var(--shadow-modal)]"
          >
            <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="space-y-0.5">
                <h2 id={titleId} className="text-title-3 font-semibold">
                  {title}
                </h2>
                {description && <p className="text-body-sm text-text-muted">{description}</p>}
              </div>
              <button
                type="button"
                data-close
                aria-label="Fermer"
                onClick={onClose}
                className={cn("rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text", focusRing)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
