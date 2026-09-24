import { useEffect, useMemo, useState } from "react";
import { MessagesSquare, Loader2, FolderOpen, Globe } from "lucide-react";
import { Slot } from "@/core/modules";
import { cn } from "@/core/lib/cn";
import { Badge, Button, EmptyState, ResizeHandle, usePanelSize } from "@/design-system/primitives";
import { PreviewPane, usePreviewTargets } from "@/core/preview";
import type { AutoMode, PromptAnswer } from "@/core/engine/types";
import { useAdapters } from "@/core/engine/useAdapters";
import { useChat } from "@/core/engine/useChat";
import { useAutoContinue } from "@/core/engine/useAutoContinue";
import { engineApi } from "@/core/engine/engine.api";
import { Composer, ConversationView, modelLabel } from "@/core/chat";
import { useService } from "@/core/modules";
import { useUiStore } from "@/core/stores/ui.store";
import { SessionList, folderName, formatDate } from "./components/SessionList";
import { ProjectBanner } from "./components/ProjectBanner";
import { RawTerminalDrawer } from "./components/RawTerminalDrawer";

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
  // Réponse coupée en route (agent arrêté après une action) : relancée automatiquement.
  useAutoContinue(session, chat.continueTurn);

  // Aperçu : serveur de test lancé par l'agent ou page HTML créée. Rien ne s'affiche sinon.
  const previewTargets = usePreviewTargets(session?.timeline);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewWidth, setPreviewWidth] = usePanelSize("chat.preview", 560, 320, 1200);
  const liveServer = previewTargets.find((target) => target.kind === "server");

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

  const createSession = () => {
    const first = installed[0];
    if (!first) return;
    chat.createSession({
      adapter: first.id,
      model: first.defaultModel,
      cwd: session?.cwd ?? defaultCwd,
      autoMode: "off",
    });
    setActionError(null);
  };

  const handleSend = async (text: string, attachments: string[], targets: string[]) => {
    if (!session) return;
    setActionError(null);
    try {
      await chat.send(session, text, attachments, targets);
    } catch (e) {
      setActionError((e as { message?: string }).message ?? "Impossible de démarrer la session");
      chat.patch(session.id, { status: "error" });
    }
  };

  const handleAnswer = (promptId: string, payload: PromptAnswer) => {
    if (!session) return;
    void chat.answer(session, promptId, payload);
  };

  const handleAutoMode = (mode: AutoMode) => {
    if (session) void chat.setAutoMode(session, mode);
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

  return (
    <div className="flex h-full">
      <SessionList
        sessions={chatSessions}
        activeId={chat.activeId}
        onSelect={chat.setActive}
        onCreate={createSession}
        onDelete={(target) => void chat.remove(target)}
        describeModel={(target) =>
          target.model
            ? modelLabel(adapters.find((a) => a.id === target.adapter)?.models ?? [], target.model)
            : target.adapter
        }
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
          {session ? (
            <>
              <span className="truncate text-body-sm font-medium">{session.title}</span>
              <Badge tone="neutral">{adapter?.name ?? session.adapter}</Badge>
              {session.model && <Badge tone="neutral">{modelLabel(adapter?.models ?? [], session.model)}</Badge>}
              <span className="hidden items-center gap-1 text-footnote text-text-subtle md:inline-flex">
                <FolderOpen size={11} strokeWidth={1.75} />
                {folderName(session.cwd)}
              </span>
              <span className="text-footnote text-text-subtle">
                · {formatDate(session.createdAt)}
              </span>
              {session.usage.inputTokens + session.usage.outputTokens > 0 && (
                <span className="text-footnote text-text-subtle">
                  · {session.usage.inputTokens + session.usage.outputTokens} tokens
                </span>
              )}
            </>
          ) : (
            <span className="text-body-sm text-text-subtle">Aucune conversation ouverte</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {previewTargets.length > 0 && (
              <button
                onClick={() => setPreviewOpen((value) => !value)}
                aria-pressed={previewOpen}
                title={previewOpen ? "Masquer l'aperçu" : "Prévisualiser"}
                className={cn(
                  "flex h-7 max-w-48 items-center gap-1.5 rounded-full border px-2.5 text-footnote transition-colors",
                  previewOpen
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
              agentName={adapter?.name ?? session.adapter}
              onAnswer={handleAnswer}
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
                    ? `Dossier de travail : ${session.cwd ?? "par défaut"}. Posez une question ou demandez une modification.`
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
            <p className="pb-4 text-center text-footnote text-danger">{actionError}</p>
          )}
        </div>

        <RawTerminalDrawer raw={session?.raw ?? ""} />

        {session && (
          <Composer
            prefill={prefill}
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
            running={Boolean(session && ["starting", "running", "awaiting"].includes(session.status))}
            onStop={() => session && void chat.stop(session)}
            onSend={(text, attachments, targets) => void handleSend(text, attachments, targets)}
          />
        )}
      </div>

      {previewOpen && previewTargets.length > 0 && (
        <>
          <ResizeHandle size={previewWidth} onResize={setPreviewWidth} panel="after" label="Largeur de l'aperçu" defaultSize={560} />
          <PreviewPane
            targets={previewTargets}
            onClose={() => setPreviewOpen(false)}
            className="shrink-0"
            style={{ width: previewWidth }}
          />
        </>
      )}
    </div>
  );
}
