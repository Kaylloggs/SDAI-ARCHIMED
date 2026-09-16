import { useCallback } from "react";
import { Channel } from "@/core/ipc";
import { engineApi } from "@/core/engine/engine.api";
export { useAdapters } from "@/core/engine/useAdapters";
import { useSessionStore, type ChatSession } from "@/core/engine/session.store";
import type { AutoMode, EngineEvent, PromptAnswer } from "@/core/engine/types";
import { bus } from "@/core/bus/event-bus";

/** Compose le message envoyé à la CLI à partir du texte et des pièces jointes. */
export function buildPrompt(text: string, attachments: string[]): string {
  if (attachments.length === 0) return text;
  const list = attachments.map((path) => `- ${path}`).join("\n");
  return `${text}\n\n[Pièces jointes — ouvre ces fichiers avec ton outil de lecture]\n${list}`;
}

export function useChat() {
  const store = useSessionStore();
  const session = store.sessions.find((s) => s.id === store.activeId) ?? null;

  /** Démarre (ou redémarre) le processus CLI d'une conversation. */
  const ensureEngine = useCallback(
    async (chat: ChatSession): Promise<string> => {
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
        onEvent: channel,
      });

      // Le store doit connaître l'id avant que le premier événement n'arrive.
      useSessionStore.getState().patch(chat.id, { engineSessionId, status: "running" });
      state.engineId = engineSessionId;
      bus.emit("engine.session.started", { sessionId: engineSessionId, adapter: chat.adapter });
      return engineSessionId;
    },
    [],
  );

  const send = useCallback(
    async (chat: ChatSession, text: string, attachments: string[]) => {
      const engineSessionId = await ensureEngine(chat);
      useSessionStore.getState().appendUser(chat.id, text, attachments);
      await engineApi.sendMessage(engineSessionId, buildPrompt(text, attachments));
    },
    [ensureEngine],
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
    remove,
  };
}
