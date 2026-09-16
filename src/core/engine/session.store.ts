import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { conversationStorage } from "./conversation-storage";
import type {
  AutoMode,
  EngineEvent,
  InteractivePrompt,
  ResolvedBy,
} from "./types";

export type TimelineItem =
  | { kind: "user"; id: string; text: string; attachments?: string[] }
  | { kind: "assistant"; id: string; text: string; done: boolean }
  | { kind: "tool"; id: string; tool: string; input: unknown; output?: string; ok?: boolean }
  | { kind: "prompt"; id: string; prompt: InteractivePrompt; resolvedBy?: ResolvedBy; optionId?: string | null }
  | { kind: "error"; id: string; message: string; code: string }
  | { kind: "system"; id: string; text: string };

export type SessionStatus = "idle" | "starting" | "running" | "awaiting" | "ended" | "error";

/** Module qui a créé la conversation : chaque module n'affiche que les siennes. */
export type SessionOrigin = "chat" | "code";

/**
 * Une conversation persistée. Son identité (`id`) survit à l'arrêt du processus CLI :
 * `engineSessionId` pointe vers la session backend vivante, ou `null` si elle est terminée.
 */
export type ChatSession = {
  id: string;
  origin: SessionOrigin;
  title: string;
  adapter: string;
  model: string | null;
  cwd: string | null;
  autoMode: AutoMode;
  createdAt: number;
  updatedAt: number;
  engineSessionId: string | null;
  /** Conversation côté CLI : repris au redémarrage du processus (`--resume`…). */
  cliSessionId: string | null;
  status: SessionStatus;
  timeline: TimelineItem[];
  raw: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
  pendingPromptId: string | null;
};

type Store = {
  sessions: ChatSession[];
  activeId: string | null;

  createSession: (init: {
    adapter: string;
    model: string | null;
    cwd: string | null;
    autoMode: AutoMode;
    origin?: SessionOrigin;
    title?: string;
    /** `false` : ne change pas la conversation active du module Chat. */
    activate?: boolean;
  }) => string;
  removeSession: (id: string) => void;
  clearAll: () => void;
  setActive: (id: string | null) => void;
  patch: (id: string, patch: Partial<ChatSession>) => void;
  appendUser: (id: string, text: string, attachments?: string[]) => void;
  apply: (engineSessionId: string, event: EngineEvent) => void;
};

const MAX_RAW = 200_000;
const MAX_SESSIONS = 100;

function titleFrom(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
}

