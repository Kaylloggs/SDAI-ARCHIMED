import { useMemo, useState } from "react";
import { cn } from "@/core/lib/cn";
import { diffHunks, diffLines, diffStats } from "@/core/lib/diff";

type Props = {
  path: string;
  /** `null` : fichier créé. */
  before: string | null;
  /** `null` : fichier supprimé. */
  after: string | null;
  /** Lignes affichées avant « Afficher la suite ». */
  collapseAfter?: number;
  /** Masque l'en-tête (chemin et compteurs), quand le parent l'affiche déjà. */
  bare?: boolean;
};

/**
 * Diff unifié : blocs de modifications avec trois lignes de contexte, numéros des deux
 * côtés, lignes ajoutées et retirées aux couleurs du thème.
 */
export function DiffView({ path, before, after, collapseAfter = 40, bare = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { hunks, stats } = useMemo(() => {
    const lines = diffLines(before, after);
    return { hunks: diffHunks(lines), stats: diffStats(lines) };
  }, [before, after]);

  const total = hunks.reduce((sum, hunk) => sum + hunk.lines.length + 1, 0);
  let budget = expanded ? Number.POSITIVE_INFINITY : collapseAfter;

  return (
    <div className="space-y-2">
      {!bare && (
        <p className="flex items-center gap-2 font-mono text-footnote text-text-subtle">
          <span className="truncate">{path}</span>
          <span className="shrink-0 text-success">+{stats.added}</span>
          <span className="shrink-0 text-danger">−{stats.removed}</span>
        </p>
      )}
      {hunks.length === 0 ? (
        <p className="text-footnote text-text-subtle">Aucune différence.</p>
      ) : (
        <pre className="overflow-x-auto rounded-md bg-bg py-1 font-mono text-footnote leading-5">
          {hunks.map((hunk) => {
            if (budget <= 0) return null;
            budget -= 1;
            const shown = hunk.lines.slice(0, Math.max(0, budget));
            budget -= shown.length;
            return (
              <div key={`${hunk.beforeStart}-${hunk.afterStart}`}>
                <div className="px-3 text-text-subtle">
                  @@ −{hunk.beforeStart} +{hunk.afterStart} @@
                </div>
                {shown.map((line, index) => (
                  <div
                    key={index}
                    className={cn(
                      "flex",
                      line.kind === "added" && "bg-success-soft text-success",
                      line.kind === "removed" && "bg-danger-soft text-danger",
                    )}
                  >
                    <span aria-hidden className="w-10 shrink-0 select-none pr-2 text-right text-text-subtle">
                      {line.kind === "added" ? "" : line.before}
                    </span>
                    <span aria-hidden className="w-10 shrink-0 select-none pr-2 text-right text-text-subtle">
                      {line.kind === "removed" ? "" : line.after}
                    </span>
                    <span className="w-4 shrink-0 select-none">
                      {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
                    </span>
                    <span className="whitespace-pre pr-3">{line.text}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </pre>
      )}
      {total > collapseAfter && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-footnote text-text-subtle hover:text-text-muted"
        >
          {expanded ? "Réduire" : `Afficher la suite (${total - collapseAfter} lignes)`}
        </button>
      )}
    </div>
  );
}
