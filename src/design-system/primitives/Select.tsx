import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { popIn } from "@/design-system/motion";

export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Icône affichée à gauche du libellé. */
  icon?: React.ReactNode;
  label: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  placeholder?: string;
};

/**
 * Menu déroulant maison : un `<select>` natif affiche ses options avec le thème
 * du système, ce qui casse le design system (design.md §7.4). Ce composant rend
 * la liste dans un portail, aux tokens de l'application, et reste utilisable au clavier.
 */
export function Select({
  value,
  options,
  onChange,
  icon,
  label,
  disabled,
  title,
  className,
  placeholder = "Choisir…",
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!open) return;
    setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    setHighlight(Math.max(0, options.findIndex((option) => option.value === value)));
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !listRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onScrollOrResize = () => setOpen(false);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open]);

  const commit = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const move = (delta: number) => {
    if (options.length === 0) return;
    let next = highlight;
    for (let step = 0; step < options.length; step += 1) {
      next = (next + delta + options.length) % options.length;
      if (!options[next]?.disabled) break;
    }
    setHighlight(next);
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
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(highlight);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        title={title ?? label}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface-1 px-2 text-footnote text-text",
          "transition-colors duration-[80ms] hover:border-border-strong disabled:opacity-60",
          open && "border-border-strong",
          className,
        )}
      >
        {icon}
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={12}
          strokeWidth={1.75}
          className={cn("shrink-0 text-text-subtle transition-transform", open && "rotate-180")}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={label}
              variants={popIn}
              initial="hidden"
              animate="visible"
              exit="exit"
              style={{
                position: "fixed",
                left: Math.min(rect.left, window.innerWidth - 280),
                top:
                  rect.bottom + 260 > window.innerHeight
                    ? Math.max(8, rect.top - 264)
                    : rect.bottom + 6,
                minWidth: Math.max(rect.width, 200),
                transformOrigin: "top left",
              }}
              className="glass z-50 max-h-64 overflow-y-auto rounded-md p-1"
            >
              {options.map((option, index) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    role="option"
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => commit(index)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-footnote transition-colors",
                      option.disabled
                        ? "cursor-not-allowed text-text-subtle opacity-60"
                        : "text-text-muted",
                      index === highlight && !option.disabled && "bg-surface-2 text-text",
                    )}
                  >
                    <Check
                      size={12}
                      strokeWidth={2}
                      className={cn("shrink-0 text-accent", !isSelected && "opacity-0")}
                    />
                    <span className="truncate">{option.label}</span>
                    {option.hint && (
                      <span className="ml-auto shrink-0 text-caption text-text-subtle">
                        {option.hint}
                      </span>
                    )}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
