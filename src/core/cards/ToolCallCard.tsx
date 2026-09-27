import { useMemo, useState } from "react";
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  FilePlus2,
  FileSearch,
  FileText,
  Globe,
  ListTodo,
  Loader2,
  PenLine,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { diffLines, diffStats } from "@/core/lib/diff";
import { DiffView } from "./DiffView";

type Props = { tool: string; input: unknown; output?: string; ok?: boolean };

type Edit = { path: string; before: string | null; after: string };

type View =
  | { kind: "edit"; title: string; path: string; edits: Edit[]; created: boolean }
  | { kind: "command"; title: string; command: string; description: string | null }
  | { kind: "read"; title: string; path: string; range: string | null }
  | { kind: "search"; title: string; detail: string }
  | { kind: "web"; title: string; detail: string }
  | { kind: "task"; title: string; prompt: string }
  | { kind: "todo"; title: string; todos: Array<{ content: string; status: string }> }
  | { kind: "other"; title: string; detail: string };

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
/** Couleurs ANSI d'une sortie de terminal : retirées, le rendu garde les tokens du thème. */
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

/** Ce qu'une action de l'agent veut dire, pour l'afficher comme dans Claude Code. */
export function describeTool(tool: string, input: unknown): View {
  const record = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const path = str(record.file_path) ?? str(record.path) ?? str(record.notebook_path) ?? "";
  switch (tool) {
    case "Write":
    case "write_to_file":
    case "create_file":
      return {
        kind: "edit",
        title: `Création de ${baseName(path) || "fichier"}`,
        path,
        edits: [{ path, before: null, after: str(record.content) ?? str(record.CodeContent) ?? "" }],
        created: true,
      };
    case "Edit":
    case "replace_file_content":
    case "edit_file":
      return {
        kind: "edit",
        title: `Modification de ${baseName(path) || "fichier"}`,
        path,
        edits: [{ path, before: str(record.old_string) ?? "", after: str(record.new_string) ?? "" }],
        created: false,
      };
    case "MultiEdit": {
      const edits = Array.isArray(record.edits) ? (record.edits as Array<Record<string, unknown>>) : [];
      return {
        kind: "edit",
        title: `Modification de ${baseName(path) || "fichier"}`,
        path,
        edits: edits.map((edit) => ({ path, before: str(edit.old_string) ?? "", after: str(edit.new_string) ?? "" })),
        created: false,
      };
    }
    case "Bash":
    case "PowerShell":
    case "run_command":
    case "shell": {
      const command = str(record.command) ?? str(record.CommandLine) ?? (Array.isArray(record.command) ? record.command.join(" ") : "");
      return { kind: "command", title: command.split("\n")[0] ?? command, command, description: str(record.description) };
    }
    case "Read":
    case "view_file":
    case "read_file": {
      const offset = typeof record.offset === "number" ? record.offset : null;
      const limit = typeof record.limit === "number" ? record.limit : null;
      const range = offset !== null ? `lignes ${offset}–${offset + (limit ?? 0)}` : null;
      return { kind: "read", title: `Lecture de ${baseName(path) || "fichier"}`, path, range };
    }
    case "Grep":
    case "Glob":
    case "grep_search":
    case "find_by_name": {
      const pattern = str(record.pattern) ?? str(record.Query) ?? str(record.query) ?? "";
      const where = str(record.path) ?? str(record.glob) ?? "";
      return { kind: "search", title: `Recherche « ${pattern} »`, detail: where };
    }
    case "WebFetch":
    case "WebSearch":
    case "read_url_content":
    case "search_web": {
      const target = str(record.url) ?? str(record.query) ?? str(record.Url) ?? "";
      return { kind: "web", title: tool === "WebSearch" || tool === "search_web" ? `Recherche web « ${target} »` : target, detail: str(record.prompt) ?? "" };
    }
    case "Task":
    case "Agent":
      return { kind: "task", title: str(record.description) ?? "Sous-agent", prompt: str(record.prompt) ?? "" };
    case "TodoWrite": {
      const todos = Array.isArray(record.todos) ? (record.todos as Array<Record<string, unknown>>) : [];
      const done = todos.filter((t) => t.status === "completed").length;
      return {
        kind: "todo",
        title: `Liste de tâches · ${done}/${todos.length}`,
        todos: todos.map((t) => ({ content: str(t.content) ?? "", status: str(t.status) ?? "pending" })),
      };
    }
    default: {
      for (const key of ["command", "CommandLine", "file_path", "path", "pattern", "url", "query"]) {
        const value = str(record[key]);
        if (value) return { kind: "other", title: tool, detail: value };
      }
      return { kind: "other", title: tool, detail: Object.keys(record).join(", ") };
    }
  }
}

const ICONS = {
  edit: PenLine,
  command: Terminal,
  read: FileText,
  search: FileSearch,
  web: Globe,
  task: Bot,
  todo: ListTodo,
  other: Wrench,
} as const;

