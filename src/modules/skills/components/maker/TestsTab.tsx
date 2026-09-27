import { useCallback, useEffect, useRef, useState } from "react";
import { FlaskConical, FolderOpen, MessageSquareText, Pencil, Play, Plus, Send, Square, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { ConversationView } from "@/core/chat";
import { engineApi } from "@/core/engine/engine.api";
import { useAutoContinue } from "@/core/engine/useAutoContinue";
import { useChat } from "@/core/engine/useChat";
import { useSessionStore, type ChatSession } from "@/core/engine/session.store";
import type { AutoMode, PromptAnswer } from "@/core/engine/types";
import { cn } from "@/core/lib/cn";
import { Badge, Button, EmptyState } from "@/design-system/primitives";
import { errorText, skillsApi, type DraftInfo } from "../../api";
import {
  feedbackMessage,
  mergeTests,
  nextTestId,
  parseTests,
  serializeTests,
  testInstructions,
  testsRequestMessage,
  type SkillTest,
  type Verdict,
} from "../../lib/maker";
import { ORIGIN_SKILLS } from "./origin";
import { textareaClass } from "./ui";

export type Agent = { adapter: string; model: string | null; autoMode: AutoMode; name: string };

type Props = {
  draft: DraftInfo;
  revision: number;
  agent: Agent;
  onPrefill: (text: string) => void;
};

const ACTIVE = ["starting", "running", "awaiting"];

/** Conversation d'un essai (l'IA de test dispose du skill du brouillon). */
function TestRun({ session, agentName }: { session: ChatSession; agentName: string }) {
  const chat = useChat();
  useAutoContinue(session, chat.continueTurn);
  const running = ACTIVE.includes(session.status);
  return (
    <div className="space-y-1.5">
      <div className="max-h-[420px] overflow-y-auto overflow-x-hidden rounded-md border border-border bg-bg">
        <ConversationView
          session={session}
          agentName={agentName}
          onAnswer={(promptId: string, payload: PromptAnswer) => void chat.answer(session, promptId, payload)}
          compact
        />
      </div>
      <div className="flex items-center gap-1">
        {running && (
          <Button size="sm" variant="ghost" onClick={() => void chat.stop(session)} icon={<Square size={12} strokeWidth={1.75} />}>
            Arrêter
          </Button>
        )}
        {session.cwd && (
          <Button size="sm" variant="ghost" onClick={() => void engineApi.openPath(session.cwd!)} icon={<FolderOpen size={13} strokeWidth={1.75} />}>
            Fichiers produits
          </Button>
        )}
      </div>
    </div>
  );
}

function TestCard({
  test,
  session,
  agentName,
  expanded,
  onToggle,
  onRun,
  onChange,
  onRemove,
}: {
  test: SkillTest;
  session: ChatSession | null;
  agentName: string;
  expanded: boolean;
  onToggle: () => void;
  onRun: () => void;
  onChange: (patch: Partial<SkillTest>) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(test.prompt);
  const [note, setNote] = useState(test.note);
  useEffect(() => setPrompt(test.prompt), [test.prompt]);
  useEffect(() => setNote(test.note), [test.note]);

  const running = session !== null && ACTIVE.includes(session.status);
  const setVerdict = (verdict: Verdict) => onChange({ verdict: test.verdict === verdict ? null : verdict });

  return (
    <li className="space-y-2 rounded-md border border-border bg-surface-1 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 font-mono text-caption text-text-subtle">{test.id}</span>
        {editing ? (
          <textarea
            value={prompt}
            autoFocus
            rows={3}
            onChange={(event) => setPrompt(event.target.value)}
            onBlur={() => {
              setEditing(false);
              if (prompt.trim() && prompt !== test.prompt) onChange({ prompt: prompt.trim(), verdict: null });
              else setPrompt(test.prompt);
            }}
            aria-label="Demande de test"
            className={textareaClass}
          />
        ) : (
          <p className="min-w-0 flex-1 whitespace-pre-wrap text-body-sm [overflow-wrap:anywhere]">{test.prompt}</p>
        )}
        {!editing && (
          <div className="flex shrink-0 items-center">
            <Button size="sm" variant="ghost" aria-label="Modifier la demande" title="Modifier la demande" onClick={() => setEditing(true)}>
              <Pencil size={12} strokeWidth={1.75} />
            </Button>
            <Button size="sm" variant="ghost" aria-label="Retirer ce test" title="Retirer ce test" onClick={onRemove}>
              <Trash2 size={12} strokeWidth={1.75} />
            </Button>
          </div>
        )}
      </div>
      {test.expect && <p className="text-footnote text-text-muted">Attendu : {test.expect}</p>}

      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant="secondary"
          disabled={running}
          onClick={onRun}
          icon={<Play size={12} strokeWidth={1.75} />}
        >
          {session ? "Relancer" : "Essayer"}
        </Button>
        {session && (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            onClick={onToggle}
            icon={<MessageSquareText size={13} strokeWidth={1.75} />}
          >
            {expanded ? "Masquer l'essai" : "Voir l'essai"}
          </Button>
        )}
        {running && <Badge tone="info">en cours</Badge>}
        {session?.status === "error" && <Badge tone="danger">erreur</Badge>}
        <span className="ml-auto" />
        {session && !running && (
          <div role="group" aria-label="Avis sur l'essai" className="flex items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={test.verdict === "good"}
              onClick={() => setVerdict("good")}
              className={cn(test.verdict === "good" && "bg-success-soft text-success hover:bg-success-soft hover:text-success")}
              icon={<ThumbsUp size={12} strokeWidth={1.75} />}
            >
              Réussi
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={test.verdict === "bad"}
              onClick={() => setVerdict("bad")}
              className={cn(test.verdict === "bad" && "bg-danger-soft text-danger hover:bg-danger-soft hover:text-danger")}
              icon={<ThumbsDown size={12} strokeWidth={1.75} />}
            >
              À revoir
            </Button>
          </div>
        )}
      </div>

      {session && expanded && <TestRun session={session} agentName={agentName} />}

      {session && (test.verdict !== null || test.note) && (
        <textarea
          value={note}
          rows={2}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => note !== test.note && onChange({ note })}
          placeholder="Ce qui va, ce qui manque (envoyé à l'atelier avec les avis)…"
          aria-label="Remarque sur l'essai"
          className={textareaClass}
        />
      )}
    </li>
  );
}

/**
 * Essais du skill : chaque demande de test part dans une conversation neuve qui dispose du
 * skill du brouillon ; la personne juge le résultat, puis renvoie ses avis à l'atelier.
 */
export function TestsTab({ draft, revision, agent, onPrefill }: Props) {
  const chat = useChat();
  const sessions = useSessionStore((s) => s.sessions);
  const [tests, setTests] = useState<SkillTest[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const testsRef = useRef<SkillTest[]>([]);
  testsRef.current = tests ?? [];

  useEffect(() => {
    let cancelled = false;
    void skillsApi
      .draftRead(draft.id, "tests.json")
      .then((text) => {
        if (!cancelled) setTests(mergeTests(parseTests(text), testsRef.current));
      })
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [draft.id, revision]);

  useEffect(() => {
    setTests(null);
    setExpanded(null);
  }, [draft.id]);

  /** Écritures en file : plusieurs essais lancés d'un coup modifient la liste à la suite. */
  const writing = useRef<Promise<void>>(Promise.resolve());
  const persist = useCallback(
    (next: SkillTest[]) => {
      testsRef.current = next;
      setTests(next);
      const text = serializeTests(next);
      writing.current = writing.current
        .then(() => skillsApi.draftWrite(draft.id, "tests.json", text))
        .catch((e) => setError(errorText(e)));
      return writing.current;
    },
    [draft.id],
  );

  const patch = (id: string, change: Partial<SkillTest>) =>
    void persist(testsRef.current.map((t) => (t.id === id ? { ...t, ...change } : t)));

  const sessionOf = (test: SkillTest) => (test.sessionId ? (sessions.find((s) => s.id === test.sessionId) ?? null) : null);

  const run = async (test: SkillTest) => {
    setError(null);
    try {
      const previous = sessionOf(test);
      if (previous) void chat.remove(previous);
      const cwd = await skillsApi.draftPrepareRun(draft.id);
      const id = chat.createSession({
        adapter: agent.adapter,
        model: agent.model,
        cwd,
        autoMode: agent.autoMode,
        origin: ORIGIN_SKILLS,
        title: `Essai ${test.id} · ${draft.name || "skill"}`,
        options: { appendSystemPrompt: testInstructions(draft.skillPath) },
        activate: false,
      });
      await persist(testsRef.current.map((t) => (t.id === test.id ? { ...t, sessionId: id, verdict: null } : t)));
      setExpanded(test.id);
      const session = useSessionStore.getState().sessions.find((s) => s.id === id);
      if (session) await chat.send(session, test.prompt, []);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const add = () => {
    const prompt = draftPrompt.trim();
    if (!prompt) return;
    const list = testsRef.current;
    void persist([...list, { id: nextTestId(list), prompt, expect: "", verdict: null, note: "", sessionId: null }]);
    setDraftPrompt("");
  };

  const remove = (test: SkillTest) => {
    const session = sessionOf(test);
    if (session) void chat.remove(session);
    void persist(testsRef.current.filter((t) => t.id !== test.id));
  };

  if (tests === null) return null;

  const feedback = feedbackMessage(tests);
  const anyRunning = tests.some((t) => {
    const s = sessionOf(t);
    return s !== null && ACTIVE.includes(s.status);
  });

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-footnote">
          {error}
        </p>
      )}

      {tests.length === 0 ? (
        <EmptyState
          icon={<FlaskConical size={24} strokeWidth={1.5} />}
          title="Aucun test"
          description="Un test est une demande réaliste : une IA neuve la traite avec le skill, vous jugez le résultat. Écrivez-en une ci-dessous, ou demandez-en à l'atelier."
          action={
            <Button size="sm" variant="secondary" onClick={() => onPrefill(testsRequestMessage())}>
              Demander des tests à l'IA
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-footnote text-text-subtle">
              {tests.filter((t) => t.verdict === "good").length} réussi · {tests.filter((t) => t.verdict === "bad").length} à revoir ·{" "}
              {tests.length} test{tests.length > 1 ? "s" : ""}
            </p>
            <span className="ml-auto" />
            <Button
              size="sm"
              variant="ghost"
              disabled={anyRunning || !agent.adapter}
              onClick={() => tests.forEach((test) => void run(test))}
              title="Chaque test part dans sa propre conversation, en parallèle"
              icon={<Play size={12} strokeWidth={1.75} />}
            >
              Tout essayer
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!feedback}
              onClick={() => feedback && onPrefill(feedback)}
              title={feedback ? "Déposer les avis dans la saisie de l'atelier" : "Donnez d'abord un avis sur au moins un essai"}
              icon={<Send size={12} strokeWidth={1.75} />}
            >
              Avis à l'atelier
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {tests.map((test) => (
              <TestCard
                key={test.id}
                test={test}
                session={sessionOf(test)}
                agentName={agent.name}
                expanded={expanded === test.id}
                onToggle={() => setExpanded((current) => (current === test.id ? null : test.id))}
                onRun={() => void run(test)}
                onChange={(change) => patch(test.id, change)}
                onRemove={() => remove(test)}
              />
            ))}
          </ul>
        </>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <textarea
          value={draftPrompt}
          rows={2}
          onChange={(event) => setDraftPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              add();
            }
          }}
          placeholder="Nouvelle demande de test, telle qu'une personne l'écrirait…"
          aria-label="Nouvelle demande de test"
          className={textareaClass}
        />
        <Button type="submit" size="sm" variant="ghost" disabled={!draftPrompt.trim()} icon={<Plus size={13} strokeWidth={1.75} />}>
          Ajouter
        </Button>
      </form>
    </div>
  );
}
