import { useCallback, useEffect, useState } from "react";
import { Check, Copy, History, Loader2, Maximize2, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button, EmptyState } from "@/design-system/primitives";
import { voiceApi, type VoiceSessionSummary } from "../api";
import { TaskList } from "../components/SessionParts";
import { Transcript } from "../components/Transcript";
import { VoiceStage } from "../components/VoiceStage";
import { agentName } from "../lib/agents";
import { orchestrator } from "../runtime/instance";
import { useVoiceStore, type VoiceSession } from "../store";

const message = (e: unknown) => (e as { message?: string })?.message ?? String(e);

const dateTime = (at: number) =>
  new Date(at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Session relue depuis le disque : on ne garde que ce qui a la bonne forme. */
function asSession(raw: unknown): VoiceSession | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<VoiceSession>;
  if (typeof value.id !== "string" || !Array.isArray(value.turns)) return null;
  return {
    id: value.id,
    title: typeof value.title === "string" ? value.title : "Session vocale",
    startedAt: Number(value.startedAt) || Date.now(),
    updatedAt: Number(value.updatedAt) || Date.now(),
    turns: value.turns.filter((t) => t && typeof t.text === "string" && typeof t.role === "string"),
    tasks: Array.isArray(value.tasks) ? value.tasks : [],
    conversationId: null,
    agent: typeof value.agent === "string" ? value.agent : "claude",
    brain: value.brain === "local" ? "local" : "cli",
  };
}

/** Texte brut d'une session (copie, archivage). */
function asText(session: VoiceSession): string {
  const lines = session.turns.map((t) => `[${new Date(t.at).toLocaleTimeString()}] ${t.role === "user" ? "Vous" : t.role === "assistant" ? "ARCHIMED" : "·"} : ${t.text}`);
  return `${session.title}\n${new Date(session.startedAt).toLocaleString()}\n\n${lines.join("\n")}\n`;
}

export function SessionSection() {
  const session = useVoiceStore((s) => s.session);
  const done = session?.tasks.filter((t) => t.status !== "running") ?? [];
  return (
    <div className="space-y-6">
      <div className="h-[min(640px,calc(100vh-240px))] min-h-[460px]">
        <VoiceStage variant="page" />
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => useVoiceStore.getState().patch({ liveOpen: true })}
          icon={<Maximize2 size={13} strokeWidth={1.75} />}
        >
          Plein écran
        </Button>
      </div>
      {done.length > 0 && (
        <section className="space-y-2" aria-label="Tâches terminées">
          <h2 className="text-title-3 font-semibold">Tâches terminées</h2>
          <TaskList tasks={done} />
        </section>
      )}
    </div>
  );
}

export function HistorySection() {
  const current = useVoiceStore((s) => s.session?.id ?? null);
  const [list, setList] = useState<VoiceSessionSummary[] | null>(null);
  const [selected, setSelected] = useState<VoiceSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    void voiceApi
      .sessions()
      .then(setList)
      .catch((e) => {
        setList([]);
        setError(message(e));
      });
  }, []);
  useEffect(refresh, [refresh]);

  const open = async (id: string) => {
    setConfirmDelete(false);
    setError(null);
    try {
      const session = asSession(await voiceApi.session(id));
      if (!session) throw new Error("Session illisible.");
      setSelected(session);
    } catch (e) {
      setError(message(e));
    }
  };

  const remove = async (id: string) => {
    await voiceApi.deleteSession(id).catch((e) => setError(message(e)));
    setSelected(null);
    setConfirmDelete(false);
    refresh();
  };

  const copy = async (session: VoiceSession) => {
    await navigator.clipboard.writeText(asText(session));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  if (list === null) {
    return (
      <div className="flex justify-center py-10 text-text-subtle">
        <Loader2 size={16} className="animate-spin" aria-label="Chargement de l'historique" />
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <EmptyState
        icon={<History size={20} strokeWidth={1.75} />}
        title="Aucune session enregistrée"
        description="Les sessions vocales apparaissent ici une fois terminées. Vous pourrez les relire, les copier ou les reprendre."
      />
    );
  }

  return (
    <div className="grid grid-cols-[minmax(200px,260px)_1fr] gap-4">
      <ul className="max-h-[70vh] space-y-0.5 overflow-y-auto" aria-label="Sessions">
        {list.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => void open(item.id)}
              aria-current={selected?.id === item.id}
              className={cn(
                "w-full cursor-pointer rounded-sm px-2.5 py-2 text-left transition-colors duration-[80ms]",
                selected?.id === item.id ? "bg-surface-2" : "hover:bg-surface-1",
              )}
            >
              <span className="block truncate text-body-sm text-text">{item.title}</span>
              <span className="block text-caption text-text-subtle">
                {dateTime(item.startedAt)} · {item.turns} échange{item.turns > 1 ? "s" : ""}
                {item.id === current ? " · en cours" : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="min-w-0">
        {error && (
          <p role="alert" className="mb-3 rounded-sm bg-danger-soft px-3 py-2 text-footnote text-text">
            {error}
          </p>
        )}
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-title-3 font-semibold">{selected.title}</h2>
                <p className="text-footnote text-text-subtle">
                  {dateTime(selected.startedAt)} · {agentName(selected.agent)}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => void copy(selected)} icon={copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.75} />}>
                {copied ? "Copié" : "Copier"}
              </Button>
              {selected.id !== current && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => orchestrator().resume(selected)}
                  icon={<RotateCcw size={13} strokeWidth={1.75} />}
                  title="Reprendre cette session : l'historique revient, l'agent repart d'une conversation neuve"
                >
                  Reprendre
                </Button>
              )}
              {confirmDelete ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Annuler
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void remove(selected.id)}>
                    Supprimer
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDelete(true)}
                  disabled={selected.id === current}
                  aria-label="Supprimer cette session"
                  className="px-1.5"
                >
                  <Trash2 size={13} strokeWidth={1.75} />
                </Button>
              )}
            </div>
            <Transcript turns={selected.turns} stick={false} className="max-h-[60vh] rounded-md border border-border bg-surface-1 p-4" />
            {selected.tasks.length > 0 && <TaskList tasks={selected.tasks} />}
          </div>
        ) : (
          <p className="py-10 text-center text-footnote text-text-subtle">Choisissez une session pour la relire.</p>
        )}
      </div>
    </div>
  );
}