function Output({ text, terminal = false }: { text: string; terminal?: boolean }) {
  const clean = stripAnsi(text);
  const shown = clean.length > 12_000 ? `${clean.slice(0, 12_000)}\n…` : clean;
  return (
    <pre
      className={cn(
        "max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-bg px-2.5 py-2 font-mono text-caption [overflow-wrap:anywhere]",
        terminal ? "text-text" : "text-text-muted",
      )}
    >
      {shown || "(aucune sortie)"}
    </pre>
  );
}

/** Une action de l'agent : résumé d'une ligne, détail adapté (diff, terminal…) au clic. */
export function ToolCallCard({ tool, input, output, ok }: Props) {
  const view = useMemo(() => describeTool(tool, input), [tool, input]);
  const [open, setOpen] = useState(false);
  const running = output === undefined;
  const Icon = view.kind === "edit" && view.created ? FilePlus2 : ICONS[view.kind];
  const stats = useMemo(() => {
    if (view.kind !== "edit") return null;
    return view.edits.reduce(
      (sum, edit) => {
        const s = diffStats(diffLines(edit.before, edit.after));
        return { added: sum.added + s.added, removed: sum.removed + s.removed };
      },
      { added: 0, removed: 0 },
    );
  }, [view]);

  return (
    <div className="rounded-lg border border-border bg-surface-1">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <ChevronRight size={14} strokeWidth={1.75} className={cn("shrink-0 text-text-subtle transition-transform", open && "rotate-90")} />
        <Icon size={13} strokeWidth={1.75} className="shrink-0 text-text-muted" aria-hidden />
        <span className={cn("min-w-0 flex-1 truncate text-footnote", view.kind === "command" ? "font-mono text-text" : "text-text-muted")}>
          {view.title}
        </span>
        {stats && (
          <span className="shrink-0 font-mono text-caption tabular-nums">
            <span className="text-success">+{stats.added}</span> <span className="text-danger">−{stats.removed}</span>
          </span>
        )}
        {running ? (
          <Loader2 size={13} className="shrink-0 animate-spin text-text-subtle" aria-label="En cours" />
        ) : ok ? (
          <Check size={13} className="shrink-0 text-success" aria-label="Réussi" />
        ) : (
          <X size={13} className="shrink-0 text-danger" aria-label="Échec" />
        )}
      </button>
      {open && (
        <div className="selectable space-y-2 border-t border-border px-3 py-2">
          {view.kind === "edit" && (
            <>
              <p className="truncate font-mono text-caption text-text-subtle" title={view.path}>
                {view.path}
              </p>
              {view.edits.map((edit, index) => (
                <DiffView key={index} path={edit.path} before={edit.before} after={edit.after} collapseAfter={30} bare />
              ))}
              {ok === false && output && <Output text={output} />}
            </>
          )}
          {view.kind === "command" && (
            <>
              {view.description && <p className="text-footnote text-text-muted">{view.description}</p>}
              <pre className="whitespace-pre-wrap rounded-md bg-bg px-2.5 py-2 font-mono text-caption text-text [overflow-wrap:anywhere]">
                <span className="select-none text-text-subtle">$ </span>
                {view.command}
              </pre>
              {output !== undefined && <Output text={output} terminal />}
            </>
          )}
          {view.kind === "read" && (
            <p className="truncate font-mono text-caption text-text-subtle" title={view.path}>
              {view.path}
              {view.range && ` · ${view.range}`}
            </p>
          )}
          {(view.kind === "search" || view.kind === "web") && (
            <>
              {view.detail && <p className="font-mono text-caption text-text-subtle [overflow-wrap:anywhere]">{view.detail}</p>}
              {output !== undefined && <Output text={output} />}
            </>
          )}
          {view.kind === "task" && (
            <>
              {view.prompt && <p className="whitespace-pre-wrap text-footnote text-text-muted">{view.prompt}</p>}
              {output !== undefined && <Output text={output} />}
            </>
          )}
          {view.kind === "todo" && (
            <ul className="space-y-1">
              {view.todos.map((todo, index) => (
                <li key={index} className="flex items-start gap-2 text-footnote">
                  {todo.status === "completed" ? (
                    <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden />
                  ) : todo.status === "in_progress" ? (
                    <Loader2 size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                  ) : (
                    <Circle size={13} className="mt-0.5 shrink-0 text-text-subtle" aria-hidden />
                  )}
                  <span className={cn(todo.status === "completed" ? "text-text-subtle line-through" : "text-text")}>{todo.content}</span>
                </li>
              ))}
            </ul>
          )}
          {view.kind === "other" && (
            <>
              <pre className="max-h-40 overflow-auto rounded-md bg-bg px-2.5 py-2 font-mono text-caption text-text-muted">
                {JSON.stringify(input, null, 2)}
              </pre>
              {output !== undefined && <Output text={output} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
