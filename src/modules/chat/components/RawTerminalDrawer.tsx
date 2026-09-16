import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useUiStore } from "@/core/stores/ui.store";
import { spring } from "@/design-system/motion";

/** Vue debug : sortie brute de la CLI. Cachée par défaut (design.md §7.2). */
export function RawTerminalDrawer({ raw }: { raw: string }) {
  const { rawTerminalOpen, toggleRawTerminal } = useUiStore();

  return (
    <AnimatePresence>
      {rawTerminalOpen && (
        <motion.aside
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 220, opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={spring.gentle}
          className="shrink-0 overflow-hidden border-t border-border bg-bg-subtle"
        >
          <div className="flex h-8 items-center justify-between border-b border-border px-3">
            <span className="text-caption text-text-subtle">Sortie brute</span>
            <button
              onClick={toggleRawTerminal}
              aria-label="Fermer le terminal brut"
              className="text-text-subtle hover:text-text"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
          <pre className="selectable h-[188px] overflow-auto px-3 py-2 font-mono text-caption leading-4 text-text-muted">
            {raw || "(aucune sortie brute — l'adaptateur utilise un flux structuré)"}
          </pre>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
