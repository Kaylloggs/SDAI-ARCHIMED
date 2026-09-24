import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { popIn } from "@/design-system/motion";

export type PickerOption = {
  value: string;
  label: string;
  /** Précision affichée en gris à droite (zone couverte, nombre d'offres…). */
  hint?: string;
};

type Props = {
  label: string;
  options: PickerOption[];
  values: string[];
  onChange: (values: string[]) => void;
  /** Texte affiché quand rien n'est choisi. */
  placeholder?: string;
  /** Au-delà de ce nombre d'options, un champ de recherche apparaît. */
  searchFrom?: number;
  searchPlaceholder?: string;
  /** Mot employé dans le résumé : « 4 pays ». */
  unit?: string;
  disabled?: boolean;
};

/**
 * Choix multiple compact : un bouton qui résume la sélection, une liste dans un portail.
 *
 * Remplace les murs de puces — soixante-douze pays ne peuvent pas vivre dans un panneau
 * latéral. La liste est rendue hors du conteneur défilant (sinon elle serait rognée),
 * en couche L3, et se pilote entièrement au clavier.
 */
export function MultiPicker({
  label,
  options,
  values,
  onChange,
  placeholder = "Tous",
  searchFrom = 12,
  searchPlaceholder = "Rechercher…",
  unit,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  useLayoutEffect(() => {
    if (!open) return;
    setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    setQuery("");
    setHighlight(0);
  }, [open]);

  useEffect(() => {
    if (open && options.length >= searchFrom) searchRef.current?.focus();
  }, [open, options.length, searchFrom]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    // Le panneau se ferme quand la page défile, mais pas quand c'est sa propre liste.
    const onScroll = (event: Event) => {
      if (panelRef.current && event.target instanceof Node && panelRef.current.contains(event.target)) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", () => setOpen(false));
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const toggle = (value: string) => {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open && (event.key === "Enter" || event.key === " " || event.key === "ArrowDown")) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => (current + 1) % Math.max(1, visible.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => (current - 1 + visible.length) % Math.max(1, visible.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = visible[highlight];
      if (option) toggle(option.value);
    }
  };

  const chosen = options.filter((option) => values.includes(option.value));
  const summary =
    chosen.length === 0
      ? placeholder
      : chosen.length <= 2
        ? chosen.map((option) => option.label).join(", ")
        : `${chosen.length} ${unit ?? "sélectionnés"}`;

  const width = rect ? Math.max(rect.width, 240) : 240;
  const left = rect ? Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) : 0;
  const spaceBelow = rect ? window.innerHeight - rect.bottom : 0;
  const above = rect ? spaceBelow < 280 && rect.top > spaceBelow : false;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-footnote font-medium text-text-muted">{label}</span>
        {chosen.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="cursor-pointer text-caption text-text-subtle transition-colors hover:text-text"
          >
            Effacer
          </button>
        )}
      </div>

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
        className={cn(
          "flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-3 text-body-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          "border-border bg-surface-1 hover:border-border-strong",
          open && "border-accent",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className={cn("truncate", chosen.length === 0 && "text-text-subtle")}>{summary}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.75}
          className={cn("shrink-0 text-text-subtle transition-transform duration-150", open && "rotate-180")}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div
              ref={panelRef}
              variants={popIn}
              initial="hidden"
              animate="visible"
              exit="exit"
              style={{
                position: "fixed",
                left,
                top: above ? undefined : rect.bottom + 6,
                bottom: above ? window.innerHeight - rect.top + 6 : undefined,
                width,
                zIndex: 60,
              }}
              className="glass overflow-hidden rounded-lg"
            >
              {options.length >= searchFrom && (
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <Search size={14} strokeWidth={1.75} className="shrink-0 text-text-subtle" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setHighlight(0);
                    }}
                    onKeyDown={onKeyDown}
                    placeholder={searchPlaceholder}
                    className="selectable w-full bg-transparent text-body-sm outline-none placeholder:text-text-subtle"
                  />
                  {query && (
                    <button onClick={() => setQuery("")} aria-label="Effacer la recherche">
                      <X size={14} strokeWidth={1.75} className="text-text-subtle hover:text-text" />
                    </button>
                  )}
                </div>
              )}

              <div role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto p-1">
                {visible.length === 0 ? (
                  <p className="px-2 py-3 text-center text-footnote text-text-subtle">
                    Aucun résultat
                  </p>
                ) : (
                  visible.map((option, index) => {
                    const active = values.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setHighlight(index)}
                        onClick={() => toggle(option.value)}
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-body-sm transition-colors",
                          index === highlight ? "bg-surface-3 text-text" : "text-text-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-xs border transition-colors",
                            active ? "border-transparent bg-accent text-accent-fg" : "border-border",
                          )}
                        >
                          {active && <Check size={11} strokeWidth={3} />}
                        </span>
                        <span className="flex-1 truncate">{option.label}</span>
                        {option.hint && (
                          <span className="shrink-0 text-caption text-text-subtle">{option.hint}</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
