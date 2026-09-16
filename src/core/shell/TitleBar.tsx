import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy, Search } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Slot } from "@/core/modules";
import { useEnabledModules } from "@/core/modules/useModules";
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
        "flex size-8 items-center justify-center rounded-full text-text-muted transition-colors duration-[80ms]",
        danger ? "hover:bg-danger hover:text-text" : "hover:bg-surface-2 hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

/** Barre de titre intégrée au cadre : titre du module, recherche, indicateurs, fenêtre. */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const { activeModuleId, setPaletteOpen } = useUiStore();
  const active = useEnabledModules().find((m) => m.id === activeModuleId);

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
    <div data-tauri-drag-region className="flex h-10 shrink-0 items-center gap-3 pl-2">
      <span data-tauri-drag-region className="min-w-0 truncate text-body-sm font-semibold">
        {active?.name ?? "SDAI ARCHIMED"}
      </span>

      <div data-tauri-drag-region className="flex flex-1 justify-center">
        <button
          onClick={() => setPaletteOpen(true)}
          className="glass-chrome flex h-8 w-80 items-center gap-2 rounded-full px-3 text-footnote text-text-subtle transition-colors hover:text-text-muted"
        >
          <Search size={14} strokeWidth={1.75} />
          <span className="flex-1 text-left">Rechercher une action, un module…</span>
          <Kbd>Ctrl K</Kbd>
        </button>
      </div>

      <div className="flex items-center gap-2 text-caption text-text-subtle">
        <Slot name="statusbar.items" />
      </div>

      <div className="glass-chrome flex items-center gap-0.5 rounded-full p-0.5">
        <WindowButton label="Réduire" onClick={() => void appWindow()?.minimize()}>
          <Minus size={14} strokeWidth={1.75} />
        </WindowButton>
        <WindowButton
          label={maximized ? "Restaurer" : "Agrandir"}
          onClick={() => void appWindow()?.toggleMaximize()}
        >
          {maximized ? <Copy size={12} strokeWidth={1.75} /> : <Square size={11} strokeWidth={1.75} />}
        </WindowButton>
        <WindowButton label="Fermer" danger onClick={() => void appWindow()?.close()}>
          <X size={15} strokeWidth={1.75} />
        </WindowButton>
      </div>
    </div>
  );
}
