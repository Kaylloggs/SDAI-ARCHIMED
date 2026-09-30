import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus, Sparkles, Trash2, Wrench } from "lucide-react";
import { Composer, ConversationView } from "@/core/chat";
import { samePath } from "@/core/editor";
import { useAdapters } from "@/core/engine/useAdapters";
import { useAutoContinue } from "@/core/engine/useAutoContinue";
import { useChat } from "@/core/engine/useChat";
import { useSessionStore } from "@/core/engine/session.store";
import type { AutoMode, PromptAnswer } from "@/core/engine/types";
import { Button, EmptyState, Select } from "@/design-system/primitives";
import type { GameAgentRole } from "@/core/ipc/bindings/GameAgentRole";
import { errorText, gameStudioApi } from "../../api";
import { autoModeFor, checkpointLabel, fixRequest, MAX_FIX_ROUNDS, ORIGIN } from "../../lib/assistant";
import { ROLE } from "../../lib/labels";
import { useGameStudioStore } from "../../store";
import { ErrorLine } from "../ui";

const ROLES = Object.keys(ROLE) as GameAgentRole[];

/** Première demande proposée au Directeur, selon l'état du projet. */
const IDEAS = [
  "Regarde le plan et dis-moi les trois prochaines tâches les plus utiles, dans l'ordre.",
  "Implémente le contrôleur du joueur, puis vérifie le code.",
  "Relis l'architecture des systèmes et signale les dépendances qui manquent.",
];

/**
 * Assistant : le Directeur et les agents spécialistes, dans le dossier du projet. Chaque
 * conversation reçoit le brief du projet (graphe, règles, rôle) ; un point de restauration est
 * pris avant chaque intervention demandée.
 */
