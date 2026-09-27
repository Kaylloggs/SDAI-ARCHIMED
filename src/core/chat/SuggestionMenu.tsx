import { useEffect, useRef } from "react";
import { cn } from "@/core/lib/cn";

export type Suggestion = {
  id: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  /** Petit badge à droite (« ARCHIMED », « CLI »…). */
  badge?: string;
};

/**
 * Liste de suggestions au-dessus de la zone de saisie (commandes `/`, fichiers `@`). Le clavier
 * reste dans la zone de saisie : ↑ ↓ pour choisir, Entrée ou Tab pour valider, Échap pour fermer.
 */
export function SuggestionMenu({
  title,
  items,
  active,
  onPick,
  onHover,
  empty,
}: {
  title: string;
  items: Suggestion[];
  active: number;
  onPick: (item: Suggestion) => void;
  onHover: (index: number) => void;
  empty?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    refs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      role="listbox"
      aria-label={title}
      className="glass absolute bottom-full left-0 right-0 z-20 mb-2 max-h-72 overflow-y-auto rounded-lg p-1"
    >
      <p className="px-2 pb-1 pt-1.5 text-caption font-medium text-text-subtle">{title}</p>
      {items.length === 0 ? (
        <p className="px-2 py-2 text-footnote text-text-subtle">{empty ?? "Aucun résultat"}</p>
      ) : (
        items.map((item, index) => (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="option"
            aria-selected={index === active}
            // mousedown : la zone de saisie garde le focus.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(item);
            }}
            onMouseEnter={() => onHover(index)}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left",
              index === active ? "bg-surface-3" : "hover:bg-surface-2",
            )}
          >
            {item.icon && <span className="shrink-0 text-text-subtle">{item.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-footnote text-text">{item.label}</span>
              {item.hint && <span className="block truncate text-caption text-text-subtle">{item.hint}</span>}
            </span>
            {item.badge && <span className="shrink-0 text-caption text-text-subtle">{item.badge}</span>}
          </button>
        ))
      )}
    </div>
  );
}
