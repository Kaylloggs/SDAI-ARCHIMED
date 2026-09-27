import type { TimelineItem } from "@/core/engine/session.store";

export type TodoStatus = "pending" | "in_progress" | "completed";
export type Todo = { content: string; status: TodoStatus; activeForm: string };

/** Liste de tâches de l'agent : la dernière mise à jour `TodoWrite` (Claude Code). */
export function latestTodos(timeline: TimelineItem[]): Todo[] {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?.kind !== "tool" || item.tool !== "TodoWrite") continue;
    const todos = (item.input as { todos?: unknown } | null)?.todos;
    if (!Array.isArray(todos)) return [];
    return todos
      .map((raw): Todo | null => {
        if (!raw || typeof raw !== "object") return null;
        const entry = raw as Record<string, unknown>;
        const content = typeof entry.content === "string" ? entry.content : "";
        if (!content.trim()) return null;
        const status = entry.status === "in_progress" || entry.status === "completed" ? entry.status : "pending";
        return { content, status, activeForm: typeof entry.activeForm === "string" && entry.activeForm ? entry.activeForm : content };
      })
      .filter((todo): todo is Todo => todo !== null);
  }
  return [];
}

export function todoProgress(todos: Todo[]): { done: number; total: number; current: Todo | null } {
  return {
    done: todos.filter((todo) => todo.status === "completed").length,
    total: todos.length,
    current: todos.find((todo) => todo.status === "in_progress") ?? null,
  };
}
