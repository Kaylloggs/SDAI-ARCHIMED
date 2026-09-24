import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Plus, Sparkles, Trash2, Wrench } from "lucide-react";
import { Composer, ConversationView } from "@/core/chat";
import { samePath } from "@/core/editor";
import { useAdapters } from "@/core/engine/useAdapters";
import { useAutoContinue } from "@/core/engine/useAutoContinue";
import { useChat } from "@/core/engine/useChat";
import { useSessionStore } from "@/core/engine/session.store";
import type { AutoMode, PromptAnswer } from "@/core/engine/types";
import { Button, EmptyState, ResizeHandle, Select, usePanelSize } from "@/design-system/primitives";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import type { WorkChange } from "@/core/ipc/bindings/WorkChange";
import type { WorkInfo } from "@/core/ipc/bindings/WorkInfo";
import { errorText, mcstudioApi } from "../../api";
import { fixRequest, MAX_FIX_ROUNDS } from "../../lib/assistant";
import { useMcStudioStore } from "../../store";
import { ChangesPanel } from "./ChangesPanel";

const ORIGIN = "mcstudio";

/** Suggestions pour démarrer : de vraies demandes, adaptées à n'importe quel mod. */
const IDEAS = [
  "Ajoute un minerai de rubis qui apparaît dans les montagnes, avec son lingot et les recettes de cuisson.",
  "Crée une épée et une pioche en rubis, avec leurs recettes et leurs noms en français et en anglais.",
  "Explique-moi comment est organisé ce projet et où ajouter un nouvel objet.",
];

/**
 * Onglet Assistant IA : conversation avec une CLI installée (Claude, Antigravity, Codex…)
 * qui travaille dans une copie du projet, et relecture de ses modifications avant qu'elles
 * n'entrent dans le projet.
 */
