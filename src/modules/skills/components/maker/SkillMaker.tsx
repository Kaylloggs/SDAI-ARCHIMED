import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, Sparkles, Trash2 } from "lucide-react";
import { Composer, ConversationView } from "@/core/chat";
import { useAdapters } from "@/core/engine/useAdapters";
import { useAutoContinue } from "@/core/engine/useAutoContinue";
import { useChat } from "@/core/engine/useChat";
import { useSessionStore, type ChatSession } from "@/core/engine/session.store";
import type { AutoMode, PromptAnswer } from "@/core/engine/types";
import { Badge, Button, EmptyState, ResizeHandle, Select, usePanelSize } from "@/design-system/primitives";
import { errorText, skillsApi, type DraftInfo } from "../../api";
import { improveMessage, makerInstructions, type SkillLanguage } from "../../lib/maker";
import { Inspector } from "./Inspector";
import { StartPanel, type StartRequest } from "./StartPanel";
import { ORIGIN_SKILLS as ORIGIN, draftOfSession, makerSession } from "./origin";

const LANGUAGE_KEY = "archimed.skills.language";

function storedLanguage(): SkillLanguage {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}

/** Ouverture de l'atelier : `fresh` (écran de départ), brouillon précis, ou skill à améliorer. */
export type MakerOpen = { fresh?: boolean; draftId?: string; improve?: { id: string; name: string } };

type Props = {
  /** Brouillon à ouvrir (depuis l'accueil), ou skill à améliorer (depuis la bibliothèque). */
  open: MakerOpen | null;
  onBack: () => void;
  onSaved: () => void;
};

/**
 * Atelier de skills : une IA écrit le skill dans un brouillon (conversation au centre), la
 * personne vérifie, teste et enregistre (inspecteur à droite). Rien n'entre dans la
 * bibliothèque sans « Enregistrer ».
 */
