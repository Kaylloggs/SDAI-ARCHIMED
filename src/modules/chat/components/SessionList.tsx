import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus, Trash2, FolderOpen, Cpu, Clock, Search, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import type { ChatSession } from "@/core/engine/session.store";
import { Button, EmptyState } from "@/design-system/primitives";
import { enterUp } from "@/design-system/motion";
import { groupSessions, matchesSearch, sessionState, type SessionState } from "../lib/sessions";

type Props = {
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (session: ChatSession) => void;
  onRename: (session: ChatSession, title: string) => void;
  /** Modèle de la session sous son nom réel (« Opus 5.5 · Élevé »). */
  describeModel: (session: ChatSession) => string;
  /** Largeur réglée par la poignée voisine. */
  width: number;
};

const dateFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `Aujourd'hui ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
    : dateFormat.format(date);
}

export function folderName(path: string | null): string {
  if (!path) return "dossier par défaut";
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

const STATE_LABEL: Record<Exclude<SessionState, "idle">, string> = {
  working: "L'agent travaille",
  waiting: "Attend votre réponse",
  error: "Arrêtée sur une erreur",
};

function StateDot({ state }: { state: SessionState }) {
  if (state === "idle") return null;
  return (
    <span className="relative flex size-2 shrink-0" title={STATE_LABEL[state]} aria-label={STATE_LABEL[state]} role="img">
      {state === "working" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-50" />}
      <span
        className={cn(
          "relative inline-flex size-2 rounded-full",
          state === "working" ? "bg-accent" : state === "waiting" ? "bg-warning" : "bg-danger",
        )}
      />
    </span>
  );
}

/** Titre modifiable sur place : Entrée valide, Échap annule. */
function TitleInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const finished = useRef(false);
  const finish = (title: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(title);
  };
  return (
    <input
      autoFocus
      value={value}
      aria-label="Nouveau titre"
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value.trim() || null)}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(value.trim() || null);
        if (event.key === "Escape") finish(null);
      }}
      className="h-6 w-full rounded-xs border border-border-strong bg-bg px-1.5 text-body-sm text-text outline-none"
    />
  );
}

export function SessionList({ sessions, activeId, onSelect, onCreate, onDelete, onRename, describeModel, width }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // La confirmation expire seule et disparaît si la conversation n'existe plus.
  useEffect(() => {
    if (confirming && !sessions.some((s) => s.id === confirming)) setConfirming(null);
  }, [sessions, confirming]);

  const armConfirm = (id: string) => {
    setConfirming(id);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setConfirming(null), 4000);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  const groups = groupSessions(sessions.filter((session) => matchesSearch(session, query)));

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col border-r border-border bg-bg-subtle">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <span className="text-caption font-medium text-text-subtle">Conversations</span>
        <Button size="sm" variant="ghost" onClick={onCreate} aria-label="Nouvelle conversation" title="Nouvelle conversation">
          <Plus size={14} strokeWidth={1.75} />
        </Button>
      </div>

      {sessions.length > 3 && (
        <div className="shrink-0 px-2 pt-2">
          <label className="flex h-7 items-center gap-1.5 rounded-sm border border-border bg-bg px-2 text-text-subtle focus-within:border-border-strong">
            <Search size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Escape" && setQuery("")}
              placeholder="Rechercher"
              aria-label="Rechercher une conversation"
              className="min-w-0 flex-1 bg-transparent text-footnote text-text outline-none placeholder:text-text-subtle"
            />
            {query && (
              <button aria-label="Effacer la recherche" onClick={() => setQuery("")} className="shrink-0 hover:text-text">
                <X size={11} strokeWidth={2} />
              </button>
            )}
          </label>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {sessions.length === 0 ? (
          <EmptyState
            title="Aucune conversation"
            description="Créez-en une pour démarrer."
            action={
              <Button size="sm" variant="secondary" onClick={onCreate}>
                Nouvelle conversation
              </Button>
            }
          />
        ) : groups.length === 0 ? (
          <p className="px-2 py-3 text-footnote text-text-subtle">Aucune conversation ne correspond à « {query} ».</p>
        ) : (
          groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="pb-2">
              <h3 className="px-2 pb-1 pt-1.5 text-caption font-medium text-text-subtle">{group.label}</h3>
              <ul className="flex flex-col gap-1">
                <AnimatePresence initial={false}>
                  {group.sessions.map((session) => {
                    const active = session.id === activeId;
                    const state = sessionState(session);
                    const queued = session.queue?.length ?? 0;
                    return (
                      <motion.li key={session.id} variants={enterUp} initial="hidden" animate="visible" exit="exit" layout>
                        <div
                          className={cn(
                            "group relative rounded-sm px-2 py-2 transition-colors duration-[80ms]",
                            active ? "bg-accent-soft" : "hover:bg-surface-2",
                          )}
                        >
                          {renaming === session.id ? (
                            <TitleInput
                              initial={session.title}
                              onDone={(title) => {
                                if (title && title !== session.title) onRename(session, title);
                                setRenaming(null);
                              }}
                            />
                          ) : (
                            <button
                              onClick={() => onSelect(session.id)}
                              onDoubleClick={() => setRenaming(session.id)}
                              title="Double-clic pour renommer"
                              className="block w-full text-left"
                              aria-current={active ? "true" : undefined}
                            >
                              <span className="flex items-center gap-1.5 pr-6">
                                <StateDot state={state} />
                                <span className={cn("line-clamp-1 text-body-sm", active ? "text-text" : "text-text-muted")}>
                                  {session.title}
                                </span>
                              </span>
                              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-text-subtle">
                                <span className="inline-flex items-center gap-1">
                                  <Clock size={10} strokeWidth={1.75} />
                                  {formatDate(session.updatedAt)}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Cpu size={10} strokeWidth={1.75} />
                                  {describeModel(session)}
                                </span>
                                <span className="inline-flex max-w-full items-center gap-1 truncate">
                                  <FolderOpen size={10} strokeWidth={1.75} />
                                  {folderName(session.cwd)}
                                </span>
                                {queued > 0 && <span>{queued} en attente</span>}
                              </span>
                            </button>
                          )}

                          {renaming !== session.id && (
                            <button
                              aria-label={
                                confirming === session.id
                                  ? `Confirmer la suppression de ${session.title}`
                                  : `Supprimer ${session.title}`
                              }
                              onClick={() => {
                                if (confirming === session.id) {
                                  clearTimeout(timer.current);
                                  setConfirming(null);
                                  onDelete(session);
                                } else {
                                  armConfirm(session.id);
                                }
                              }}
                              className={cn(
                                "absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-xs transition-opacity",
                                confirming === session.id
                                  ? "bg-danger text-text opacity-100"
                                  : "text-text-subtle opacity-0 hover:bg-surface-3 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100",
                              )}
                            >
                              <Trash2 size={12} strokeWidth={1.75} />
                            </button>
                          )}
                        </div>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
