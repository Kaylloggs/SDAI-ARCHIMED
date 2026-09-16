import { useCallback, useEffect, useState } from "react";
import { Channel } from "@/core/ipc";
import { engineApi } from "@/core/engine/engine.api";
import { useSessionStore } from "@/core/engine/session.store";
import type { AdapterInfo, AutoMode, EngineEvent, PromptAnswer } from "@/core/engine/types";
import { bus } from "@/core/bus/event-bus";

export function useAdapters() {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    engineApi
      .listAdapters()
      .then((list) => alive && setAdapters(list))
      .catch((e: { message?: string }) => alive && setError(e.message ?? "Erreur inconnue"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return { adapters, error, loading };
}

export function useChatSession() {
  const { sessions, activeSessionId, createSession, appendUser, apply, patch, setActive } =
    useSessionStore();
  const session = activeSessionId ? sessions[activeSessionId] : undefined;

  const start = useCallback(
    async (adapter: string, model: string | null, autoMode: AutoMode, cwd: string | null) => {
      const channel = new Channel<EngineEvent>();
      const pendingId = { current: "" };
      channel.onmessage = (event) => {
        if (pendingId.current) apply(pendingId.current, event);
      };
      const sessionId = await engineApi.startSession({ adapter, model, cwd, autoMode, onEvent: channel });
      pendingId.current = sessionId;
      createSession({
        id: sessionId,
        adapter,
        model: model ?? "",
        autoMode,
        status: "starting",
        timeline: [],
        raw: "",
        usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
        pendingPromptId: null,
      });
      bus.emit("engine.session.started", { sessionId, adapter });
      return sessionId;
    },
    [apply, createSession],
  );

  const send = useCallback(
    async (sessionId: string, text: string) => {
      appendUser(sessionId, text);
      await engineApi.sendMessage(sessionId, text);
    },
    [appendUser],
  );

  const answer = useCallback(
    async (sessionId: string, promptId: string, payload: PromptAnswer) => {
      await engineApi.answerPrompt(sessionId, promptId, payload);
    },
    [],
  );

  const setAutoMode = useCallback(
    async (sessionId: string, mode: AutoMode) => {
      patch(sessionId, { autoMode: mode });
      await engineApi.setAutoMode(sessionId, mode);
    },
    [patch],
  );

  return { sessions, session, activeSessionId, setActive, start, send, answer, setAutoMode };
}