export function SkillMaker({ open, onBack, onSaved }: Props) {
  const { adapters } = useAdapters();
  const chat = useChat();
  const [drafts, setDrafts] = useState<DraftInfo[] | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [language, setLanguage] = useState<SkillLanguage>(storedLanguage);
  const [agent, setAgent] = useState<{ adapter: string; model: string | null; autoMode: AutoMode }>({
    adapter: "",
    model: null,
    autoMode: "smart",
  });
  const [prefill, setPrefill] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [inspectorWidth, setInspectorWidth] = usePanelSize("skills.inspector", 440, 320, 720);
  const handled = useRef<typeof open>(null);

  const installed = useMemo(() => adapters.filter((a) => a.installed), [adapters]);
  useEffect(() => {
    if (!agent.adapter && installed[0]) {
      setAgent((a) => ({ ...a, adapter: installed[0]!.id, model: installed[0]!.defaultModel }));
    }
  }, [installed, agent.adapter]);

  useEffect(() => {
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // Stockage indisponible : le choix vaut pour cette fenêtre.
    }
  }, [language]);

  const reload = useCallback(async () => {
    try {
      const list = await skillsApi.draftList();
      setDrafts(list);
      return list;
    } catch (e) {
      setError(errorText(e));
      setDrafts([]);
      return [];
    }
  }, []);

  // Ouverture : brouillon demandé, skill à améliorer, sinon le plus récent.
  useEffect(() => {
    if (handled.current === open && drafts !== null) return;
    handled.current = open;
    void (async () => {
      const list = await reload();
      if (open?.improve) {
        try {
          const draft = await skillsApi.draftCreate(open.improve.id);
          await reload();
          setDraftId(draft.id);
          setPrefill(improveMessage(open.improve.name));
        } catch (e) {
          setError(errorText(e));
        }
      } else if (open?.fresh) {
        setDraftId(null);
      } else if (open?.draftId && list.some((d) => d.id === open.draftId)) {
        setDraftId(open.draftId);
      } else {
        setDraftId((current) => current ?? list[0]?.id ?? null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const draft = drafts?.find((d) => d.id === draftId) ?? null;
  const session = makerSession(chat.sessions, draft);
  useAutoContinue(session, chat.continueTurn);
  const adapterId = session?.adapter ?? agent.adapter;
  const adapter = adapters.find((a) => a.id === adapterId);

  // Chaque fin de tour de l'IA : fichiers, vérification et nom du brouillon relus.
  const turns = session?.timeline.filter((item) => item.kind === "turn").length ?? 0;
  useEffect(() => {
    if (!draft) return;
    setRevision((r) => r + 1);
    void skillsApi
      .draftInfo(draft.id)
      .then((info) => setDrafts((list) => list?.map((d) => (d.id === info.id ? info : d)) ?? list))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, draft?.id]);

  useEffect(() => {
    if (!deleteArmed) return;
    const timer = setTimeout(() => setDeleteArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [deleteArmed]);

  const ensureSession = (target: DraftInfo): ChatSession | null => {
    const existing = makerSession(useSessionStore.getState().sessions, target);
    if (existing) return existing;
    const id = chat.createSession({
      adapter: agent.adapter,
      model: agent.model,
      cwd: target.path,
      autoMode: agent.autoMode,
      origin: ORIGIN,
      title: target.name ? `Skill ${target.name}` : "Nouveau skill",
      options: { appendSystemPrompt: makerInstructions(target, language) },
      activate: false,
    });
    return useSessionStore.getState().sessions.find((s) => s.id === id) ?? null;
  };

  const send = async (text: string, attachments: string[]) => {
    if (!draft) return;
    setError(null);
    try {
      const target = ensureSession(draft);
      if (target) await chat.send(target, text, attachments);
      setPrefill(undefined);
    } catch (e) {
      setError(errorText(e));
    }
  };

  /** Écran de départ : brouillon créé, matière écrite, premier message envoyé. */
  const start = async (request: StartRequest) => {
    setStarting(true);
    setError(null);
    try {
      const created = await skillsApi.draftCreate(null);
      if (request.transcript) await skillsApi.draftWrite(created.id, "source/conversation.md", request.transcript);
      await reload();
      setDraftId(created.id);
      const target = ensureSession(created);
      if (target) await chat.send(target, request.message, request.attachments);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStarting(false);
    }
  };

  const remove = async () => {
    if (!draft) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setDeleteArmed(false);
    try {
      // Conversation de l'atelier et essais : tous rangés dans le dossier du brouillon.
      for (const s of useSessionStore.getState().sessions.filter((s) => s.origin === ORIGIN && draftOfSession([draft], s.cwd))) {
        void chat.remove(s);
      }
      await skillsApi.draftDelete(draft.id);
      const list = await reload();
      setDraftId(list[0]?.id ?? null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const running = Boolean(session && ["starting", "running", "awaiting"].includes(session.status));
  const showStart = draftId === null || (draft !== null && draft.kind === "new" && !session);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button size="sm" variant="ghost" onClick={onBack} icon={<ArrowLeft size={14} strokeWidth={1.75} />}>
          Bibliothèque
        </Button>
        <span aria-hidden className="h-5 w-px bg-border" />
        <Sparkles size={14} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden />
        <span className="shrink-0 text-body-sm font-medium">Atelier</span>
        {drafts && drafts.length > 0 && (
          <Select
            label="Brouillon"
            value={draftId ?? "__new"}
            onChange={(value) => setDraftId(value === "__new" ? null : value)}
            className="min-w-0 max-w-72"
            options={[
              ...drafts.map((d) => ({
                value: d.id,
                label: d.name || "Skill sans nom",
                hint: d.kind === "edit" ? "amélioration" : d.savedAs ? "enregistré" : undefined,
              })),
              { value: "__new", label: "Nouveau skill" },
            ]}
          />
        )}
        {draft?.kind === "edit" && <Badge tone="accent">amélioration de {draft.sourceId}</Badge>}
        <span className="ml-auto" />
        {draftId !== null && (
          <Button size="sm" variant="ghost" onClick={() => setDraftId(null)} icon={<Plus size={14} strokeWidth={1.75} />}>
            Nouveau
          </Button>
        )}
        {draft && (
          <Button
            size="sm"
            variant={deleteArmed ? "danger" : "ghost"}
            aria-label={deleteArmed ? "Confirmer : brouillon à la Corbeille" : "Mettre le brouillon à la Corbeille"}
            title={deleteArmed ? "Cliquer à nouveau pour confirmer" : "Mettre le brouillon à la Corbeille"}
            onClick={() => void remove()}
            icon={<Trash2 size={14} strokeWidth={1.75} />}
          >
            {deleteArmed && "À la Corbeille ?"}
          </Button>
        )}
      </header>

      {error && (
        <p role="alert" className="shrink-0 border-b border-border bg-danger-soft px-4 py-2 text-footnote">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <section aria-label="Conversation avec l'atelier" className="flex min-w-[280px] flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {installed.length === 0 ? (
              <EmptyState
                title="Aucune IA détectée"
                description="L'atelier fait écrire le skill par une CLI installée (Claude Code, Antigravity ou Codex). Installez-en une, puis relancez la détection dans Réglages > Moteur."
              />
            ) : showStart ? (
              <StartPanel
                adapters={installed}
                adapter={agent.adapter}
                onAdapter={(id) => {
                  const next = adapters.find((a) => a.id === id);
                  setAgent((a) => ({ ...a, adapter: id, model: next?.defaultModel ?? null }));
                }}
                language={language}
                onLanguage={setLanguage}
                busy={starting}
                onStart={(request) => void start(request)}
              />
            ) : session && session.timeline.length > 0 ? (
              <ConversationView
                session={session}
                agentName={adapter?.name ?? session.adapter}
                onAnswer={(promptId: string, payload: PromptAnswer) => void chat.answer(session, promptId, payload)}
                compact
              />
            ) : (
              <EmptyState
                icon={<Sparkles size={24} strokeWidth={1.5} />}
                title={draft?.kind === "edit" ? `Améliorer « ${draft.sourceId} »` : "Brouillon prêt"}
                description={
                  draft?.kind === "edit"
                    ? "Le skill a été copié dans ce brouillon. Envoyez la demande ci-dessous (ou écrivez la vôtre) : l'IA le relit et propose des améliorations. La bibliothèque n'est pas touchée avant « Enregistrer »."
                    : "Décrivez le skill à l'IA dans la zone de saisie."
                }
              />
            )}
          </div>

          {installed.length > 0 && !showStart && draft && (
            <Composer
              prefill={prefill}
              adapters={adapters}
              adapterId={adapterId}
              model={session?.model ?? agent.model}
              autoMode={session?.autoMode ?? agent.autoMode}
              busy={session?.status === "starting"}
              locked={Boolean(session && session.timeline.length > 0)}
              compact
              onAdapterChange={(id) => {
                const next = adapters.find((a) => a.id === id);
                const model = next?.defaultModel ?? null;
                if (session) void chat.setAdapter(session, id, model, next?.name);
                else setAgent((a) => ({ ...a, adapter: id, model }));
              }}
              onModelChange={(model) => {
                if (session) void chat.setModel(session, model);
                else setAgent((a) => ({ ...a, model }));
              }}
              onAutoModeChange={(mode) => {
                if (session) void chat.setAutoMode(session, mode);
                else setAgent((a) => ({ ...a, autoMode: mode }));
              }}
              running={running}
              onStop={() => session && void chat.stop(session)}
              onSend={(text, attachments) => void send(text, attachments)}
            />
          )}
        </section>

        {draft && (
          <>
            <ResizeHandle size={inspectorWidth} onResize={setInspectorWidth} panel="after" label="Largeur de l'inspecteur" defaultSize={440} />
            {/* Petite fenêtre : l'inspecteur cède la place pour garder la conversation lisible. */}
            <aside style={{ width: inspectorWidth, maxWidth: "calc(100% - 290px)" }} className="flex min-w-0 shrink-0 flex-col bg-bg-subtle">
              <Inspector
                draft={draft}
                revision={revision}
                agent={{
                  adapter: adapterId,
                  model: session?.model ?? agent.model,
                  autoMode: session?.autoMode ?? agent.autoMode,
                  name: adapter?.name ?? adapterId,
                }}
                onPrefill={setPrefill}
                onChanged={() => setRevision((r) => r + 1)}
                onSaved={(info) => {
                  setDrafts((list) => list?.map((d) => (d.id === info.id ? info : d)) ?? list);
                  onSaved();
                }}
              />
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
