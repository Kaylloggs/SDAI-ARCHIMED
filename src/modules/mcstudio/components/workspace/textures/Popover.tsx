import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { popIn } from "@/design-system/motion";
import { focusRing } from "../../ui";

/**
 * Pastille qui ouvre un panneau flottant au-dessus d'elle (couche L3, verre) : réglages
 * rangés hors de la vue, un clic pour les voir. Échap ou un clic ailleurs ferme, le focus
 * revient à la pastille.
 */
export function Popover({
  label,
  icon,
  value,
  title,
  width = 320,
  disabled,
  children,
}: {
  /** Nom lu par les lecteurs d'écran. */
  label: string;
  icon?: ReactNode;
  /** Texte visible de la pastille. */
  value: ReactNode;
  title: string;
  width?: number;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (open) setRect(triggerRef.current?.getBoundingClientRect() ?? null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // Les menus déroulants du panneau vivent eux aussi dans un portail.
      if ((event.target as Element).closest?.("[role=listbox]")) return;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !(event.target as Element).closest?.("[role=listbox]")) {
        close();
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // Le focus entre dans le panneau à l'ouverture.
  useEffect(() => {
    if (open) requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("button, input, textarea, [tabindex]")?.focus());
  }, [open]);

  const left = rect ? Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) : 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-7 max-w-56 items-center gap-1.5 rounded-full border px-2.5 text-footnote transition-colors disabled:opacity-40",
          open ? "border-border-strong bg-surface-2 text-text" : "border-border text-text-muted hover:border-border-strong hover:text-text",
          focusRing,
        )}
      >
        {icon}
        <span className="truncate">{value}</span>
        <ChevronDown size={12} aria-hidden className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div
              ref={panelRef}
              id={id}
              role="dialog"
              aria-label={label}
              variants={popIn}
              initial="hidden"
              animate="visible"
              exit="exit"
              style={{
                position: "fixed",
                left,
                bottom: window.innerHeight - rect.top + 8,
                width,
                maxHeight: Math.max(200, rect.top - 24),
                transformOrigin: "bottom left",
              }}
              className="glass z-40 space-y-3 overflow-y-auto rounded-lg p-3"
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
