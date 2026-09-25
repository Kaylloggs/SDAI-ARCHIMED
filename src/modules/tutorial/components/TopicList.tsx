import { useRef, type KeyboardEvent } from "react";
import { Check, Search, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import type { TopicGroup } from "../lib/topics";

/**
 * Colonne des tutoriels : progression, recherche, puis les groupes.
 * ↑ ↓ passent d'un tutoriel à l'autre et l'ouvrent, comme une barre latérale de bureau.
 */
export function TopicList({
  groups,
  active,
  done,
  total,
  finished,
  query,
  onQuery,
  onSelect,
}: {
  groups: TopicGroup[];
  active: string;
  done: Record<string, true>;
  total: number;
  finished: number;
  query: string;
  onQuery: (query: string) => void;
  onSelect: (topic: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const progress = total > 0 ? Math.round((finished / total) * 100) : 0;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("[data-topic]") ?? []);
    const index = buttons.findIndex((b) => b === document.activeElement);
    const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
    onSelect(next.dataset.topic ?? active);
  };

  return (
    <nav aria-label="Tutoriels" className="flex h-full w-[216px] shrink-0 flex-col border-r border-border min-[1180px]:w-[248px]">
      <div className="space-y-4 px-4 pb-3 pt-5">
        <div>
          <div className="flex items-baseline justify-between text-footnote">
            <span className="text-text-muted">Progression</span>
            <span className="tabular-nums text-text-muted">
              {finished} sur {total}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Tutoriels terminés"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={finished}
            className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-[360ms] ease-emphasized"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 text-text-subtle transition-colors focus-within:border-border-strong focus-within:text-text-muted">
          <Search size={14} strokeWidth={1.75} className="shrink-0" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.stopPropagation();
                onQuery("");
              }
              // Entrée ouvre le premier tutoriel trouvé.
              const first = groups[0]?.topics[0];
              if (event.key === "Enter" && query && first) onSelect(first.id);
            }}
            placeholder="Rechercher un tutoriel"
            aria-label="Rechercher un tutoriel"
            className="min-w-0 flex-1 bg-transparent text-body-sm text-text outline-none placeholder:text-text-subtle"
          />
          {query && (
            <button
              type="button"
              aria-label="Effacer la recherche"
              onClick={() => onQuery("")}
              className="flex size-5 items-center justify-center rounded-full text-text-subtle hover:bg-surface-2 hover:text-text"
            >
              <X size={12} strokeWidth={2} />
            </button>
          )}
        </label>
      </div>

      <div ref={list} onKeyDown={onKeyDown} className="scroll-soft min-h-0 flex-1 px-2 pb-4">
        {groups.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-body-sm text-text-muted">Aucun tutoriel ne parle de « {query} ».</p>
            <button
              type="button"
              onClick={() => onQuery("")}
              className="mt-2 text-footnote text-accent hover:underline"
            >
              Effacer la recherche
            </button>
          </div>
        )}
        {groups.map((group) => (
          <section key={group.id} aria-label={group.label} className="pt-3">
            <h2 className="px-3 pb-1 text-caption text-text-subtle">{group.label}</h2>
            <ul className="flex flex-col gap-0.5">
              {group.topics.map((topic) => {
                const Icon = topic.icon;
                const current = topic.id === active;
                return (
                  <li key={topic.id}>
                    <button
                      type="button"
                      data-topic={topic.id}
                      aria-current={current ? "page" : undefined}
                      onClick={() => onSelect(topic.id)}
                      className={cn(
                        "flex h-9 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-body-sm transition-colors duration-[80ms]",
                        current
                          ? "bg-[color-mix(in_oklab,var(--color-text)_10%,transparent)] text-text"
                          : "text-text-muted hover:bg-[color-mix(in_oklab,var(--color-text)_6%,transparent)] hover:text-text",
                      )}
                    >
                      <Icon
                        size={16}
                        strokeWidth={1.75}
                        className={cn("shrink-0", current ? "text-accent" : !topic.enabled && "opacity-60")}
                      />
                      <span className="min-w-0 flex-1 truncate">{topic.title}</span>
                      {done[topic.id] ? (
                        <Check size={14} strokeWidth={2} aria-label="Terminé" className="shrink-0 text-success" />
                      ) : !topic.tutorial ? (
                        <span className="shrink-0 text-caption text-text-subtle">à venir</span>
                      ) : !topic.enabled ? (
                        <span className="shrink-0 text-caption text-text-subtle">désactivé</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}
