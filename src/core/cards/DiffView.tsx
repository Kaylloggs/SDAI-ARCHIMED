import { useMemo, useState } from "react";
import { cn } from "@/core/lib/cn";

type Props = { path: string; before: string | null; after: string };

const COLLAPSE_AFTER = 20;

/** Diff ligne à ligne, volontairement simple (pas de dépendance externe). */
export function DiffView({ path, before, after }: Props) {
  const [expanded, setExpanded] = useState(false);

  const lines = useMemo(() => {
    const beforeLines = before?.split("\n") ?? [];
    const afterLines = after.split("\n");
    const removed = beforeLines.filter((line) => !afterLines.includes(line));
    const added = afterLines.filter((line) => !beforeLines.includes(line));
    return [
      ...removed.map((text) => ({ sign: "-" as const, text })),
      ...added.map((text) => ({ sign: "+" as const, text })),
    ];
  }, [before, after]);

  const visible = expanded ? lines : lines.slice(0, COLLAPSE_AFTER);

  return (
    <div className="space-y-2">
      <p className="font-mono text-footnote text-text-subtle">{path}</p>
      <pre className="overflow-x-auto rounded-md bg-bg py-2 font-mono text-footnote leading-5">
        {visible.map((line, index) => (
          <div
            key={index}
            className={cn(
              "px-3",
              line.sign === "+" ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
            )}
          >
            {line.sign} {line.text}
          </div>
        ))}
      </pre>
      {lines.length > COLLAPSE_AFTER && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-footnote text-text-subtle hover:text-text-muted"
        >
          {expanded ? "Réduire" : `Afficher les ${lines.length - COLLAPSE_AFTER} lignes restantes`}
        </button>
      )}
    </div>
  );
}
