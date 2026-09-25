import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { popIn } from "@/design-system/motion";

/**
 * Panneau flottant (couche L3, verre) ancré à un déclencheur : sous lui s'il y a la place,
 * sinon au-dessus. Échap ou un clic ailleurs ferme, le focus revient au déclencheur.
 */
export function Popover({
  trigger,
  label,
  width = 360,
  align = "start",
  children,
}: {
  trigger: (props: {
    ref: React.RefObject<HTMLButtonElement | null>;
    open: boolean;
    toggle: () => void;
    "aria-expanded": boolean;
    "aria-controls": string | undefined;
    "aria-haspopup": "dialog";
  }) => ReactNode;
  label: string;
  width?: number;
  align?: "start" | "end";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (open) setRect(triggerRef.current?.getBoundingClientRect() ?? null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (target.closest?.("[role=listbox]")) return;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !(event.target as Element).closest?.("[role=listbox]")) {
        setOpen(false);
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

  useEffect(() => {
    if (open) requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("input, button, [tabindex='0']")?.focus());
  }, [open]);

  const below = rect ? window.innerHeight - rect.bottom > Math.min(420, rect.top) : true;
  const left = rect
    ? Math.max(8, Math.min(align === "end" ? rect.right - width : rect.left, window.innerWidth - width - 8))
    : 0;

  return (
    <>
      {trigger({
        ref: triggerRef,
        open,
        toggle: () => setOpen((v) => !v),
        "aria-expanded": open,
        "aria-controls": open ? id : undefined,
        "aria-haspopup": "dialog",
      })}
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
                width,
                ...(below
                  ? { top: rect.bottom + 6, maxHeight: window.innerHeight - rect.bottom - 16 }
                  : { bottom: window.innerHeight - rect.top + 6, maxHeight: rect.top - 16 }),
                transformOrigin: below ? "top" : "bottom",
              }}
              className="glass z-40 flex flex-col overflow-hidden rounded-lg"
            >
              {children(close)}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
