import { useCallback, useEffect, useMemo, useState } from "react";
import { MessagesSquare, Loader2, Globe, ListChecks } from "lucide-react";
import { Slot } from "@/core/modules";
import { cn } from "@/core/lib/cn";
import { Button, EmptyState, ResizeHandle, usePanelSize } from "@/design-system/primitives";
import { PreviewPane, usePreviewTargets } from "@/core/preview";
import type { AutoMode, PromptAnswer } from "@/core/engine/types";
import { useAdapters } from "@/core/engine/useAdapters";
import { useChat } from "@/core/engine/useChat";
import { useAutoContinue } from "@/core/engine/useAutoContinue";
import { useMessageQueue } from "@/core/engine/useMessageQueue";
import { useTurnAttention } from "@/core/engine/useAttention";
import { engineApi } from "@/core/engine/engine.api";
import type { ChatSession } from "@/core/engine/session.store";
import { Composer, ConversationView, TodoPanel, conversationMarkdown, modelLabel } from "@/core/chat";
import { useService } from "@/core/modules";
import { useUiStore } from "@/core/stores/ui.store";
import { SessionList } from "./components/SessionList";
import { ProjectBanner } from "./components/ProjectBanner";
import { RawTerminalDrawer } from "./components/RawTerminalDrawer";
import { ChangesPanel } from "./components/ChangesPanel";
import { ChangesButton, ContextMeter, CopyConversationButton } from "./components/HeaderTools";
import { useGitStatus } from "./lib/useGitStatus";

/** Envoie les messages en file d'une conversation, même quand elle n'est pas affichée. */
function QueueRunner({
  session,
  send,
}: {
  session: ChatSession;
  send: (chat: ChatSession, text: string, attachments: string[], targets: string[]) => Promise<void>;
}) {
  useMessageQueue(session, send);
  return null;
}

const ACTIVE = ["starting", "running", "awaiting"];

/** Contrat minimal du service `code.project` (le type réel vit dans le module Code). */
type DetectedProject = {
  root: string;
  name: string;
  kinds: string[];
  isProject: boolean;
};
type CodeProjectService = { projectInfo: (path: string) => Promise<DetectedProject> };

