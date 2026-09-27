import { useEffect, useRef } from "react";
import { Bell, ShieldQuestion, Wrench } from "lucide-react";
import { cn } from "@/core/lib/cn";
import type { Turn } from "../store";

const SOURCES: Record<string, string> = {
  agent: "Agent",
  task: "Tâche",
  voice: "Voix",
  module: "Module",
};

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function ToolChips({ tools }: { tools: string[] }) {
  if (tools.length === 0) return null;
  // Les mêmes outils se répètent souvent (lectures successives) : regroupés avec leur nombre.
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool, (counts.get(tool) ?? 0) + 1);
  return (
    <ul className="flex flex-wrap gap-1 pt-1" aria-label="Outils utilisés">
      {[...counts].map(([tool, count]) => (
        <li key={tool} className="inline-flex items-center gap-1 rounded-xs bg-surface-2 px-1.5 py-0.5 text-caption text-text-muted">
          <Wrench size={10} strokeWidth={2} aria-hidden />
          {tool}
          {count > 1 && <span className="tabular-nums text-text-subtle">×{count}</span>}
        </li>
      ))}
    </ul>
  );
}

function TurnRow({ turn }: { turn: Turn }) {
  if (turn.role === "notice" || turn.role === "system") {
    const Icon = turn.role === "system" ? ShieldQuestion : Bell;
    return (
      <li className="flex items-start gap-2 text-footnote text-text-muted">
        <Icon size={13} strokeWidth={1.75} className="mt-0.5 shrink-0 text-text-subtle" aria-hidden />
        <p className="min-w-0 flex-1">
          {turn.source && <span className="font-medium text-text-subtle">{SOURCES[turn.source] ?? turn.source} · </span>}
          {turn.text}
        </p>
        <time className="shrink-0 text-caption text-text-subtle tabular-nums">{time(turn.at)}</time>
      </li>
    );
  }
  const user = turn.role === "user";
  return (
    <li className="space-y-0.5">
      <p className="flex items-baseline gap-2 text-caption">
        <span className={cn("font-semibold", user ? "text-text-muted" : "text-text")}>{user ? "Vous" : "ARCHIMED"}</span>
        <time className="text-text-subtle tabular-nums">{time(turn.at)}</time>
      </p>
      <p className={cn("whitespace-pre-wrap break-words text-body-sm", user ? "text-text-muted" : "text-text")}>{turn.text}</p>
      {turn.tools && <ToolChips tools={turn.tools} />}
    </li>
  );
}

/**
 * Fil de la conversation vocale : ce que la personne a dit, les réponses, les annonces.
 * `live` ajoute la phrase en cours de reconnaissance et celle en cours de lecture.
 */
export function Transcript({
  turns,
  partial,
  caption,
  tools,
  className,
  stick = true,
}: {
  turns: Turn[];
  partial?: string;
  caption?: string;
  tools?: string[];
  className?: string;
  /** Défile vers la fin à chaque nouveauté, sauf si la personne remonte lire. */
  stick?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const node = ref.current;
    if (node && stick && pinned.current) node.scrollTop = node.scrollHeight;
  }, [turns.length, partial, caption, tools?.length, stick]);

  return (
    <div
      ref={ref}
      onScroll={(event) => {
        const node = event.currentTarget;
        pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
      }}
      className={cn("overflow-y-auto overscroll-contain", className)}
    >
      {/* L'assistant parle déjà : le fil n'est pas relu par les lecteurs d'écran (aria-live off). */}
      <ol role="log" aria-live="off" aria-label="Conversation vocale" className="space-y-3">
        {turns.map((turn) => (
          <TurnRow key={turn.id} turn={turn} />
        ))}
        {tools && tools.length > 0 && (
          <li className="space-y-0.5">
            <p className="text-caption font-semibold text-text">ARCHIMED</p>
            <ToolChips tools={tools} />
          </li>
        )}
        {caption && (
          <li className="space-y-0.5">
            <p className="text-caption font-semibold text-text">ARCHIMED</p>
            <p className="text-body-sm text-text">{caption}</p>
          </li>
        )}
        {partial && (
          <li className="space-y-0.5">
            <p className="text-caption font-semibold text-text-muted">Vous</p>
            <p className="text-body-sm italic text-text-subtle">{partial}…</p>
          </li>
        )}
      </ol>
    </div>
  );
}
