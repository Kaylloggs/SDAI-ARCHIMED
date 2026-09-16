import { useState } from "react";
import { ChevronRight, Check, X, Loader2 } from "lucide-react";
import { cn } from "@/core/lib/cn";

type Props = { tool: string; input: unknown; output?: string; ok?: boolean };

export function ToolCallCard({ tool, input, output, ok }: Props) {
  const [open, setOpen] = useState(false);
  const running = output === undefined;
  const summary = summarize(input);

  return (
    <div className="rounded-lg border border-border bg-surface-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight
          size={14}
          strokeWidth={1.75}
          className={cn("shrink-0 text-text-subtle transition-transform", open && "rotate-90")}
        />
        <span className="font-mono text-footnote text-text-muted">{tool}</span>
        <span className="min-w-0 flex-1 truncate text-footnote text-text-subtle">{summary}</span>
        {running ? (
          <Loader2 size={13} className="animate-spin text-text-subtle" />
        ) : ok ? (
          <Check size={13} className="text-success" />
        ) : (
          <X size={13} className="text-danger" />
        )}
      </button>
      {open && (
        <div className="selectable space-y-2 border-t border-border px-3 py-2">
          <pre className="max-h-40 overflow-auto rounded-md bg-bg px-2.5 py-2 font-mono text-caption text-text-muted">
            {JSON.stringify(input, null, 2)}
          </pre>
          {output !== undefined && (
            <pre className="max-h-40 overflow-auto rounded-md bg-bg px-2.5 py-2 font-mono text-caption text-text-muted">
              {output.slice(0, 4000)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function summarize(input: unknown): string {
  if (typeof input !== "object" || input === null) return String(input ?? "");
  const record = input as Record<string, unknown>;
  for (const key of ["command", "CommandLine", "file_path", "path", "pattern", "url", "query"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return Object.keys(record).join(", ");
}
