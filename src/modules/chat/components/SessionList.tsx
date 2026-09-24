import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus, Trash2, FolderOpen, Cpu, Clock } from "lucide-react";
import { cn } from "@/core/lib/cn";
import type { ChatSession } from "@/core/engine/session.store";
import { Button, EmptyState } from "@/design-system/primitives";
import { enterUp } from "@/design-system/motion";

type Props = {
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (session: ChatSession) => void;
  /** Modèle de la session sous son nom réel (« Opus 5.5 · Élevé »). */
  describeModel: (session: ChatSession) => string;
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

export function SessionList({ sessions, activeId, onSelect, onCreate, onDelete, describeModel }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
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

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-bg-subtle">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <span className="text-caption font-medium text-text-subtle">Conversations</span>
        <Button size="sm" variant="ghost" onClick={onCreate} aria-label="Nouvelle conversation">
          <Plus size={14} strokeWidth={1.75} />
        </Button>
      </div>

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
        ) : (
          <ul className="flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {sessions.map((session) => {
                const active = session.id === activeId;
                return (
                  <motion.li
                    key={session.id}
                    variants={enterUp}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    layout
                  >
                    <div
                      className={cn(
                        "group relative rounded-sm px-2 py-2 transition-colors duration-[80ms]",
                        active ? "bg-accent-soft" : "hover:bg-surface-2",
                      )}
                    >
                      <button
                        onClick={() => onSelect(session.id)}
                        className="block w-full text-left"
                        aria-current={active ? "true" : undefined}
                      >
                        <span
                          className={cn(
                            "line-clamp-1 pr-6 text-body-sm",
                            active ? "text-text" : "text-text-muted",
                          )}
                        >
                          {session.title}
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
                        </span>
                      </button>

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
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </aside>
  );
}
