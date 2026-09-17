import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { cn } from "@/core/lib/cn";
import { duration, ease } from "@/design-system/motion";

export type ContextMenuItem =
  | {
      id: string;
      label: string;
      icon?: ReactNode;
      hint?: string;
      disabled?: boolean;
      danger?: boolean;
      onSelect: () => void;
    }
  | { id: string; separator: true };

type Props = {
  /** Position du clic (coordonnées de la fenêtre). */
  x: number;
  y: number;
  items: ContextMenuItem[];
  label: string;
  onClose: () => void;
};

const MARGIN = 8;

/**
 * Menu contextuel aux couleurs du thème (le menu natif de WebView2 ne l'est pas).
 * Clavier : flèches, Entrée, Échap. Se ferme au clic extérieur, au défilement et au redimensionnement.
 */
export function ContextMenu({ x, y, items, label, onClose }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const actionable = items.filter(
    (item): item is Extract<ContextMenuItem, { onSelect: () => void }> => !("separator" in item) && !item.disabled,
  );
  const [active, setActive] = useState(0);

  // Reste dans la fenêtre : le menu s'ouvre vers le haut ou la gauche près des bords.
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - box.width - MARGIN)),
      top: y + box.height + MARGIN > window.innerHeight ? Math.max(MARGIN, y - box.height) : y,
    });
    menu.current?.focus();
  }, [x, y]);

  useEffect(() => {
    const close = (event: Event) => {
      if (event instanceof MouseEvent && menu.current?.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("wheel", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("wheel", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

  const select = (item: Extract<ContextMenuItem, { onSelect: () => void }>) => {
    onClose();
    item.onSelect();
  };

  return createPortal(
    <motion.div
      ref={menu}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: duration.fast, ease: ease.emphasized }}
      style={{ position: "fixed", left: position.left, top: position.top, zIndex: 60, transformOrigin: "top left" }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          setActive((index) => (index + step + actionable.length) % Math.max(actionable.length, 1));
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          const item = actionable[active];
          if (item) select(item);
        }
      }}
      className="glass min-w-52 rounded-md p-1 outline-none"
    >
      {items.map((item) => {
        if ("separator" in item) {
          return <div key={item.id} role="separator" className="my-1 h-px bg-border" />;
        }
        const highlighted = actionable[active]?.id === item.id;
        return (
          <button
            key={item.id}
            role="menuitem"
            disabled={item.disabled}
            tabIndex={-1}
            onMouseEnter={() => {
              const index = actionable.findIndex((a) => a.id === item.id);
              if (index >= 0) setActive(index);
            }}
            onClick={() => select(item)}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-body-sm transition-colors disabled:opacity-40",
              highlighted && (item.danger ? "bg-danger-soft text-danger" : "bg-surface-3 text-text"),
              !highlighted && (item.danger ? "text-danger" : "text-text-muted"),
            )}
          >
            <span className="flex size-4 shrink-0 items-center justify-center text-text-subtle">{item.icon}</span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint && <span className="text-caption text-text-subtle">{item.hint}</span>}
          </button>
        );
      })}
    </motion.div>,
    document.body,
  );
}
