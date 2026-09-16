import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Code2, FolderOpen, Loader2, PanelRight, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, EmptyState } from "@/design-system/primitives";
import { Composer, ConversationView } from "@/core/chat";
import { useAdapters } from "@/core/engine/useAdapters";
import { useChat } from "@/core/engine/useChat";
import { engineApi } from "@/core/engine/engine.api";
import { useUiStore } from "@/core/stores/ui.store";
import type { AutoMode, PromptAnswer } from "@/core/engine/types";
import { codeApi, type FileContent, type FileEntry, type ProjectInfo } from "./api";
import { FileTree } from "./components/FileTree";
import { CodeEditor } from "./components/CodeEditor";

const STORAGE_KEY = "archimed.code.root";

export default function CodeModule() {
  const { adapters } = useAdapters();
  const chat = useChat();
  const handoff = useUiStore((s) => s.moduleParams["code"]);
  const clearParams = useUiStore((s) => s.clearModuleParams);

  const [root, setRoot] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [openFiles, setOpenFiles] = useState<FileContent[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [loadingFile, setLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(true);

  const installed = useMemo(() => adapters.filter((a) => a.installed), [adapters]);
  const session = chat.sessions.find((s) => s.id === chat.activeId) ?? null;
  const adapter = adapters.find((a) => a.id === session?.adapter);

  // Dossier initial : passé par un autre module, mémorisé, ou dossier utilisateur.
  useEffect(() => {
    const fromHandoff = typeof handoff?.["cwd"] === "string" ? (handoff["cwd"] as string) : null;
    if (fromHandoff) {
      setRoot(fromHandoff);
      clearParams("code");
      return;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setRoot(stored);
      return;
    }
    engineApi
      .defaultCwd()
      .then(setRoot)
      .catch(() => setRoot(null));
  }, [handoff, clearParams]);

  useEffect(() => {
    if (!root) return;
    localStorage.setItem(STORAGE_KEY, root);
    setOpenFiles([]);
    setActivePath(null);
    setTargets([]);
    codeApi
      .projectInfo(root)
      .then(setProject)
      .catch(() => setProject(null));
  }, [root]);

  // Une conversation par projet, réutilisée entre les visites.
  useEffect(() => {
    if (!root || installed.length === 0) return;
    const existing = chat.sessions.find((s) => s.cwd === root);
    if (existing) {
      if (chat.activeId !== existing.id) chat.setActive(existing.id);
      return;
    }
    const first = installed[0];
    if (!first) return;
    const id = chat.createSession({
      adapter: first.id,
      model: first.defaultModel,
      cwd: root,
      autoMode: "off",
    });
    chat.patch(id, { title: `Projet ${root.split(/[\\/]/).filter(Boolean).at(-1) ?? root}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, installed.length]);

  const openFile = useCallback(async (entry: FileEntry) => {
    setLoadingFile(true);
    setError(null);
    try {
      const file = await codeApi.readFile(entry.path);
      setOpenFiles((current) =>
        current.some((f) => f.path === file.path) ? current : [...current, file],
      );
      setActivePath(file.path);
    } catch (e) {
      setError((e as { message?: string }).message ?? "Lecture impossible");
    } finally {
      setLoadingFile(false);
    }
  }, []);

  const pickRoot = async () => {
    const selected = await open({ directory: true, title: "Ouvrir un projet" });
    if (typeof selected === "string") setRoot(selected);
  };

  const handleSend = async (text: string, attachments: string[], targeted: string[]) => {
    if (!session) return;
    setError(null);
    try {
      await chat.send(session, text, attachments, targeted);
    } catch (e) {
      setError((e as { message?: string }).message ?? "Envoi impossible");
    }
  };

  const handleAnswer = (promptId: string, payload: PromptAnswer) => {
    if (session) void chat.answer(session, promptId, payload);
  };

  const handleAutoMode = (mode: AutoMode) => {
    if (session) void chat.setAutoMode(session, mode);
  };

  const active = openFiles.find((file) => file.path === activePath) ?? null;

  if (!root) {
    return (
      <EmptyState
        icon={<Code2 size={28} strokeWidth={1.5} />}
        title="Ouvrir un projet"
        description="Choisissez un dossier pour explorer son code et demander des modifications à une IA."
        action={
          <Button variant="primary" onClick={() => void pickRoot()}>
            <FolderOpen size={14} strokeWidth={1.75} />
            Choisir un dossier
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full">
      <FileTree
        root={root}
        activePath={activePath}
        onOpenFile={(entry) => void openFile(entry)}
        onChangeRoot={() => void pickRoot()}
      />

      <div className="flex min-w-[280px] flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2">
          {openFiles.length === 0 ? (
            <span className="px-2 text-footnote text-text-subtle">
              {project?.isProject
                ? `Projet ${project.name} · ${project.kinds.join(", ")}`
                : "Aucun fichier ouvert"}
            </span>
          ) : (
            openFiles.map((file) => {
              const isActive = file.path === activePath;
              return (
                <div
                  key={file.path}
                  className={cn(
                    "group flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2 text-footnote transition-colors",
                    isActive
                      ? "bg-accent-soft text-text"
                      : "text-text-muted hover:bg-surface-2 hover:text-text",
                  )}
                >
                  <button onClick={() => setActivePath(file.path)} className="max-w-40 truncate">
                    {file.path.split(/[\\/]/).at(-1)}
                  </button>
                  <button
                    aria-label={`Fermer ${file.path}`}
                    onClick={() => {
                      setOpenFiles((current) => current.filter((f) => f.path !== file.path));
                      if (activePath === file.path) {
                        const rest = openFiles.filter((f) => f.path !== file.path);
                        setActivePath(rest.at(-1)?.path ?? null);
                      }
                    }}
                    className="text-text-subtle opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </div>
              );
            })
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
            {active && (
              <>
                <Badge tone="neutral">{active.language}</Badge>
                <Badge tone="neutral">{active.lines} lignes</Badge>
                {active.truncated && <Badge tone="warning">tronqué</Badge>}
              </>
            )}
            <button
              onClick={() => setChatOpen((open) => !open)}
              aria-label={chatOpen ? "Masquer l'assistant" : "Afficher l'assistant"}
              title={chatOpen ? "Masquer l'assistant" : "Afficher l'assistant"}
              className={cn(
                "flex size-7 items-center justify-center rounded-sm transition-colors",
                chatOpen ? "text-accent" : "text-text-subtle hover:text-text",
              )}
            >
              <PanelRight size={14} strokeWidth={1.75} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          {loadingFile ? (
            <div className="flex h-full items-center justify-center text-text-subtle">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : (
            <CodeEditor file={active} />
          )}
        </div>

        {error && <p className="px-4 pb-2 text-footnote text-danger">{error}</p>}
      </div>

      {chatOpen && (
      <section className="flex w-[clamp(300px,30%,440px)] shrink-0 flex-col border-l border-border">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <span className="truncate text-body-sm font-medium">
            {session?.title ?? "Assistant"}
          </span>
          {adapter && <Badge tone="neutral">{adapter.name}</Badge>}
          {targets.length > 0 && <Badge tone="accent">{targets.length} ciblé(s)</Badge>}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {session && session.timeline.length > 0 ? (
            <ConversationView
              session={session}
              agentName={adapter?.name ?? session.adapter}
              onAnswer={handleAnswer}
              compact
            />
          ) : (
            <EmptyState
              title={installed.length === 0 ? "Aucune CLI détectée" : "Modifier ce projet"}
              description={
                installed.length === 0
                  ? "Configurez une CLI dans Réglages > Moteur."
                  : "Glissez un fichier depuis l'arborescence pour le cibler, puis décrivez la modification."
              }
            />
          )}
        </div>

        {session && (
          <Composer
            adapters={adapters}
            adapterId={session.adapter}
            model={session.model}
            autoMode={session.autoMode}
            busy={session.status === "starting" || installed.length === 0}
            locked={session.timeline.length > 0}
            targets={targets}
            onTargetsChange={setTargets}
            compact
            onAdapterChange={(id) =>
              chat.patch(session.id, {
                adapter: id,
                model: adapters.find((a) => a.id === id)?.defaultModel ?? null,
              })
            }
            onModelChange={(model) => chat.patch(session.id, { model })}
            onAutoModeChange={handleAutoMode}
            onSend={(text, attachments, targeted) => void handleSend(text, attachments, targeted)}
          />
        )}
      </section>
      )}
    </div>
  );
}
