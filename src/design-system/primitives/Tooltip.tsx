import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { duration, ease } from "@/design-system/motion";

type Props = {
  label: ReactNode;
  side?: "right" | "bottom" | "top";
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
    if (disabled) return;
    // L'ancre est en `display: contents` (aucune boîte) : on mesure l'élément enveloppé.
    const target = anchor.current?.firstElementChild ?? anchor.current;
    const box = target?.getBoundingClientRect();
    setRect(box && (box.width > 0 || box.height > 0) ? box : null);
  };
  const hide = () => setRect(null);

  // Positionnement sur un conteneur fixe ; l'animation (x/y) vit sur l'enfant :
  // motion fusionne translateY et y, les mettre sur le même élément annule le centrage.
  const position =
    rect && side === "right"
      ? { left: rect.right + 10, top: rect.top + rect.height / 2, transform: "translateY(-50%)" }
      : rect && side === "top"
        ? { left: rect.left + rect.width / 2, top: rect.top - 8, transform: "translate(-50%, -100%)" }
        : rect
          ? { left: rect.left + rect.width / 2, top: rect.bottom + 8, transform: "translateX(-50%)" }
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
          {rect && position && (
            <span style={{ position: "fixed", zIndex: 50, pointerEvents: "none", ...position }}>
              <motion.span
                role="tooltip"
                initial={{ opacity: 0, x: side === "right" ? -4 : 0, y: side === "bottom" ? -4 : side === "top" ? 4 : 0 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: duration.fast, ease: ease.emphasized }}
                className="glass block whitespace-nowrap rounded-sm px-2 py-1 text-footnote text-text"
              >
                {label}
              </motion.span>
            </span>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  );
}
