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
    remove,
  };
}