export const useSessionStore = create<Store>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeId: null,

      createSession: ({ adapter, model, cwd, autoMode, origin = "chat", title, activate = true }) => {
        const id = crypto.randomUUID();
        const now = Date.now();
        const session: ChatSession = {
          id,
          origin,
          title: title ?? "Nouvelle conversation",
          adapter,
          model,
          cwd,
          autoMode,
          createdAt: now,
          updatedAt: now,
          engineSessionId: null,
          cliSessionId: null,
          status: "idle",
          timeline: [],
          raw: "",
          usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
          pendingPromptId: null,
        };
        set((state) => ({
          sessions: [session, ...state.sessions].slice(0, MAX_SESSIONS),
          activeId: activate ? id : state.activeId,
        }));
        return id;
      },

      removeSession: (id) =>
        set((state) => {
          const sessions = state.sessions.filter((s) => s.id !== id);
          const nextChat = sessions.find((s) => s.origin === "chat");
          return {
            sessions,
            activeId: state.activeId === id ? (nextChat?.id ?? null) : state.activeId,
          };
        }),

      clearAll: () => set({ sessions: [], activeId: null }),

      setActive: (activeId) => set({ activeId }),

      patch: (id, patch) =>
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === id ? { ...session, ...patch, updatedAt: Date.now() } : session,
          ),
        })),

      appendUser: (id, text, attachments) =>
        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== id) return session;
            const item: TimelineItem = {
              kind: "user",
              id: crypto.randomUUID(),
              text,
              ...(attachments && attachments.length > 0 ? { attachments } : {}),
            };
            return {
              ...session,
              status: "running",
              updatedAt: Date.now(),
              title:
                session.title === "Nouvelle conversation" ? titleFrom(text) : session.title,
              timeline: [...session.timeline, item],
            };
          }),
        })),

      apply: (engineSessionId, event) => {
        const target = get().sessions.find((s) => s.engineSessionId === engineSessionId);
        if (!target) return;
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === target.id ? reduce(session, event) : session,
          ),
        }));
      },
    }),
    {
      name: "archimed.sessions",
      storage: createJSONStorage(() => conversationStorage),
      version: 1,
      // v0 → v1 : ajout de `origin`. Les conversations vides créées automatiquement
      // par le module Code à l'ouverture d'un dossier sont supprimées.
      migrate: (persisted, version) => {
        const state = persisted as { sessions?: Array<Partial<ChatSession>>; activeId?: string | null };
        if (version < 1 && Array.isArray(state.sessions)) {
          state.sessions = state.sessions
            .filter((s) => !(s.title?.startsWith("Projet ") && (s.timeline?.length ?? 0) === 0))
            .map((s) => ({
              ...s,
              origin: s.origin ?? (s.title?.startsWith("Projet ") ? "code" : "chat"),
            }));
          if (!state.sessions.some((s) => s.id === state.activeId && s.origin === "chat")) {
            state.activeId = state.sessions.find((s) => s.origin === "chat")?.id ?? null;
          }
        }
        return state as unknown as Store;
      },
      // La sortie brute et l'état transitoire ne sont pas persistés.
      partialize: (state) => ({
        activeId: state.activeId,
        sessions: state.sessions.map((session) => ({
          ...session,
          raw: "",
          engineSessionId: null as string | null,
          pendingPromptId: null as string | null,
          status: session.status === "ended" ? "ended" : ("idle" as SessionStatus),
          timeline: session.timeline.filter(
            (item) => !(item.kind === "prompt" && !item.resolvedBy),
          ),
        })),
      }),
    },
  ),
);

function reduce(session: ChatSession, event: EngineEvent): ChatSession {
  const timeline = session.timeline;
  const touched = { updatedAt: Date.now() };

  switch (event.type) {
    case "cliSession":
      return { ...session, cliSessionId: event.cliSessionId };

    case "sessionStarted":
      return { ...session, ...touched, status: "running", model: event.model || session.model };

    case "messageDelta": {
      const index = timeline.findIndex(
        (item) => item.kind === "assistant" && item.id === event.messageId,
      );
      if (index === -1) {
        return {
          ...session,
          ...touched,
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
      return { ...session, ...touched, timeline: updated };
    }

    case "messageCompleted":
      return {
        ...session,
        ...touched,
        timeline: timeline.map((item) =>
          item.kind === "assistant" && item.id === event.messageId
            ? { ...item, done: true }
            : item,
        ),
      };

    case "toolCall":
      return {
        ...session,
        ...touched,
        timeline: [
          ...timeline,
          { kind: "tool", id: event.callId, tool: event.tool, input: event.input },
        ],
      };

    case "toolResult":
      return {
        ...session,
        ...touched,
        timeline: timeline.map((item) =>
          item.kind === "tool" && item.id === event.callId
            ? { ...item, output: event.output, ok: event.ok }
            : item,
        ),
      };

    case "prompt":
      return {
        ...session,
        ...touched,
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
        ...touched,
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
        ...touched,
        pendingPromptId: null,
        timeline: timeline.filter(
          (item) => !(item.kind === "prompt" && item.id === event.promptId && !item.resolvedBy),
        ),
      };

    case "rawOutput":
      return { ...session, raw: (session.raw + event.chunk).slice(-MAX_RAW) };

    case "usage":
      return {
        ...session,
        ...touched,
        usage: {
          inputTokens: session.usage.inputTokens + event.inputTokens,
          outputTokens: session.usage.outputTokens + event.outputTokens,
          costUsd: event.costUsd ?? session.usage.costUsd,
        },
      };

    case "error":
      return {
        ...session,
        ...touched,
        status: event.recoverable ? session.status : "error",
        timeline: [
          ...timeline,
          { kind: "error", id: crypto.randomUUID(), message: event.message, code: event.code },
        ],
      };

    case "sessionEnded":
      return { ...session, ...touched, status: "ended", engineSessionId: null };

    default:
      return session;
  }
}
