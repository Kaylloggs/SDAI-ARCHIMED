import { useState } from "react";
import { CheckCircle2, ChevronDown, Circle, ListTodo, Loader2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import type { TimelineItem } from "@/core/engine/session.store";
import { latestTodos, todoProgress } from "./todos";

/**
 * Liste de tâches de l'agent (TodoWrite), au-dessus de la zone de saisie : la tâche en cours
 * et la progression en une ligne, la liste complète au clic.
 */
export function TodoPanel({ timeline, running }: { timeline: TimelineItem[]; running: boolean }) {
  const [open, setOpen] = useState(false);
  const todos = latestTodos(timeline);
  if (todos.length === 0) return null;
  const { done, total, current } = todoProgress(todos);
  const finished = done === total;

  return (
    <div className="mx-auto mb-2 w-full max-w-[var(--spacing-column)] px-6">
      <div className="rounded-lg border border-border bg-surface-1">
        <button
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
        >
          <ListTodo size={14} strokeWidth={1.75} className="shrink-0 text-text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-footnote">
            {finished ? (
              <span className="text-text-muted">Toutes les tâches sont faites</span>
            ) : current ? (
              <span className="text-text">{current.activeForm}</span>
            ) : (
              <span className="text-text-muted">Tâches prévues</span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="h-1 w-16 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${(done / total) * 100}%` }} />
            </span>
            <span className="font-mono text-caption tabular-nums text-text-subtle">
              {done}/{total}
            </span>
            <ChevronDown size={13} strokeWidth={1.75} className={cn("text-text-subtle transition-transform", open && "rotate-180")} aria-hidden />
          </span>
        </button>
        {open && (
          <ul className="max-h-56 space-y-1 overflow-y-auto border-t border-border px-3 py-2">
            {todos.map((todo, index) => (
              <li key={index} className="flex items-start gap-2 text-footnote">
                {todo.status === "completed" ? (
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden />
                ) : todo.status === "in_progress" ? (
                  <Loader2 size={13} className={cn("mt-0.5 shrink-0 text-accent", running && "animate-spin")} aria-hidden />
                ) : (
                  <Circle size={13} className="mt-0.5 shrink-0 text-text-subtle" aria-hidden />
                )}
                <span className={cn(todo.status === "completed" ? "text-text-subtle line-through" : "text-text")}>{todo.content}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
