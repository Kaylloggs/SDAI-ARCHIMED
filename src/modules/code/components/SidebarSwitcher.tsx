import { FolderTree, Search } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Tooltip } from "@/design-system/primitives";

export type SidebarView = "files" | "search";

const VIEWS = [
  { id: "files", label: "Fichiers du projet", icon: FolderTree },
  { id: "search", label: "Rechercher dans le projet (Ctrl+Maj+F)", icon: Search },
] as const;

/** Bascule de la colonne de gauche : arborescence ou recherche dans le projet. */
export function SidebarSwitcher({ view, onChange }: { view: SidebarView; onChange: (view: SidebarView) => void }) {
  return (
    <div role="tablist" aria-label="Vue de la colonne" className="flex shrink-0 items-center gap-0.5 rounded-sm border border-border bg-surface-1 p-0.5">
      {VIEWS.map(({ id, label, icon: Icon }) => (
        <Tooltip key={id} side="bottom" label={label}>
          <button
            type="button"
            role="tab"
            aria-selected={view === id}
            aria-label={label}
            onClick={() => onChange(id)}
            className={cn(
              "flex size-6 items-center justify-center rounded-xs transition-colors",
              view === id ? "bg-surface-3 text-text" : "text-text-subtle hover:text-text",
            )}
          >
            <Icon size={14} strokeWidth={1.75} />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
