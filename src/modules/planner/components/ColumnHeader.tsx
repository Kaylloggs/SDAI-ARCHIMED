import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Tooltip } from "@/design-system/primitives/Tooltip";
import type { Column } from "../types";

type Props = {
  column: Column;
  count: number;
  onRename: (title: string) => void;
  onDelete: () => void;
};

/**
 * Titre d'une colonne : double clic ou crayon pour renommer, corbeille avec confirmation
 * en deux temps (pas de `window.confirm`). Les colonnes d'un roadmap.md viennent du fichier.
 */
export function ColumnHeader({ column, count, onRename, onDelete }: Props) {
  const fromRoadmap = Boolean(column.roadmapSection);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(column.title);
  const [confirming, setConfirming] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  // La confirmation expire si l'utilisateur ne la valide pas.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== column.title) onRename(draft);
    else setDraft(column.title);
  };

  if (editing) {
    return (
      <header className="flex items-center gap-1 px-2 pb-2 pt-2.5">
        <input
          ref={input}
          value={draft}
          aria-label="Nom de la colonne"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              setDraft(column.title);
              setEditing(false);
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-sm border border-border-strong bg-surface-1 px-2 text-body-sm font-semibold outline-none"
        />
      </header>
    );
  }

  return (
    <header className="group/column flex items-center gap-2 px-3 pb-2 pt-3">
      <h2
        className="truncate text-body-sm font-semibold"
        onDoubleClick={() => !fromRoadmap && setEditing(true)}
      >
        {column.title}
      </h2>
      <span className="text-caption text-text-subtle">{count}</span>

      {!fromRoadmap && (
        <div
          className={cn(
            "ml-auto flex items-center gap-0.5 transition-opacity",
            confirming ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover/column:opacity-100",
          )}
        >
          {confirming ? (
            <>
              <button
                onClick={onDelete}
                className="flex h-6 items-center gap-1 rounded-sm bg-danger-soft px-2 text-caption font-medium text-danger hover:brightness-110"
              >
                <Check size={11} strokeWidth={2} />
                {count > 0 ? `Supprimer (${count} carte${count > 1 ? "s" : ""})` : "Supprimer"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                aria-label="Annuler la suppression"
                className="flex size-6 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text"
              >
                <X size={12} strokeWidth={1.75} />
              </button>
            </>
          ) : (
            <>
              <Tooltip label="Renommer" side="bottom">
                <button
                  onClick={() => setEditing(true)}
                  aria-label={`Renommer la colonne ${column.title}`}
                  className="flex size-6 items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text"
                >
                  <Pencil size={12} strokeWidth={1.75} />
                </button>
              </Tooltip>
              <Tooltip label="Supprimer la colonne" side="bottom">
                <button
                  onClick={() => setConfirming(true)}
                  aria-label={`Supprimer la colonne ${column.title}`}
                  className="flex size-6 items-center justify-center rounded-sm text-text-subtle hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 size={12} strokeWidth={1.75} />
                </button>
              </Tooltip>
            </>
          )}
        </div>
      )}
    </header>
  );
}
