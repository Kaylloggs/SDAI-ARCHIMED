import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { duration, ease } from "@/design-system/motion";
import { useVoiceStore } from "../store";
import { VoiceStage } from "./VoiceStage";

/**
 * Zone de contenu de l'application (à droite du menu, sous la barre de titre) : la vue s'y
 * superpose, menu et barre de titre restent utilisables.
 */
function useContentRect(active: boolean): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!active) return;
    const panel = document.querySelector<HTMLElement>("main.content-panel");
    if (!panel) {
      setRect(null);
      return;
    }
    const measure = () => setRect(panel.getBoundingClientRect());
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [active]);
  return rect;
}

/**
 * Vue de conversation plein écran, posée sur la zone de contenu. Échap la réduit ; la
 * conversation continue dans la pastille.
 */
export function VoiceLive() {
  const open = useVoiceStore((s) => s.liveOpen);
  const close = () => useVoiceStore.getState().patch({ liveOpen: false });
  const rect = useContentRect(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      // Échap ferme d'abord un menu ou une info-bulle ouverts par-dessus.
      if (event.key !== "Escape" || event.defaultPrevented || (event.target as Element).closest?.("[role=listbox]")) return;
      event.preventDefault();
      useVoiceStore.getState().patch({ liveOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Conversation vocale"
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.985 }}
          transition={{ duration: duration.base, ease: ease.emphasized }}
          style={rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : undefined}
          className={rect ? "fixed z-40 overflow-hidden rounded-[20px]" : "fixed inset-x-0 bottom-0 top-10 z-40"}
        >
          <VoiceStage variant="overlay" onClose={close} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
