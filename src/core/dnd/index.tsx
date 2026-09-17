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
import { AnimatePresence, motion, useSpring, useTransform } from "motion/react";
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
  /** Texte de l'étiquette qui suit le pointeur (aperçu par défaut). */
  label: string;
  /** Aperçu riche affiché sous le pointeur (ex. la carte elle-même). */
  preview?: ReactNode;
};

/** Géométrie de l'élément saisi : l'aperçu garde sa taille et reste sous le doigt. */
type Grab = { width: number; height: number; offsetX: number; offsetY: number };

type DndState = {
  item: DragItem | null;
  grab: Grab | null;
  x: number;
  y: number;
  overId: string | null;
};

const useDndStore = create<DndState>(() => ({ item: null, grab: null, x: 0, y: 0, overId: null }));

/** `true` pendant qu'un élément précis est déplacé (pour l'estomper à sa place d'origine). */
export function useIsDragging(type: string, payload: string): boolean {
  return useDndStore((state) => state.item?.type === type && state.item.payload === payload);
}

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
    const box = event.currentTarget.getBoundingClientRect();
    const grab: Grab = {
      width: box.width,
      height: box.height,
      offsetX: startX - box.left,
      offsetY: startY - box.top,
    };
    let dragging = false;

    const move = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
        dragging = true;
        document.body.classList.add("dnd-active");
        window.getSelection()?.removeAllRanges();
      }
      e.preventDefault();
      useDndStore.setState({
        item: current,
        grab,
        x: e.clientX,
        y: e.clientY,
        overId: targetAt(e.clientX, e.clientY, current),
      });
    };

    const end = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!dragging) return;
      document.body.classList.remove("dnd-active");
      const id = e.type === "pointerup" ? targetAt(e.clientX, e.clientY, current) : null;
      useDndStore.setState({ item: null, grab: null, overId: null });
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

/**
 * Aperçu qui suit le pointeur pendant un glisser (monté une fois par le shell).
 * Ressort léger : l'aperçu traîne un peu derrière le doigt, s'incline et grossit
 * légèrement au-dessus d'une cible valide.
 */
export function DragLayer() {
  const item = useDndStore((state) => state.item);
  const grab = useDndStore((state) => state.grab);
  const over = useDndStore((state) => state.overId !== null);
  const x = useDndStore((state) => state.x);
  const y = useDndStore((state) => state.y);

  const springX = useSpring(0, { stiffness: 900, damping: 45, mass: 0.35 });
  const springY = useSpring(0, { stiffness: 900, damping: 45, mass: 0.35 });
  const lastX = useRef(0);
  // L'inclinaison suit la vitesse horizontale : la carte « penche » dans le sens du geste.
  const tilt = useTransform(springX, (value) => `${Math.max(-6, Math.min(6, (value - lastX.current) * 0.4))}deg`);

  useEffect(() => {
    if (!item || !grab) return;
    lastX.current = springX.get();
    springX.set(x - grab.offsetX);
    springY.set(y - grab.offsetY);
  }, [item, grab, x, y, springX, springY]);

  useEffect(() => {
    if (item || !grab) return;
    springX.jump(0);
    springY.jump(0);
  }, [item, grab, springX, springY]);

  return createPortal(
    <AnimatePresence>
      {item && grab && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: over ? 1.04 : 1.01 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            x: springX,
            y: springY,
            rotate: tilt,
            width: grab.width,
            zIndex: 80,
            pointerEvents: "none",
          }}
          className="origin-center drop-shadow-[0_18px_30px_rgba(0,0,0,0.45)]"
        >
          {item.preview ?? (
            <div className="glass max-w-64 truncate rounded-sm px-2 py-1 text-footnote text-text">{item.label}</div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
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
