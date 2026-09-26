import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { popIn } from "@/design-system/motion";

type Props = {
  /** Nom lu par les lecteurs d'écran (bouton et panneau). */
  label: string;
  /** Texte visible du bouton. */
  value: ReactNode;
  icon?: ReactNode;
  title?: string;
  /** Largeur du panneau, en px. */
  width?: number;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * Bouton compact qui ouvre un panneau flottant (couche L3, verre) : un réglage rangé hors de
 * la vue, visible d'un clic. Même allure que `Select`. Le panneau s'ouvre au-dessus du bouton
 * s'il manque de place en dessous ; Échap ou un clic ailleurs le ferme et le focus revient au
 * bouton.
 */
export function Popover({ label, value, icon, title, width = 280, disabled, className, children }: Props) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useLayoutEffect(() => {
    if (open) setRect(triggerRef.current?.getBoundingClientRect() ?? null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const inside = (target: EventTarget | null) =>
      target instanceof Node && (triggerRef.current?.contains(target) || panelRef.current?.contains(target));
    const onPointerDown = (event: PointerEvent) => {
      // Un menu déroulant ouvert depuis le panneau vit lui aussi dans un portail.
      if ((event.target as Element).closest?.("[role=listbox]")) return;
      if (!inside(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (event.target as Element).closest?.("[role=listbox]")) return;
      event.preventDefault();
      close();
      triggerRef.current?.focus();
    };
    const onScroll = (event: Event) => {
      if (!inside(event.target)) close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // Le focus entre dans le panneau à l'ouverture.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLElement>("button, input, textarea, [tabindex]:not([tabindex='-1'])")?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const spaceBelow = rect ? window.innerHeight - rect.bottom : 0;
  const spaceAbove = rect ? rect.top : 0;
  const openAbove = rect ? spaceBelow < 240 && spaceAbove > spaceBelow : false;
  const left = rect ? Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) : 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={title ?? label}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface-1 px-2 text-footnote text-text",
          "transition-colors duration-[80ms] hover:border-border-strong disabled:opacity-60",
          open && "border-border-strong",
          className,
        )}
      >
        {icon}
        <span className="truncate">{value}</span>
        <ChevronDown
          size={12}
          strokeWidth={1.75}
          aria-hidden
          className={cn("shrink-0 text-text-subtle transition-transform", open && "rotate-180")}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label={label}
              variants={popIn}
              initial="hidden"
              animate="visible"
              exit="exit"
              style={{
                position: "fixed",
                left,
                width,
                ...(openAbove
                  ? { bottom: Math.max(8, window.innerHeight - rect.top + 6), transformOrigin: "bottom left" }
                  : { top: rect.bottom + 6, transformOrigin: "top left" }),
              }}
              className="glass z-50 rounded-md p-3"
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
