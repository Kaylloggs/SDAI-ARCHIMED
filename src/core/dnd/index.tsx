import {
  createElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

/**
 * Glisser-déposer interne à la fenêtre, piloté par les événements pointeur.
 *
 * Pourquoi pas le drag & drop HTML5 : sous Windows, `dragDropEnabled` (nécessaire pour déposer
 * des fichiers depuis l'Explorateur, voir `useOsFileDrop`) fait intercepter le glisser par
 * WebView2 — `dragover`/`drop` n'arrivent jamais à la page. Tout glisser interne passe donc ici.
 */
export type DragItem = {
  /** Catégorie acceptée par les cibles (ex. `file`, `planner-card`). */
  type: string;
  payload: string;
  /** Texte de l'étiquette qui suit le pointeur. */
  label: string;
};

type DndState = {
  item: DragItem | null;
  x: number;
  y: number;
  overId: string | null;
};

const useDndStore = create<DndState>(() => ({ item: null, x: 0, y: 0, overId: null }));

type Target = { accept: string[]; onDrop: (item: DragItem) => void };
const targets = new Map<string, Target>();

const THRESHOLD = 5;
const ATTRIBUTE = "data-drop-target";

function targetAt(x: number, y: number, item: DragItem): string | null {
  const element = document.elementFromPoint(x, y)?.closest(`[${ATTRIBUTE}]`);
  const id = element?.getAttribute(ATTRIBUTE) ?? null;
  const target = id ? targets.get(id) : undefined;
  return target && target.accept.includes(item.type) ? id : null;
}

/**
 * Source de glisser. `item` à `null` : élément non déplaçable.
 * Un simple clic (déplacement < 5 px) reste un clic.
 */
export function useDragSource(item: DragItem | null) {
  const itemRef = useRef(item);
  itemRef.current = item;

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    const current = itemRef.current;
    if (!current || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    const move = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
        dragging = true;
        document.body.classList.add("dnd-active");
        window.getSelection()?.removeAllRanges();
      }
      e.preventDefault();
      useDndStore.setState({ item: current, x: e.clientX, y: e.clientY, overId: targetAt(e.clientX, e.clientY, current) });
    };

    const end = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!dragging) return;
      document.body.classList.remove("dnd-active");
      const id = e.type === "pointerup" ? targetAt(e.clientX, e.clientY, current) : null;
      useDndStore.setState({ item: null, overId: null });
      if (id) targets.get(id)?.onDrop(current);
      // Le relâchement d'un glisser ne doit pas déclencher le clic de l'élément source.
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }, []);

  return { onPointerDown };
}

/** Cible de dépôt : étaler `props` sur l'élément. `isOver` quand un élément accepté la survole. */
export function useDropTarget(accept: string[], onDrop: (item: DragItem) => void) {
  const id = useId();
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const acceptKey = accept.join("|");

  useEffect(() => {
    targets.set(id, { accept: acceptKey.split("|"), onDrop: (item) => onDropRef.current(item) });
    return () => {
      targets.delete(id);
    };
  }, [id, acceptKey]);

  const isOver = useDndStore((state) => state.overId === id);
  const dragging = useDndStore((state) => state.item !== null && acceptKey.split("|").includes(state.item.type));
  return { props: { [ATTRIBUTE]: id }, isOver, dragging };
}

/** Étiquette qui suit le pointeur pendant un glisser (montée une fois par le shell). */
export function DragLayer() {
  const { item, x, y } = useDndStore();
  if (!item) return null;
  return createPortal(
    <div
      style={{ position: "fixed", left: x + 12, top: y + 12, zIndex: 80, pointerEvents: "none" }}
      className="glass max-w-64 truncate rounded-sm px-2 py-1 text-footnote text-text"
    >
      {item.label}
    </div>,
    document.body,
  );
}

type DropZoneProps = Omit<HTMLAttributes<HTMLElement>, "className" | "onDrop"> & {
  as?: "div" | "section" | "aside" | "li";
  accept: string[];
  onDrop: (item: DragItem) => void;
  className?: string | ((state: { isOver: boolean; dragging: boolean }) => string);
  children?: ReactNode;
};

/** Cible de dépôt prête à l'emploi (utile dans les listes, où un hook par élément est impossible). */
export function DropZone({ as = "div", accept, onDrop, className, children, ...rest }: DropZoneProps) {
  const { props, isOver, dragging } = useDropTarget(accept, onDrop);
  return createElement(
    as,
    { ...rest, ...props, className: typeof className === "function" ? className({ isOver, dragging }) : className },
    children,
  );
}