export default function ChatModule() {
  const { adapters, loading, error } = useAdapters();
  const chat = useChat();
  const [defaultCwd, setDefaultCwd] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [project, setProject] = useState<DetectedProject | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [renaming, setRenaming] = useState(false);
  /** Messages en file rendus à la zone de saisie quand la personne arrête l'agent. */
  const [draft, setDraft] = useState<string | undefined>(undefined);
  /** Panneau de droite : aperçu (page, serveur) ou modifications git. */
  const [side, setSide] = useState<"preview" | "changes" | null>(null);
  const openModule = useUiStore((s) => s.openModule);
  // Message préparé par un autre module (« relis cette candidature », « corrige ce fichier ») :
  // il arrive dans la zone de saisie, la personne le relit et l'envoie elle-même.
  const handoff = useUiStore((s) => s.moduleParams["chat"]);
  const clearParams = useUiStore((s) => s.clearModuleParams);
  const prefill = typeof handoff?.["prompt"] === "string" ? (handoff["prompt"] as string) : undefined;
  useEffect(() => {
    if (prefill) clearParams("chat");
  }, [prefill, clearParams]);
  // Service optionnel : si le module Code est désactivé, aucune proposition n'apparaît.
  const codeProject = useService<CodeProjectService>("code.project");

  const installed = useMemo(() => adapters.filter((a) => a.installed), [adapters]);
  // Les conversations ouvertes depuis le module Code restent dans le module Code.
  const chatSessions = useMemo(
    () => chat.sessions.filter((s) => s.origin === "chat"),
    [chat.sessions],
  );
  const session = chat.session;
  const adapter = adapters.find((a) => a.id === session?.adapter);
  const agentName = adapter?.name ?? session?.adapter ?? "l'agent";
  const running = Boolean(session && ACTIVE.includes(session.status));
  // Réponse coupée en route (agent arrêté après une action) : relancée automatiquement.
  useAutoContinue(session, chat.continueTurn);
  // ARCHIMED en arrière-plan : la barre des tâches signale la fin d'un tour ou une question.
  useTurnAttention(chat.sessions);

  // Aperçu : serveur de test lancé par l'agent ou page HTML créée. Rien ne s'affiche sinon.
  const previewTargets = usePreviewTargets(session?.timeline);
  const [previewWidth, setPreviewWidth] = usePanelSize("chat.preview", 560, 320, 1200);
  const [changesWidth, setChangesWidth] = usePanelSize("chat.changes", 420, 300, 900);
  const [listWidth, setListWidth] = usePanelSize("chat.sessions", 256, 200, 440);
  const liveServer = previewTargets.find((target) => target.kind === "server");

  // Modifications du dossier (git) : relues à chaque action terminée de l'agent.
  const revision = useMemo(
    () => session?.timeline.filter((item) => item.kind === "tool" && item.output !== undefined).length ?? 0,
    [session?.timeline],
  );
  const git = useGitStatus(session?.cwd, revision, running);

  const lastUser = useMemo(
    () => [...(session?.timeline ?? [])].reverse().find((item) => item.kind === "user"),
    [session?.timeline],
  );

  // Le dossier de travail ressemble-t-il à un projet de code ?
  useEffect(() => {
    const cwd = session?.cwd;
    if (!codeProject || !cwd) {
      setProject(null);
      return;
    }
    let alive = true;
    codeProject
      .projectInfo(cwd)
      .then((info) => alive && setProject(info.isProject ? info : null))
      .catch(() => alive && setProject(null));
    return () => {
      alive = false;
    };
  }, [codeProject, session?.cwd]);

  useEffect(() => {
    engineApi
      .defaultCwd()
      .then(setDefaultCwd)
      .catch(() => setDefaultCwd(null));
  }, []);

  useEffect(() => setRenaming(false), [session?.id]);
  // Texte rendu à la zone de saisie : pris en compte au rendu, puis oublié.
  useEffect(() => {
    if (draft !== undefined) setDraft(undefined);
  }, [draft]);

  const createSession = () => {
    // Même agent, modèle et dossier que la conversation ouverte ; sinon la première CLI installée.
    const current = session && installed.some((a) => a.id === session.adapter) ? session : null;
    const first = installed[0];
    if (!current && !first) return;
    chat.createSession({
      adapter: current?.adapter ?? first!.id,
      model: current ? current.model : first!.defaultModel,
      cwd: session?.cwd ?? defaultCwd,
      autoMode: current?.autoMode ?? "off",
    });
    setActionError(null);
  };

  const { send, patch } = chat;
  const sendTo = useCallback(
    async (target: ChatSession, text: string, attachments: string[], targets: string[]) => {
      setActionError(null);
      try {
        await send(target, text, attachments, targets);
      } catch (e) {
        setActionError((e as { message?: string }).message ?? "Impossible de démarrer la session");
        patch(target.id, { status: "error" });
      }
    },
    [send, patch],
  );

  const handleSend = (text: string, attachments: string[], targets: string[]) => {
    if (session) void sendTo(session, text, attachments, targets);
  };

  /** Demande venue d'un bouton (commit, relecture…) : envoyée, ou mise en file si l'agent travaille. */
  const ask = (text: string) => {
    if (!session) return;
    if (running) chat.enqueue(session, text);
    else handleSend(text, [], []);
  };

  /** Arrêt : la file n'est pas envoyée dans la foulée, son texte revient dans la zone de saisie. */
  const handleStop = () => {
    if (!session) return;
    const queued = session.queue ?? [];
    if (queued.length > 0) {
      chat.patch(session.id, { queue: [] });
      setDraft(queued.map((message) => message.text).join("\n\n"));
    }
    void chat.stop(session);
  };

  const handleAnswer = (promptId: string, payload: PromptAnswer) => {
    if (!session) return;
    void chat.answer(session, promptId, payload);
  };

  const handleAutoMode = (mode: AutoMode) => {
    if (session) void chat.setAutoMode(session, mode);
  };

  // Mode plan : Claude Code seulement (`--permission-mode plan`).
  const planCapable = session?.adapter === "claude";
  const planMode = Boolean(session?.options?.planMode);
  const togglePlan = (value: boolean) => {
    if (session) void chat.setPlanMode(session, value);
  };

  const copyText = () => (session ? conversationMarkdown(session, agentName) : "");

  const handleAppCommand = (name: string) => {
    if (!session) return;
    setActionError(null);
    switch (name) {
      case "nouveau":
        createSession();
        break;
      case "plan":
        if (planCapable) togglePlan(!planMode);
        else setActionError("Le mode plan n'existe qu'avec Claude Code.");
        break;
      case "modifications":
        setSide("changes");
        break;
      case "copier":
        void navigator.clipboard.writeText(copyText());
        break;
      case "renommer":
        setRenaming(true);
        break;
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-text-subtle">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<MessagesSquare size={28} strokeWidth={1.5} />}
        title="Moteur indisponible"
        description={error}
      />
    );
  }

  const busy = session?.status === "starting";
  const started = Boolean(session && session.timeline.length > 0);
  const showPreview = side === "preview" && previewTargets.length > 0;
  const showChanges = side === "changes" && Boolean(session?.cwd);

  return (
    <div className="flex h-full">
      {chatSessions.map((target) => (
        <QueueRunner key={target.id} session={target} send={sendTo} />
      ))}
      <SessionList
        sessions={chatSessions}
        activeId={chat.activeId}
        onSelect={chat.setActive}
        onCreate={createSession}
        onDelete={(target) => void chat.remove(target)}
        onRename={(target, title) => chat.patch(target.id, { title })}
        describeModel={(target) =>
          target.model
            ? modelLabel(adapters.find((a) => a.id === target.adapter)?.models ?? [], target.model)
            : target.adapter
        }
        width={listWidth}
      />
      <ResizeHandle size={listWidth} onResize={setListWidth} panel="before" label="Largeur de la liste des conversations" defaultSize={256} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
          {session ? (
            <>
              {renaming ? (
                <input
                  autoFocus
                  defaultValue={session.title}
                  aria-label="Titre de la conversation"
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={(event) => {
                    const title = event.currentTarget.value.trim();
                    if (title && event.currentTarget.dataset.cancel !== "1") chat.patch(session.id, { title });
                    setRenaming(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") event.currentTarget.dataset.cancel = "1";
                    if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
                  }}
                  className="h-7 min-w-0 max-w-80 flex-1 rounded-sm border border-border-strong bg-bg px-2 text-body-sm font-medium outline-none"
                />
              ) : (
                <span
                  className="min-w-0 truncate text-body-sm font-medium"
                  title={`${session.title} — double-clic pour renommer`}
                  onDoubleClick={() => setRenaming(true)}
                >
                  {session.title}
                </span>
              )}
              {planMode && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-caption font-medium text-info">
                  <ListChecks size={11} strokeWidth={1.75} aria-hidden />
                  Plan
                </span>
              )}
            </>
          ) : (
            <span className="text-body-sm text-text-subtle">Aucune conversation ouverte</span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {session && (
              <ContextMeter
                context={session.context}
                onCompact={
                  session.slashCommands?.includes("compact") ? () => ask("/compact") : undefined
                }
              />
            )}
            {previewTargets.length > 0 && (
              <button
                onClick={() => setSide((value) => (value === "preview" ? null : "preview"))}
                aria-pressed={showPreview}
                title={showPreview ? "Masquer l'aperçu" : "Prévisualiser"}
                className={cn(
                  "flex h-7 max-w-48 items-center gap-1.5 rounded-full border px-2.5 text-footnote transition-colors",
                  showPreview
                    ? "border-accent/50 bg-accent-soft text-accent"
                    : "border-border text-text-muted hover:border-border-strong hover:text-text",
                )}
              >
                {liveServer ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
                ) : (
                  <Globe size={12} strokeWidth={1.75} className="shrink-0" />
                )}
                <span className="truncate">{liveServer ? liveServer.label : "Aperçu"}</span>
              </button>
            )}
            {session?.cwd && (git.status || showChanges) && (
              <ChangesButton
                status={git.status}
                open={showChanges}
                onToggle={() => setSide((value) => (value === "changes" ? null : "changes"))}
              />
            )}
            {started && <CopyConversationButton getText={copyText} />}
            <Slot name="chat.header.right" />
          </div>
        </header>

        {project && session?.cwd && !dismissed.includes(project.root) && (
          <div className="px-6 pt-3">
            <ProjectBanner
              name={project.name}
              kinds={project.kinds}
              onOpen={() => openModule("code", { cwd: project.root })}
              onDismiss={() => setDismissed((current) => [...current, project.root])}
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {session && session.timeline.length > 0 ? (
            <ConversationView
              session={session}
              agentName={agentName}
              onAnswer={handleAnswer}
              onRetry={lastUser?.kind === "user" ? () => handleSend(lastUser.text, lastUser.attachments ?? [], []) : undefined}
            />
          ) : (
            <EmptyState
              icon={<MessagesSquare size={28} strokeWidth={1.5} />}
              title={
                installed.length === 0
                  ? "Aucune CLI détectée"
                  : session
                    ? "Conversation prête"
                    : "Démarrer une conversation"
              }
              description={
                installed.length === 0
                  ? "Installez Claude Code, Antigravity ou Codex — ou indiquez le chemin d'un exécutable dans Réglages > Moteur."
                  : session
                    ? `Dossier de travail : ${session.cwd ?? "par défaut"}. Posez une question ou demandez une modification — « / » pour les commandes, « @ » pour citer un fichier.`
                    : "Créez une conversation pour commencer."
              }
              action={
                installed.length > 0 && !session ? (
                  <Button variant="primary" onClick={createSession}>
                    Nouvelle conversation
                  </Button>
                ) : undefined
              }
            />
          )}
          {actionError && (
            <p role="alert" className="pb-4 text-center text-footnote text-danger">{actionError}</p>
          )}
        </div>

        <RawTerminalDrawer raw={session?.raw ?? ""} />

        {session && <TodoPanel timeline={session.timeline} running={running} />}

        {session && (
          <Composer
            prefill={draft ?? prefill}
            adapters={adapters}
            adapterId={session.adapter}
            model={session.model}
            cwd={session.cwd}
            autoMode={session.autoMode}
            busy={busy || installed.length === 0}
            locked={started}
            onAdapterChange={(id) => {
              const next = adapters.find((a) => a.id === id);
              void chat.setAdapter(session, id, next?.defaultModel ?? null, next?.name);
            }}
            onModelChange={(model) => void chat.setModel(session, model)}
            onCwdChange={(cwd) => void chat.setCwd(session, cwd)}
            onAutoModeChange={handleAutoMode}
            running={running}
            onStop={handleStop}
            onSend={handleSend}
            queue={session.queue}
            onQueue={(text, attachments, targets) => chat.enqueue(session, text, attachments, targets)}
            onUnqueue={(id) => chat.unqueue(session, id)}
            planMode={planMode}
            onPlanModeChange={planCapable ? togglePlan : undefined}
            slashCommands={session.slashCommands}
            onAppCommand={handleAppCommand}
            lastUserText={lastUser?.kind === "user" ? lastUser.text : undefined}
          />
        )}
      </div>

      {showPreview && (
        <>
          <ResizeHandle size={previewWidth} onResize={setPreviewWidth} panel="after" label="Largeur de l'aperçu" defaultSize={560} />
          <PreviewPane
            targets={previewTargets}
            onClose={() => setSide(null)}
            className="shrink-0"
            style={{ width: previewWidth }}
          />
        </>
      )}
      {showChanges && (
        <>
          <ResizeHandle size={changesWidth} onResize={setChangesWidth} panel="after" label="Largeur des modifications" defaultSize={420} />
          <ChangesPanel
            status={git.status}
            loading={git.loading}
            error={git.error}
            onRefresh={git.refresh}
            revision={revision}
            running={running}
            onAsk={ask}
            onClose={() => setSide(null)}
            className="shrink-0"
            style={{ width: changesWidth }}
          />
        </>
      )}
    </div>
  );
}
