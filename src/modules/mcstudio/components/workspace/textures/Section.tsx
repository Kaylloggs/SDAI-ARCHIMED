import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { focusRing } from "../../ui";

/**
 * Section de l'inspecteur : un titre, un résumé visible quand elle est repliée, et son contenu.
 * Sans `collapsible`, elle reste ouverte.
 */
export function Section({
  title,
  summary,
  defaultOpen = true,
  collapsible = true,
  children,
}: {
  title: string;
  summary?: string | null;
  defaultOpen?: boolean;
  collapsible?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen || !collapsible);
  const id = useId();
  const shown = open || !collapsible;
  return (
    <section className="border-b border-border">
      {collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex h-11 w-full items-center gap-2 px-4 text-left transition-colors hover:bg-surface-2",
            focusRing,
          )}
        >
          <ChevronRight
            size={14}
            aria-hidden
            className={cn("shrink-0 text-text-subtle transition-transform duration-[140ms]", open && "rotate-90")}
          />
          <span className="shrink-0 text-body-sm font-medium">{title}</span>
          {!open && summary && <span className="ml-auto truncate text-caption text-text-subtle">{summary}</span>}
        </button>
      ) : (
        <h3 className="flex h-11 items-center px-4 text-body-sm font-medium">{title}</h3>
      )}
      {shown && (
        <div id={id} className="space-y-3 px-4 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}