export function AssistantPanel({ project, onBuild }: { project: ProjectSummary; onBuild: () => void }) {
  const { adapters } = useAdapters();
  const chat = useChat();
  const meta = project.meta;
  const [work, setWork] = useState<WorkInfo | null>(null);
  const [changes, setChanges] = useState<WorkChange[]>([]);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draftChosen, setDraftChosen] = useState(false);
  const [draft, setDraft] = useState<{ adapter: string; model: string | null; autoMode: AutoMode }>({
    adapter: "",
    model: null,
    autoMode: "off",
  });
  const [prefill, setPrefill] = useState<string | undefined>(undefined);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [changesWidth, setChangesWidth] = usePanelSize("mcstudio.changes", 460, 320, 960);
  const focus = useMcStudioStore((s) => s.focus);
  const fixRounds = useMcStudioStore((s) => s.fixRounds[project.id] ?? 0);
  const build = useMcStudioStore((s) => s.builds[project.id]);
  const lastRecord = build?.record ?? project.lastBuild;

  const installed = useMemo(() => adapters.filter((a) => a.installed), [adapters]);
  useEffect(() => {
    if (!draft.adapter && installed[0]) {
      setDraft((d) => ({ ...d, adapter: installed[0]!.id, model: installed[0]!.defaultModel }));
    }
  }, [installed, draft.adapter]);

  // Copie de travail : créée à l'ouverture, remise à jour avant chaque message.
  useEffect(() => {
    let cancelled = false;
    mcstudioApi
      .agentPrepare(project.id)
      .then((info) => !cancelled && setWork(info))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const sessions = useMemo(
    () => chat.sessions.filter((s) => s.origin === ORIGIN && work !== null && s.cwd !== null && samePath(s.cwd, work.path)),
    [chat.sessions, work],
  );

  // Conversation demandée depuis l'accueil, sinon la plus récente du projet.
  useEffect(() => {
    if (focus?.projectId === project.id && sessions.some((s) => s.id === focus.conversationId)) {
      setSessionId(focus.conversationId);
      setDraftChosen(false);
      useMcStudioStore.getState().setFocus(null);
      return;
    }
    if (!sessionId && !draftChosen && sessions[0]) setSessionId(sessions[0].id);
  }, [focus, project.id, sessions, sessionId, draftChosen]);

  const session = sessions.find((s) => s.id === sessionId) ?? null;
  useAutoContinue(session, chat.continueTurn);
  const adapterId = session?.adapter ?? draft.adapter;
  const adapter = adapters.find((a) => a.id === adapterId);

  const refresh = useCallback(async () => {
    setLoadingChanges(true);
    try {
      setChanges(await mcstudioApi.agentChanges(project.id));
      setRevision((r) => r + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoadingChanges(false);
    }
  }, [project.id]);

  // Chaque fin de tour de l'IA : relecture de sa copie.
  const turns = session?.timeline.filter((item) => item.kind === "turn").length ?? 0;
  useEffect(() => {
    if (work) void refresh();
  }, [turns, work, refresh]);

  useEffect(() => {
    if (!deleteArmed) return;
    const timer = setTimeout(() => setDeleteArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [deleteArmed]);

  // Build réussi : le compteur de corrections repart de zéro.
  useEffect(() => {
    if (lastRecord?.status === "success" && fixRounds > 0) useMcStudioStore.getState().setFixRounds(project.id, 0);
  }, [lastRecord?.status, fixRounds, project.id]);

  if (!meta) return null;

  const send = async (text: string, attachments: string[]) => {
    setError(null);
    try {
      // Les fichiers modifiés dans l'éditeur depuis le dernier tour rejoignent la copie.
      const info = await mcstudioApi.agentPrepare(project.id);
      setWork(info);
      let target = session;
      if (!target) {
        const instructions = await mcstudioApi.agentInstructions(project.id);
        const id = chat.createSession({
          adapter: draft.adapter,
          model: draft.model,
          cwd: info.path,
          autoMode: draft.autoMode,
          origin: ORIGIN,
          title: meta.name,
          options: { appendSystemPrompt: instructions },
          activate: false,
        });
        setSessionId(id);
        setDraftChosen(false);
        target = useSessionStore.getState().sessions.find((s) => s.id === id) ?? null;
      }
      if (target) await chat.send(target, text, attachments);
      setPrefill(undefined);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const askFix = () => {
    if (!lastRecord || lastRecord.status !== "failed") return;
    useMcStudioStore.getState().setFixRounds(project.id, fixRounds + 1);
    setPrefill(fixRequest(lastRecord));
  };

  const running = Boolean(session && ["starting", "running", "awaiting"].includes(session.status));
  const failed = lastRecord?.status === "failed" && !build?.running;

  return (
    <div className="flex h-full min-h-0">
      <section aria-label="Conversation avec l'IA" className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          {sessions.length > 0 ? (
            <Select
              label="Conversation du projet"
              value={session?.id ?? "__draft"}
              onChange={(value) => {
                setDraftChosen(value === "__draft");
                setSessionId(value === "__draft" ? null : value);
              }}
              className="min-w-0 max-w-64"
              options={[
                ...sessions.map((s) => ({ value: s.id, label: `${s.title} · ${new Date(s.createdAt).toLocaleDateString("fr-FR")}` })),
                { value: "__draft", label: "Nouvelle conversation" },
              ]}
            />
          ) : (
            <span className="flex items-center gap-2 text-body-sm font-medium">
              <Sparkles size={14} className="text-accent" /> Assistant IA
            </span>
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
            <EmptyState
              title="Aucune CLI d'IA détectée"
              description="Installez Claude Code, Antigravity ou Codex, puis relancez la détection dans Réglages > Moteur."
            />
          ) : (
            <div className="mx-auto max-w-[560px] space-y-4 px-6 py-8">
              <div className="space-y-1.5">
                <h2 className="text-title-3 font-semibold">Demandez, l'IA code le mod</h2>
                <p className="text-body-sm text-text-muted">
                  Elle connaît la version de Minecraft ({meta.versions.minecraft}), le loader et ses règles, et travaille
                  dans une copie du projet : ses changements s'affichent à droite, fichier par fichier, et n'entrent dans
                  le projet que si vous les appliquez (avec un point de restauration).
                </p>
                <p className="text-footnote text-text-subtle">
                  Mode Auto « Smart » : elle écrit librement dans sa copie et vous demande pour le reste.
                </p>
              </div>
              <ul className="space-y-2">
                {IDEAS.map((idea) => (
                  <li key={idea}>
                    <button
                      type="button"
                      onClick={() => setPrefill(idea)}
                      className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-left text-body-sm text-text-muted transition-colors hover:border-border-strong hover:text-text"
                    >
                      {idea}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {failed && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-danger-soft px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 text-danger" />
            <p className="min-w-0 flex-1 text-footnote">
              Dernière compilation en échec{lastRecord?.issues.length ? ` : ${lastRecord.issues[0]!.title.toLowerCase()}` : ""}.
            </p>
            {fixRounds >= MAX_FIX_ROUNDS ? (
              <p className="text-footnote text-text-muted">
                {MAX_FIX_ROUNDS} corrections d'affilée sans succès : regardez l'erreur dans l'onglet Build, ou reformulez.
              </p>
            ) : (
              <Button type="button" size="sm" onClick={askFix} icon={<Wrench size={13} />}>
                Corriger avec l'IA ({fixRounds + 1}/{MAX_FIX_ROUNDS})
              </Button>
            )}
          </div>
        )}
        {lastRecord?.status === "success" && build?.record && !build.running && (
          <p className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2 text-footnote text-success">
            <CheckCircle2 size={14} /> Compilation réussie : le mod est dans dist/.
          </p>
        )}
        {build?.running && (
          <p className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2 text-footnote text-text-muted">
            <Loader2 size={13} className="animate-spin" /> Compilation du projet{build.currentTask ? ` · ${build.currentTask}` : "…"}
          </p>
        )}

        {error && (
          <p role="alert" className="shrink-0 border-t border-border bg-danger-soft px-3 py-2 text-footnote">
            {error}
          </p>
        )}

        {installed.length > 0 && work && (
          <Composer
            prefill={prefill}
            adapters={adapters}
            adapterId={adapterId}
            model={session?.model ?? draft.model}
            autoMode={session?.autoMode ?? draft.autoMode}
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
      </section>

      <ResizeHandle
        size={changesWidth}
        onResize={setChangesWidth}
        panel="after"
        label="Largeur des modifications proposées"
        defaultSize={460}
      />
      <aside style={{ width: changesWidth }} className="flex shrink-0 flex-col bg-bg-subtle">
        <ChangesPanel
          projectId={project.id}
          changes={changes}
          loading={loadingChanges}
          revision={revision}
          onRefresh={() => void refresh()}
          onBuild={onBuild}
        />
      </aside>
    </div>
  );
}