export function AssistantSection() {
  const current = useGameStudioStore((s) => s.current);
  const request = useGameStudioStore((s) => s.assistantRequest);
  const runs = useGameStudioStore((s) => (s.openId ? s.runs[s.openId] : undefined));
  const fixRounds = useGameStudioStore((s) => (s.openId ? (s.fixRounds[s.openId] ?? 0) : 0));
  const apply = useGameStudioStore((s) => s.apply);
  const openId = useGameStudioStore((s) => s.openId);
  const loadRuns = useGameStudioStore((s) => s.loadRuns);
  const { adapters } = useAdapters();
  const chat = useChat();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draftChosen, setDraftChosen] = useState(false);
  const [role, setRole] = useState<GameAgentRole>("director");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ adapter: string; model: string | null; autoMode: AutoMode | null }>({ adapter: "", model: null, autoMode: null });
  const [prefill, setPrefill] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  // Le message prêt vient du bandeau d'échec : il compte comme une correction une fois envoyé.
  const [fixDraft, setFixDraft] = useState(false);

  const root = current?.project.root ?? "";
  const installed = useMemo(() => adapters.filter((a) => a.installed), [adapters]);
  useEffect(() => {
    if (!draft.adapter && installed[0]) setDraft((d) => ({ ...d, adapter: installed[0]!.id, model: installed[0]!.defaultModel }));
  }, [installed, draft.adapter]);

  // Le dernier résultat (vérifier, tester…) décide du bandeau « Corriger avec l'agent ».
  useEffect(() => {
    if (openId && !runs) void loadRuns(openId);
  }, [openId, runs, loadRuns]);

  const sessions = useMemo(() => chat.sessions.filter((s) => s.origin === ORIGIN && s.cwd !== null && root !== "" && samePath(s.cwd, root)), [chat.sessions, root]);

  // Demande venue d'une tâche ou d'un échec : nouvelle conversation du bon rôle, message prêt.
  useEffect(() => {
    if (!request) return;
    setRole(request.role);
    setTaskId(request.taskId);
    setPrefill(request.text);
    setFixDraft(Boolean(request.fix));
    setSessionId(null);
    setDraftChosen(true);
    useGameStudioStore.getState().clearAssistantRequest();
  }, [request]);

  useEffect(() => {
    if (!sessionId && !draftChosen && sessions[0]) setSessionId(sessions[0].id);
  }, [sessions, sessionId, draftChosen]);

  useEffect(() => {
    if (!deleteArmed) return;
    const timer = setTimeout(() => setDeleteArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [deleteArmed]);

  const session = sessions.find((s) => s.id === sessionId) ?? null;
  useAutoContinue(session, chat.continueTurn);
  if (!current) return null;
  const { project } = current;
  const autoMode = draft.autoMode ?? autoModeFor(project.autonomy);
  const adapterId = session?.adapter ?? draft.adapter;
  const adapter = adapters.find((a) => a.id === adapterId);
  const lastRun = runs?.[0];
  const failed = lastRun && lastRun.status === "failed" && lastRun.id !== "";
  const linkedTask = taskId ? current.graph.tasks.find((t) => t.id === taskId) : null;

  const send = async (text: string, attachments: string[]) => {
    setError(null);
    try {
      // Filet de sécurité avant que l'agent ne touche au projet (sans Git : il le dit ailleurs).
      const vcs = await gameStudioApi.vcsState(project.id).catch(() => null);
      if (vcs?.repository) await gameStudioApi.checkpoint(project.id, checkpointLabel(text)).catch(() => null);
      let target = session;
      if (!target) {
        const instructions = await gameStudioApi.agentInstructions(project.id, role);
        const task = linkedTask;
        const id = chat.createSession({
          adapter: draft.adapter,
          model: draft.model,
          cwd: project.root,
          autoMode,
          origin: ORIGIN,
          title: task ? `${ROLE[role].label} · ${task.title}` : `${ROLE[role].label} · ${project.name}`,
          options: { appendSystemPrompt: instructions },
          activate: false,
        });
        setSessionId(id);
        setDraftChosen(false);
        target = useSessionStore.getState().sessions.find((s) => s.id === id) ?? null;
        if (task) await apply({ op: "setTaskStatus", id: task.id, status: "running", result: null, conversationId: id });
      }
      if (target) await chat.send(target, text, attachments);
      if (fixDraft) useGameStudioStore.getState().setFixRounds(project.id, fixRounds + 1);
      setFixDraft(false);
      setPrefill(undefined);
      setTaskId(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const askFix = () => {
    if (!lastRun) return;
    setFixDraft(true);
    setRole("debug");
    setTaskId(null);
    setSessionId(null);
    setDraftChosen(true);
    setPrefill(fixRequest(lastRun));
  };

  const running = Boolean(session && ["starting", "running", "awaiting"].includes(session.status));

  return (
    <div className="flex min-h-[calc(100vh-240px)] flex-col overflow-hidden rounded-lg border border-border bg-surface-1">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        {sessions.length > 0 && (
          <Select
            label="Conversation"
            value={session?.id ?? "__draft"}
            onChange={(value) => {
              setDraftChosen(value === "__draft");
              setSessionId(value === "__draft" ? null : value);
            }}
            className="min-w-0 max-w-72"
            options={[...sessions.map((s) => ({ value: s.id, label: s.title })), { value: "__draft", label: "Nouvelle conversation" }]}
          />
        )}
        {!session && (
          <Select
            label="Rôle de l'agent"
            value={role}
            onChange={(v) => setRole(v as GameAgentRole)}
            className="w-52"
            options={ROLES.map((r) => ({ value: r, label: ROLE[r].label, hint: ROLE[r].hint }))}
          />
        )}
        <span className="ml-auto" />
        {session && (
          <Button
            size="sm"
            variant="ghost"
            aria-label="Nouvelle conversation"
            title="Nouvelle conversation"
            onClick={() => {
              setDraftChosen(true);
              setSessionId(null);
              setRole("director");
            }}
          >
            <Plus size={13} />
          </Button>
        )}
        {session && (
          <Button
            size="sm"
            variant={deleteArmed ? "danger" : "ghost"}
            aria-label={deleteArmed ? "Confirmer la suppression" : "Supprimer la conversation"}
            onClick={() => {
              if (!deleteArmed) {
                setDeleteArmed(true);
                return;
              }
              setDeleteArmed(false);
              void chat.remove(session);
              setSessionId(null);
              setDraftChosen(false);
            }}
          >
            <Trash2 size={13} />
            {deleteArmed && "Supprimer ?"}
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {session && session.timeline.length > 0 ? (
          <ConversationView
            session={session}
            agentName={adapter?.name ?? session.adapter}
            onAnswer={(promptId: string, payload: PromptAnswer) => void chat.answer(session, promptId, payload)}
            compact
          />
        ) : installed.length === 0 ? (
          <EmptyState title="Aucun agent installé" description="Installez Claude Code, Codex ou Antigravity dans Réglages › Assistants IA : Game Studio leur confie le travail." />
        ) : (
          <div className="mx-auto max-w-[620px] space-y-4 px-6 py-8">
            <div className="space-y-1.5">
              <h3 className="flex items-center gap-2 text-title-3 font-semibold">
                <Sparkles size={16} className="text-accent" aria-hidden /> {ROLE[role].label}
              </h3>
              <p className="text-body-sm text-text-muted">{ROLE[role].hint}</p>
              {linkedTask && (
                <p className="text-footnote text-text">
                  Tâche liée : {linkedTask.title}. Elle passe « en cours » à l'envoi, avec cette conversation.
                </p>
              )}
              <p className="text-footnote text-text-subtle">
                L'agent travaille dans le dossier du jeu avec le brief du projet (systèmes, tâches, décisions, problèmes). Un point de restauration est pris avant chaque message. Il peut vérifier son code et mettre à jour le graphe par les commandes de Game Studio.
              </p>
            </div>
            {role === "director" && !prefill && (
              <ul className="space-y-2">
                {IDEAS.map((idea) => (
                  <li key={idea}>
                    <button
                      type="button"
                      onClick={() => setPrefill(idea)}
                      className="w-full cursor-pointer rounded-md border border-border bg-bg px-3 py-2 text-left text-body-sm text-text-muted transition-colors hover:border-border-strong hover:text-text"
                    >
                      {idea}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {failed && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-danger-soft px-3 py-2">
          <AlertTriangle size={14} className="shrink-0 text-danger" aria-hidden />
          <p className="min-w-0 flex-1 text-footnote">{lastRun.summary}</p>
          {fixRounds >= MAX_FIX_ROUNDS ? (
            <p className="text-footnote text-text-muted">{MAX_FIX_ROUNDS} corrections d'affilée sans succès : lisez l'erreur dans Build et tests, ou reformulez.</p>
          ) : (
            <Button size="sm" icon={<Wrench size={13} />} onClick={askFix}>
              Corriger avec l'agent ({fixRounds + 1}/{MAX_FIX_ROUNDS})
            </Button>
          )}
        </div>
      )}
      <ErrorLine message={error} onClose={() => setError(null)} />

      {installed.length > 0 && (
        <Composer
          prefill={prefill}
          adapters={adapters}
          adapterId={adapterId}
          model={session?.model ?? draft.model}
          autoMode={session?.autoMode ?? autoMode}
          busy={session?.status === "starting"}
          locked={Boolean(session && session.timeline.length > 0)}
          compact
          onAdapterChange={(id) => {
            const next = adapters.find((a) => a.id === id);
            const model = next?.defaultModel ?? null;
            if (session) void chat.setAdapter(session, id, model, next?.name);
            else setDraft((d) => ({ ...d, adapter: id, model }));
          }}
          onModelChange={(model) => {
            if (session) void chat.setModel(session, model);
            else setDraft((d) => ({ ...d, model }));
          }}
          onAutoModeChange={(mode) => {
            if (session) void chat.setAutoMode(session, mode);
            else setDraft((d) => ({ ...d, autoMode: mode }));
          }}
          running={running}
          onStop={() => session && void chat.stop(session)}
          onSend={(text, attachments) => void send(text, attachments)}
        />
      )}
    </div>
  );
}
