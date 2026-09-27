import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useUiStore } from "@/core/stores/ui.store";
import { spring } from "@/design-system/motion";
import { ResizeHandle, usePanelSize } from "@/design-system/primitives";

/** Vue debug : sortie brute de la CLI. Cachée par défaut (design.md §7.2). */
export function RawTerminalDrawer({ raw }: { raw: string }) {
  const { rawTerminalOpen, toggleRawTerminal } = useUiStore();
  const scroller = useRef<HTMLPreElement>(null);
  const [height, setHeight] = usePanelSize("chat.raw", 220, 120, 640);

  // Suit la sortie : toujours afficher les dernières lignes reçues.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [raw, rawTerminalOpen]);

  return (
    <AnimatePresence>
      {rawTerminalOpen && (
        <ResizeHandle
          key="handle"
          size={height}
          onResize={setHeight}
          panel="after"
          orientation="horizontal"
          label="Hauteur du terminal brut"
          defaultSize={220}
        />
      )}
      {rawTerminalOpen && (
        <motion.aside
          key="drawer"
          initial={{ height, opacity: 0 }}
          animate={{ height, opacity: 1 }}
          exit={{ height: 0, opacity: 0, transition: spring.gentle }}
          // La hauteur suit la poignée sans ressort ; seule la fermeture est animée.
          transition={{ ...spring.gentle, height: { duration: 0 } }}
          className="flex shrink-0 flex-col overflow-hidden border-t border-border bg-bg-subtle"
        >
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-3">
            <span className="text-caption text-text-subtle">Sortie brute</span>
            <button
              onClick={toggleRawTerminal}
              aria-label="Fermer le terminal brut"
              className="text-text-subtle hover:text-text"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
          <pre ref={scroller} className="selectable min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-caption leading-4 text-text-muted">
            {raw || "(aucune sortie pour l'instant — envoyez un message à l'agent)"}
          </pre>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
