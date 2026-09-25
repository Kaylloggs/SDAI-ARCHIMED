import { useEffect, useState } from "react";
import { Check, Copy, FileCode2, Terminal } from "lucide-react";
import { cn } from "@/core/lib/cn";

/** Commande à taper (terminal) ou extrait de fichier (code) : c'est la première ligne qui le dit. */
export function isCommand(code: string): boolean {
  return /^(pnpm|git|cd|npm|cargo|\.\\)/.test(code.trimStart());
}

/** Extrait à copier, pour les tutoriels techniques (créer un module). */
export function CodeSample({ code }: { code: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const command = isCommand(code);
  const Icon = command ? Terminal : FileCode2;

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = () => {
    navigator.clipboard
      .writeText(code)
      .then(() => setState("copied"))
      .catch(() => setState("failed"));
  };

  return (
    <figure className="w-full overflow-hidden rounded-[20px] border border-border bg-bg">
      <figcaption className="flex h-10 items-center justify-between border-b border-border pl-4 pr-2">
        <span className="flex items-center gap-2 text-footnote text-text-subtle">
          <Icon size={14} strokeWidth={1.75} />
          {command ? "Terminal (PowerShell)" : "Extrait de code"}
        </span>
        <button
          type="button"
          onClick={copy}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-sm px-2 text-footnote transition-colors duration-[80ms]",
            state === "copied" ? "text-success" : "text-text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          {state === "copied" ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
          {state === "copied" ? "Copié" : state === "failed" ? "Copie impossible" : "Copier"}
        </button>
      </figcaption>
      <pre className="px-5 py-4 font-mono text-body-sm leading-6 text-text">
        <code>
          {code.split("\n").map((line, i) => (
            // Les lignes longues (une URL) passent à la ligne sous leur début, sans barre de défilement.
            <span key={i} className="flex">
              {command && <span className="shrink-0 select-none pr-3 text-text-subtle">›</span>}
              <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{line}</span>
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}
