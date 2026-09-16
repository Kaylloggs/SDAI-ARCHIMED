import { Channel, invokeCore } from "@/core/ipc";
import type {
  AdapterInfo,
  AutoMode,
  EngineEvent,
  PromptAnswer,
  SessionId,
} from "./types";

export const engineApi = {
  listAdapters: () => invokeCore<AdapterInfo[]>("engine_list_adapters"),

  startSession: (params: {
    adapter: string;
    model: string | null;
    cwd: string | null;
    autoMode: AutoMode;
    onEvent: Channel<EngineEvent>;
  }) => invokeCore<SessionId>("engine_start_session", params),

  sendMessage: (sessionId: SessionId, text: string) =>
    invokeCore<void>("engine_send_message", { sessionId, text }),

  answerPrompt: (sessionId: SessionId, promptId: string, answer: PromptAnswer) =>
    invokeCore<void>("engine_answer_prompt", { sessionId, promptId, answer }),

  setAutoMode: (sessionId: SessionId, mode: AutoMode) =>
    invokeCore<void>("engine_set_auto_mode", { sessionId, mode }),

  stopSession: (sessionId: SessionId) =>
    invokeCore<void>("engine_stop_session", { sessionId }),

  defaultCwd: () => invokeCore<string>("engine_default_cwd"),
};
