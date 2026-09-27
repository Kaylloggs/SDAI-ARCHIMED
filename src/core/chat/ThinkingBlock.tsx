import { useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import { cn } from "@/core/lib/cn";

/**
 * Réflexion du modèle, repliée par défaut comme dans Claude Code : une ligne d'aperçu, le texte
 * complet au clic. Pendant la réflexion, la dernière phrase défile.
 */
export function ThinkingBlock({ text, done }: { text: string; done: boolean }) {
  const [open, setOpen] = useState(false);
  const clean = text.trim();
  const preview = clean.split("\n").filter(Boolean).at(done ? 0 : -1) ?? "";

  return (
    <div className="min-w-0">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex max-w-full items-center gap-1.5 text-left text-footnote text-text-subtle transition-colors hover:text-text-muted"
      >
        <Brain size={13} strokeWidth={1.75} className={cn("shrink-0", !done && "animate-pulse text-accent")} aria-hidden />
        <span className="shrink-0 font-medium">{done ? "Réflexion" : "Réflexion…"}</span>
        {!open && preview && <span className="min-w-0 truncate italic">{preview}</span>}
        <ChevronRight size={12} strokeWidth={1.75} className={cn("shrink-0 transition-transform", open && "rotate-90")} aria-hidden />
      </button>
      {open && (
        <p className="selectable mt-1.5 whitespace-pre-wrap border-l-2 border-border pl-3 text-footnote italic leading-5 text-text-muted">
          {clean}
        </p>
      )}
    </div>
  );
}
