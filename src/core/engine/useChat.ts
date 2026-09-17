import { useCallback } from "react";
import { Channel } from "@/core/ipc";
import { bus } from "@/core/bus/event-bus";
import { useService } from "@/core/modules/services";
import { engineApi } from "./engine.api";
import { useSessionStore, type ChatSession } from "./session.store";
import type { AutoMode, EngineEvent, PromptAnswer } from "./types";

/**
 * Compose le message envoyé à la CLI.
 * `targets` = fichiers explicitement désignés pour modification (drag & drop depuis l'arbre).
 * `attachments` = contexte à lire (PDF, images, documents…).
 */
export function buildPrompt(
  text: string,
  attachments: string[] = [],
  targets: string[] = [],
): string {
  let prompt = text;
  if (targets.length > 0) {
    prompt += `\n\n[Fichiers à modifier — travaille sur ceux-ci en priorité]\n${targets
      .map((path) => `- ${path}`)
      .join("\n")}`;
  }
  if (attachments.length > 0) {
    prompt += `\n\n[Pièces jointes — ouvre ces fichiers avec ton outil de lecture]\n${attachments
      .map((path) => `- ${path}`)
      .join("\n")}`;
  }
  return prompt;
}

/** Message envoyé quand un agent s'est arrêté en route (jamais affiché). */
const CONTINUE_PROMPT =
  "Continue where you stopped and complete the task. Do not repeat work that is already done.";

/**
 * Tour terminé juste après une action (outil) sans réponse rédigée : l'agent s'est arrêté
 * en route. Un refus, une erreur ou une réponse de l'agent ne comptent pas.
 */
export function isStalledTurn(chat: ChatSession): boolean {
  if (chat.status !== "idle") return false;
  const last = chat.timeline.at(-1);
  const before = chat.timeline.at(-2);
  return last?.kind === "turn" && last.ok && before?.kind === "tool";
}

/** Cycle de vie des conversations, partagé par tous les modules qui parlent aux CLI. */
/** Service optionnel fourni par un module (ex. Mémoire) : contexte ajouté au premier message. */
export type PromptContextService = {
  buildContext: (cwd: string | null) => Promise<string | null>;
};

