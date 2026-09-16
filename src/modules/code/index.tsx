import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Code2, FolderOpen, Loader2, PanelRight, Plus, Save, Search, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, EmptyState, Select } from "@/design-system/primitives";
import { Composer, ConversationView } from "@/core/chat";
import { Slot } from "@/core/modules";
import { useAdapters } from "@/core/engine/useAdapters";
import { useChat } from "@/core/engine/useChat";
import { useSessionStore } from "@/core/engine/session.store";
import { engineApi } from "@/core/engine/engine.api";
import { useUiStore } from "@/core/stores/ui.store";
import type { AutoMode, PromptAnswer } from "@/core/engine/types";
import { codeApi, type FileContent, type FileEntry, type ProjectInfo } from "./api";
import { FileTree } from "./components/FileTree";
import { CodeEditor } from "./components/CodeEditor";
import { FilePalette } from "./components/FilePalette";

const STORAGE_KEY = "archimed.code.root";

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export default function CodeModule() {
  const { adapters } = useAdapters();
  const chat = useChat();
  const handoff = useUiStore((s) => s.moduleParams["code"]);
  const clearParams = useUiStore((s) => s.clearModuleParams);

  const [root, setRoot] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [openFiles, setOpenFiles] = useState<FileContent[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [activePath, setActivePath] = useState<string | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** Onglet modifié dont la fermeture attend un second clic (modifications perdues). */
  const [closeArmed, setCloseArmed] = useState<string | null>(null);

  /** Conversation choisie dans ce projet ; `null` = brouillon (créée au premier envoi). */
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ adapter: string; model: string | null; autoMode: AutoMode }>({
    adapter: "",
    model: null,
    autoMode: "off",
  });

  const installed = useMemo(() => adapters.filter((a) => a.installed), [adapters]);

  // Conversations du module Code pour ce projet — jamais visibles dans le module Chat.
  const projectSessions = useMemo(
    () => chat.sessions.filter((s) => s.origin === "code" && s.cwd === root),
    [chat.sessions, root],
  );
  const session = projectSessions.find((s) => s.id === sessionId) ?? null;
  const adapterId = session?.adapter ?? draft.adapter;
  const adapter = adapters.find((a) => a.id === adapterId);

  useEffect(() => {
    if (!draft.adapter && installed[0]) {
      setDraft((d) => ({ ...d, adapter: installed[0]!.id, model: installed[0]!.defaultModel }));
    }
  }, [installed, draft.adapter]);

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

  // Ouvrir un dossier ne crée aucune conversation : on reprend la plus récente s'il y en a une.
  useEffect(() => {
    if (!root) return;
    localStorage.setItem(STORAGE_KEY, root);
    setOpenFiles([]);
    setDrafts({});
    setActivePath(null);
    setTargets([]);
    const latest = useSessionStore
      .getState()
      .sessions.filter((s) => s.origin === "code" && s.cwd === root)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    setSessionId(latest?.id ?? null);
    codeApi
      .projectInfo(root)
      .then(setProject)
      .catch(() => setProject(null));
  }, [root]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  const active = openFiles.find((file) => file.path === activePath) ?? null;
  const activeDraft = active ? drafts[active.path] : undefined;
  const dirty = active !== null && activeDraft !== undefined && activeDraft !== active.content;

  const save = useCallback(async () => {
    if (!active || activeDraft === undefined || activeDraft === active.content) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await codeApi.writeFile(active.path, activeDraft);
      setOpenFiles((current) => current.map((f) => (f.path === saved.path ? saved : f)));
      setDrafts(({ [saved.path]: _saved, ...rest }) => rest);
    } catch (e) {
      setError((e as { message?: string }).message ?? "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }, [active, activeDraft]);

  /** Recharge les fichiers ouverts non modifiés (l'IA a pu les changer). */
  const reloadOpenFiles = useCallback(async () => {
    const refreshed = await Promise.all(
      openFiles.map((file) =>
        drafts[file.path] !== undefined
          ? Promise.resolve(file)
          : codeApi.readFile(file.path).catch(() => file),
      ),
    );
    setOpenFiles(refreshed);
  }, [openFiles, drafts]);

  // Chaque outil terminé par l'assistant peut avoir modifié un fichier ouvert : on relit.
  const completedTools =
    session?.timeline.filter((item) => item.kind === "tool" && item.ok !== undefined).length ?? 0;
  useEffect(() => {
    if (completedTools > 0) void reloadOpenFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedTools]);

  const pickRoot = async () => {
    const selected = await open({ directory: true, title: "Ouvrir un projet" });
    if (typeof selected === "string") setRoot(selected);
  };

  const handleSend = async (text: string, attachments: string[], targeted: string[]) => {
    if (!root) return;
    setError(null);
    try {
      let target = session;
      if (!target) {
        const id = chat.createSession({
          adapter: draft.adapter,
          model: draft.model,
          cwd: root,
          autoMode: draft.autoMode,
          origin: "code",
          title: `Projet ${folderName(root)}`,
          activate: false,
        });
        setSessionId(id);
        target = useSessionStore.getState().sessions.find((s) => s.id === id) ?? null;
      }
      if (target) await chat.send(target, text, attachments, targeted);
    } catch (e) {
      setError((e as { message?: string }).message ?? "Envoi impossible");
    }
  };

  const handleAnswer = (promptId: string, payload: PromptAnswer) => {
    if (session) void chat.answer(session, promptId, payload);
  };

  const handleAutoMode = (mode: AutoMode) => {
    if (session) void chat.setAutoMode(session, mode);
    else setDraft((d) => ({ ...d, autoMode: mode }));
  };

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
              const isDirty = drafts[file.path] !== undefined && drafts[file.path] !== file.content;
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
                    {folderName(file.path)}
                  </button>
                  {isDirty && (
                    <span className="size-1.5 rounded-full bg-accent" aria-label="Non enregistré" />
                  )}
                  <button
                    aria-label={
                      closeArmed === file.path
                        ? `Fermer sans enregistrer ${file.path}`
                        : `Fermer ${file.path}`
                    }
                    title={closeArmed === file.path ? "Cliquer à nouveau : modifications perdues" : undefined}
                    onClick={() => {
                      if (isDirty && closeArmed !== file.path) {
                        setCloseArmed(file.path);
                        return;
                      }
                      setCloseArmed(null);
                      setOpenFiles((current) => current.filter((f) => f.path !== file.path));
                      setDrafts(({ [file.path]: _closed, ...rest }) => rest);
                      if (activePath === file.path) {
                        const rest = openFiles.filter((f) => f.path !== file.path);
                        setActivePath(rest.at(-1)?.path ?? null);
                      }
                    }}
                    className={cn(
                      "transition-opacity hover:text-danger group-hover:opacity-100",
                      closeArmed === file.path ? "text-danger opacity-100" : "text-text-subtle opacity-0",
                    )}
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
                {active.truncated && <Badge tone="warning">tronqué</Badge>}
                {dirty && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={saving || active.truncated}
                    onClick={() => void save()}
                    title="Enregistrer (Ctrl+S)"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} strokeWidth={1.75} />}
                    Enregistrer
                  </Button>
                )}
              </>
            )}
            <button
              onClick={() => setPaletteOpen(true)}
              aria-label="Aller au fichier (Ctrl+P)"
              title="Aller au fichier (Ctrl+P)"
              className="flex size-7 items-center justify-center rounded-sm text-text-subtle hover:text-text"
            >
              <Search size={14} strokeWidth={1.75} />
            </button>
            <button
              onClick={() => setChatOpen((value) => !value)}
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
            <CodeEditor
              file={active}
              value={activeDraft}
              readOnly={active?.truncated ?? true}
              onChange={(content) => {
                if (active) setDrafts((current) => ({ ...current, [active.path]: content }));
              }}
              onSave={() => void save()}
            />
          )}
        </div>

        <Slot name="code.editor.footer" props={{ root }} />
        {error && <p className="px-4 pb-2 text-footnote text-danger">{error}</p>}
      </div>

      {chatOpen && (
        <section className="flex w-[clamp(300px,30%,440px)] shrink-0 flex-col border-l border-border">
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
            {projectSessions.length > 0 ? (
              <Select
                label="Conversation du projet"
                value={session?.id ?? "__draft"}
                onChange={(value) => setSessionId(value === "__draft" ? null : value)}
                className="min-w-0 max-w-56"
                options={[
                  ...projectSessions.map((s) => ({ value: s.id, label: s.title })),
                  { value: "__draft", label: "Nouvelle conversation" },
                ]}
              />
            ) : (
              <span className="truncate text-body-sm font-medium">Assistant</span>
            )}
            {targets.length > 0 && <Badge tone="accent">{targets.length} ciblé(s)</Badge>}
            {session && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                aria-label="Nouvelle conversation"
                title="Nouvelle conversation"
                onClick={() => setSessionId(null)}
              >
                <Plus size={13} strokeWidth={1.75} />
              </Button>
            )}
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
                    : "Glissez un fichier depuis l'arborescence pour le cibler, puis décrivez la modification. La conversation n'est créée qu'au premier message."
                }
              />
            )}
          </div>

          {installed.length > 0 && (
            <Composer
              adapters={adapters}
              adapterId={adapterId}
              model={session?.model ?? draft.model}
              autoMode={session?.autoMode ?? draft.autoMode}
              busy={session?.status === "starting"}
              locked={Boolean(session && session.timeline.length > 0)}
              targets={targets}
              onTargetsChange={setTargets}
              compact
              onAdapterChange={(id) => {
                const model = adapters.find((a) => a.id === id)?.defaultModel ?? null;
                if (session) chat.patch(session.id, { adapter: id, model });
                else setDraft((d) => ({ ...d, adapter: id, model }));
              }}
              onModelChange={(model) => {
                if (session) chat.patch(session.id, { model });
                else setDraft((d) => ({ ...d, model }));
              }}
              onAutoModeChange={handleAutoMode}
              onSend={(text, attachments, targeted) => void handleSend(text, attachments, targeted)}
            />
          )}
        </section>
      )}

      <FilePalette
        open={paletteOpen}
        root={root}
        onClose={() => setPaletteOpen(false)}
        onPick={(entry) => void openFile(entry)}
      />
    </div>
  );
}
