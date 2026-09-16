import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { duration, ease } from "@/design-system/motion";

type Props = {
  label: ReactNode;
  side?: "right" | "bottom";
  disabled?: boolean;
  children: ReactElement;
};

/**
 * Info-bulle aux tokens de l'application (l'attribut `title` affiche une bulle système).
 * S'ouvre au survol et au focus clavier ; rendue dans un portail pour ne pas être rognée.
 */
export function Tooltip({ label, side = "right", disabled = false, children }: Props) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);

  const show = () => {
    if (!disabled) setRect(anchor.current?.getBoundingClientRect() ?? null);
  };
  const hide = () => setRect(null);

  const style =
    rect && side === "right"
      ? { left: rect.right + 10, top: rect.top + rect.height / 2, translateY: "-50%" }
      : rect
        ? { left: rect.left + rect.width / 2, top: rect.bottom + 8, translateX: "-50%" }
        : undefined;

  return (
    <span
      ref={anchor}
      className="contents"
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {createPortal(
        <AnimatePresence>
          {rect && style && (
            <motion.span
              role="tooltip"
              initial={{ opacity: 0, x: side === "right" ? -4 : 0, y: side === "bottom" ? -4 : 0 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: duration.fast, ease: ease.emphasized }}
              style={{ position: "fixed", ...style }}
              className="glass pointer-events-none z-50 whitespace-nowrap rounded-sm px-2 py-1 text-footnote text-text"
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  );
}