export function useChat() {
  const store = useSessionStore();
  const contextService = useService<PromptContextService>("memory.context");
  const session =
    store.sessions.find((s) => s.id === store.activeId && s.origin === "chat") ?? null;

  /** Démarre (ou redémarre) le processus CLI d'une conversation. */
  const ensureEngine = useCallback(async (chat: ChatSession): Promise<string> => {
    if (chat.engineSessionId) return chat.engineSessionId;

    const channel = new Channel<EngineEvent>();
    const state = { engineId: "" };
    channel.onmessage = (event) => {
      if (state.engineId) useSessionStore.getState().apply(state.engineId, event);
    };

    useSessionStore.getState().patch(chat.id, { status: "starting" });
    const engineSessionId = await engineApi.startSession({
      adapter: chat.adapter,
      model: chat.model,
      cwd: chat.cwd,
      autoMode: chat.autoMode,
      resume: chat.cliSessionId ?? null,
      onEvent: channel,
    });

    // Le store doit connaître l'id avant que le premier événement n'arrive.
    useSessionStore.getState().patch(chat.id, { engineSessionId, status: "running" });
    state.engineId = engineSessionId;
    bus.emit("engine.session.started", { sessionId: engineSessionId, adapter: chat.adapter });
    return engineSessionId;
  }, []);

  const send = useCallback(
    async (chat: ChatSession, text: string, attachments: string[] = [], targets: string[] = []) => {
      const engineSessionId = await ensureEngine(chat);
      // Premier message d'une conversation : la CLI ne sait encore rien du travail passé.
      const firstMessage = !chat.timeline.some((item) => item.kind === "user");
      const context =
        firstMessage && contextService
          ? await contextService.buildContext(chat.cwd).catch(() => null)
          : null;
      useSessionStore.getState().appendUser(chat.id, text, [...targets, ...attachments]);
      const prompt = buildPrompt(text, attachments, targets);
      await engineApi.sendMessage(engineSessionId, context ? `${context}

${prompt}` : prompt);
    },
    [ensureEngine, contextService],
  );

  /**
   * Relance silencieuse : l'agent s'est arrêté après une action sans conclure. Rien n'est
   * ajouté à la conversation, l'activité reprend comme pour un message normal.
   */
  const continueTurn = useCallback(
    async (chat: ChatSession) => {
      const engineSessionId = await ensureEngine(chat);
      useSessionStore.getState().patch(chat.id, {
        status: "running",
        activity: { phase: "thinking", label: null, since: Date.now() },
        turnStartedAt: Date.now(),
      });
      await engineApi.sendMessage(engineSessionId, CONTINUE_PROMPT);
    },
    [ensureEngine],
  );

  /**
   * Arrête l'agent en pleine réponse. Le processus est terminé ; le prochain message relance
   * la CLI sur la même conversation (contexte conservé).
   */
  const stop = useCallback(async (chat: ChatSession) => {
    const engineSessionId = chat.engineSessionId;
    const store = useSessionStore.getState();
    store.patch(chat.id, {
      engineSessionId: null,
      status: "idle",
      activity: null,
      turnStartedAt: null,
      pendingPromptId: null,
      timeline: [
        // Les demandes restées sans réponse n'ont plus d'objet.
        ...chat.timeline.filter((item) => !(item.kind === "prompt" && !item.resolvedBy)),
        { kind: "system", id: crypto.randomUUID(), text: "Réponse interrompue" },
      ],
    });
    if (engineSessionId) await engineApi.stopSession(engineSessionId).catch(() => undefined);
  }, []);

  const answer = useCallback(
    async (chat: ChatSession, promptId: string, payload: PromptAnswer) => {
      if (!chat.engineSessionId) return;
      await engineApi.answerPrompt(chat.engineSessionId, promptId, payload);
    },
    [],
  );

  const setAutoMode = useCallback(async (chat: ChatSession, mode: AutoMode) => {
    useSessionStore.getState().patch(chat.id, { autoMode: mode });
    if (chat.engineSessionId) await engineApi.setAutoMode(chat.engineSessionId, mode);
  }, []);

  /**
   * Change le modèle. Si un processus tourne, il est arrêté : le prochain message
   * relance la CLI avec le nouveau modèle en reprenant la conversation.
   */
  const setModel = useCallback(async (chat: ChatSession, model: string) => {
    if (chat.engineSessionId) {
      await engineApi.stopSession(chat.engineSessionId).catch(() => undefined);
    }
    useSessionStore.getState().patch(chat.id, { model, engineSessionId: null, status: "idle" });
  }, []);

  /**
   * Change le dossier de travail. Le processus en cours tourne dans l'ancien dossier :
   * il est arrêté, le prochain message relance la CLI dans le nouveau en gardant le contexte.
   */
  const setCwd = useCallback(async (chat: ChatSession, cwd: string) => {
    if (chat.cwd === cwd) return;
    if (chat.engineSessionId) {
      await engineApi.stopSession(chat.engineSessionId).catch(() => undefined);
    }
    useSessionStore.getState().patch(chat.id, { cwd, engineSessionId: null, status: "idle" });
  }, []);

  const remove = useCallback(async (chat: ChatSession) => {
    if (chat.engineSessionId) {
      await engineApi.stopSession(chat.engineSessionId).catch(() => undefined);
    }
    useSessionStore.getState().removeSession(chat.id);
  }, []);

  return {
    sessions: store.sessions,
    session,
    activeId: store.activeId,
    setActive: store.setActive,
    createSession: store.createSession,
    patch: store.patch,
    send,
    answer,
    setAutoMode,
    setModel,
    setCwd,
    continueTurn,
    stop,
    remove,
  };
}
