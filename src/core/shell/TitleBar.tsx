import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy, PanelLeft, Search } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { useUiStore } from "@/core/stores/ui.store";
import { Kbd } from "@/design-system/primitives";

/** Résolu à l'usage : hors Tauri (preview navigateur), l'API n'existe pas. */
function appWindow() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

function WindowButton({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-10 w-[46px] items-center justify-center text-text-muted transition-colors duration-[80ms]",
        danger ? "hover:bg-danger hover:text-text" : "hover:bg-surface-2 hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const { sidebarCollapsed, setSidebarCollapsed, setPaletteOpen } = useUiStore();

  useEffect(() => {
    const win = appWindow();
    if (!win) return;
    void win.isMaximized().then(setMaximized);
    const unlisten = win.onResized(() => {
      void win.isMaximized().then(setMaximized);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-bg-subtle pl-2"
    >
      <button
        aria-label="Afficher ou masquer le menu"
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="flex size-7 items-center justify-center rounded-sm text-text-muted hover:bg-surface-2 hover:text-text"
      >
        <PanelLeft size={16} strokeWidth={1.75} />
      </button>

      <span data-tauri-drag-region className="select-none text-footnote font-medium text-text-muted">
        SDAI ARCHIMED
      </span>

      <div data-tauri-drag-region className="flex flex-1 justify-center">
        <button
          onClick={() => setPaletteOpen(true)}
          className="flex h-7 w-80 items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 text-footnote text-text-subtle transition-colors hover:border-border-strong hover:text-text-muted"
        >
          <Search size={14} strokeWidth={1.75} />
          <span className="flex-1 text-left">Rechercher une action, un module…</span>
          <Kbd>Ctrl K</Kbd>
        </button>
      </div>

      <div className="flex items-center">
        <WindowButton label="Réduire" onClick={() => void appWindow()?.minimize()}>
          <Minus size={15} strokeWidth={1.75} />
        </WindowButton>
        <WindowButton
          label={maximized ? "Restaurer" : "Agrandir"}
          onClick={() => void appWindow()?.toggleMaximize()}
        >
          {maximized ? <Copy size={13} strokeWidth={1.75} /> : <Square size={12} strokeWidth={1.75} />}
        </WindowButton>
        <WindowButton label="Fermer" danger onClick={() => void appWindow()?.close()}>
          <X size={16} strokeWidth={1.75} />
        </WindowButton>
      </div>
    </div>
  );
}
