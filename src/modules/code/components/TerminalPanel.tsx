import { useEffect, useMemo, useRef } from "react";
import { ChevronDown, Eraser, Plus, SquareTerminal, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { cn } from "@/core/lib/cn";
import { Tooltip } from "@/design-system/primitives";
import {
  activateTerminal,
  attachTerminal,
  clearTerminal,
  closeTerminal,
  createTerminal,
  fitTerminal,
  focusTerminal,
  refreshTerminalThemes,
  useTerminals,
  type TerminalTab,
} from "../terminal/sessions";

type Props = {
  root: string;
  onHide: () => void;
};

/**
 * Terminal intégré, sous l'éditeur : PowerShell ouvert dans le dossier du projet, plusieurs
 * onglets possibles. Ce qui s'y tape part directement au shell, comme dans Windows Terminal ;
 * aucune IA n'y écrit.
 */
export function TerminalPanel({ root, onHide }: Props) {
  const allTabs = useTerminals((s) => s.tabs);
  const activeKey = useTerminals((s) => s.active[root]);
  const tabs = useMemo(() => allTabs.filter((tab) => tab.root === root), [allTabs, root]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Premier affichage dans ce projet : un terminal s'ouvre.
  useEffect(() => {
    if (!useTerminals.getState().tabs.some((tab) => tab.root === root)) createTerminal(root);
  }, [root]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activeKey) return;
    attachTerminal(activeKey, container);
    focusTerminal(activeKey);
    const observer = new ResizeObserver(() => fitTerminal(activeKey));
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeKey]);

  // Changement de preset de couleurs : les terminaux suivent.
  useEffect(() => {
    const observer = new MutationObserver(refreshTerminalThemes);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    return () => observer.disconnect();
  }, []);

  return (
    <section aria-label="Terminal" className="flex min-h-0 flex-1 flex-col bg-bg">
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        <div role="tablist" aria-label="Terminaux" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {tabs.map((tab) => (
            <TabButton
              key={tab.key}
              tab={tab}
              active={tab.key === activeKey}
              onSelect={() => activateTerminal(root, tab.key)}
              onClose={() => closeTerminal(tab.key)}
            />
          ))}
        </div>
        <Tooltip side="top" label="Nouveau terminal">
          <button
            type="button"
            aria-label="Nouveau terminal"
            onClick={() => createTerminal(root)}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-text-subtle transition-colors hover:bg-surface-2 hover:text-text"
          >
            <Plus size={14} strokeWidth={1.75} />
          </button>
        </Tooltip>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {activeKey && (
            <Tooltip side="top" label="Effacer l'écran">
              <button
                type="button"
                aria-label="Effacer l'écran du terminal"
                onClick={() => {
                  clearTerminal(activeKey);
                  focusTerminal(activeKey);
                }}
                className="flex size-6 items-center justify-center rounded-sm text-text-subtle transition-colors hover:bg-surface-2 hover:text-text"
              >
                <Eraser size={14} strokeWidth={1.75} />
              </button>
            </Tooltip>
          )}
          <Tooltip side="top" label="Masquer le terminal (Ctrl+`), il continue de tourner">
            <button
              type="button"
              aria-label="Masquer le terminal"
              onClick={onHide}
              className="flex size-6 items-center justify-center rounded-sm text-text-subtle transition-colors hover:bg-surface-2 hover:text-text"
            >
              <ChevronDown size={14} strokeWidth={1.75} />
            </button>
          </Tooltip>
        </div>
      </header>
      {tabs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="text-footnote text-text-muted">Aucun terminal ouvert.</p>
          <button
            type="button"
            onClick={() => createTerminal(root)}
            className="flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface-1 px-2 text-footnote text-text hover:border-border-strong"
          >
            <SquareTerminal size={14} strokeWidth={1.75} />
            Ouvrir un terminal
          </button>
        </div>
      ) : (
        <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden py-1 pl-2" />
      )}
    </section>
  );
}

function TabButton({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: TerminalTab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const state =
    tab.status === "error"
      ? { dot: "bg-danger", text: "erreur" }
      : tab.status === "exited"
        ? { dot: "bg-text-subtle", text: "terminé" }
        : tab.status === "starting"
          ? { dot: "bg-warning", text: "démarrage" }
          : null;
  return (
    <div
      className={cn(
        "group flex h-6 shrink-0 items-center gap-1 rounded-sm pl-2 pr-1 text-footnote transition-colors",
        active ? "bg-surface-2 text-text" : "text-text-muted hover:bg-surface-1 hover:text-text",
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onSelect}
        className="flex max-w-40 items-center gap-1.5 outline-none"
        title={state ? `${tab.title} · ${state.text}` : tab.title}
      >
        <SquareTerminal size={13} strokeWidth={1.75} aria-hidden className={active ? "text-accent" : "text-text-subtle"} />
        <span className="truncate">{tab.title}</span>
        {state && <span aria-label={state.text} className={cn("size-1.5 shrink-0 rounded-full", state.dot)} />}
      </button>
      <button
        type="button"
        aria-label={`Fermer ${tab.title}`}
        title="Fermer ce terminal (arrête ce qui y tourne)"
        onClick={onClose}
        className={cn(
          "flex size-4 items-center justify-center rounded-xs text-text-subtle transition-opacity hover:text-danger",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <X size={11} strokeWidth={2} />
      </button>
    </div>
  );
}
