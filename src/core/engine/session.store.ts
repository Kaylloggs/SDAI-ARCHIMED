import { create } from "zustand";
import type {
  AutoMode,
  EngineEvent,
  InteractivePrompt,
  ResolvedBy,
  SessionId,
} from "./types";

export type TimelineItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; done: boolean }
  | { kind: "tool"; id: string; tool: string; input: unknown; output?: string; ok?: boolean }
  | { kind: "prompt"; id: string; prompt: InteractivePrompt; resolvedBy?: ResolvedBy; optionId?: string | null }
  | { kind: "error"; id: string; message: string; code: string }
  | { kind: "system"; id: string; text: string };

export type SessionState = {
  id: SessionId;
  adapter: string;
  model: string;
  autoMode: AutoMode;
  status: "starting" | "running" | "awaiting" | "ended" | "error";
  timeline: TimelineItem[];
  raw: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
  pendingPromptId: string | null;
};

type Store = {
  sessions: Record<SessionId, SessionState>;
  activeSessionId: SessionId | null;
  createSession: (session: SessionState) => void;
  setActive: (id: SessionId | null) => void;
  appendUser: (id: SessionId, text: string) => void;
  apply: (id: SessionId, event: EngineEvent) => void;
  patch: (id: SessionId, patch: Partial<SessionState>) => void;
};

const MAX_RAW = 200_000;

export const useSessionStore = create<Store>()((set) => ({
  sessions: {},
  activeSessionId: null,

  createSession: (session) =>
    set((state) => ({
      sessions: { ...state.sessions, [session.id]: session },
      activeSessionId: session.id,
    })),

  setActive: (activeSessionId) => set({ activeSessionId }),

  appendUser: (id, text) =>
    set((state) => {
      const session = state.sessions[id];
      if (!session) return state;
      const item: TimelineItem = { kind: "user", id: crypto.randomUUID(), text };
      return {
        sessions: {
          ...state.sessions,
          [id]: { ...session, timeline: [...session.timeline, item], status: "running" },
        },
      };
    }),

  patch: (id, patch) =>
    set((state) => {
      const session = state.sessions[id];
      if (!session) return state;
      return { sessions: { ...state.sessions, [id]: { ...session, ...patch } } };
    }),

  apply: (id, event) =>
    set((state) => {
      const session = state.sessions[id];
      if (!session) return state;
      const next = reduce(session, event);
      return { sessions: { ...state.sessions, [id]: next } };
    }),
}));

function reduce(session: SessionState, event: EngineEvent): SessionState {
  const timeline = session.timeline;

  switch (event.type) {
    case "sessionStarted":
      return { ...session, status: "running", model: event.model, adapter: event.adapter };

    case "messageDelta": {
      const index = timeline.findIndex(
        (item) => item.kind === "assistant" && item.id === event.messageId,
      );
      if (index === -1) {
        return {
          ...session,
          status: "running",
          timeline: [
            ...timeline,
            { kind: "assistant", id: event.messageId, text: event.text, done: false },
          ],
        };
      }
      const existing = timeline[index] as Extract<TimelineItem, { kind: "assistant" }>;
      const updated = [...timeline];
      updated[index] = { ...existing, text: existing.text + event.text };
      return { ...session, timeline: updated };
    }

    case "messageCompleted": {
      const updated = timeline.map((item) =>
        item.kind === "assistant" && item.id === event.messageId
          ? { ...item, done: true }
          : item,
      );
      return { ...session, timeline: updated };
    }

    case "toolCall":
      return {
        ...session,
        timeline: [
          ...timeline,
          { kind: "tool", id: event.callId, tool: event.tool, input: event.input },
        ],
      };

    case "toolResult":
      return {
        ...session,
        timeline: timeline.map((item) =>
          item.kind === "tool" && item.id === event.callId
            ? { ...item, output: event.output, ok: event.ok }
            : item,
        ),
      };

    case "prompt":
      return {
        ...session,
        status: "awaiting",
        pendingPromptId: event.prompt.promptId,
        timeline: [
          ...timeline,
          { kind: "prompt", id: event.prompt.promptId, prompt: event.prompt },
        ],
      };

    case "promptResolved":
      return {
        ...session,
        status: "running",
        pendingPromptId:
          session.pendingPromptId === event.promptId ? null : session.pendingPromptId,
        timeline: timeline.map((item) =>
          item.kind === "prompt" && item.id === event.promptId
            ? { ...item, resolvedBy: event.by, optionId: event.optionId }
            : item,
        ),
      };

    case "promptInvalidated":
      return {
        ...session,
        pendingPromptId: null,
        timeline: timeline.filter(
          (item) => !(item.kind === "prompt" && item.id === event.promptId && !item.resolvedBy),
        ),
      };

    case "rawOutput": {
      const raw = (session.raw + event.chunk).slice(-MAX_RAW);
      return { ...session, raw };
    }

    case "usage":
      return {
        ...session,
        usage: {
          inputTokens: session.usage.inputTokens + event.inputTokens,
          outputTokens: session.usage.outputTokens + event.outputTokens,
          costUsd: event.costUsd ?? session.usage.costUsd,
        },
      };

    case "error":
      return {
        ...session,
        status: event.recoverable ? session.status : "error",
        timeline: [
          ...timeline,
          { kind: "error", id: crypto.randomUUID(), message: event.message, code: event.code },
        ],
      };

    case "sessionEnded":
      return { ...session, status: "ended" };

    default:
      return session;
  }
}
