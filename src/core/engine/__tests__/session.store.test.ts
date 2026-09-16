import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore, type ChatSession } from "../session.store";
import type { EngineEvent, InteractivePrompt } from "../types";

const ENGINE_ID = "engine-1";

const BASE: ChatSession = {
  id: "s1",
  origin: "chat",
  title: "Nouvelle conversation",
  adapter: "claude",
  model: "sonnet",
  cwd: "F:/projet",
  autoMode: "off",
  createdAt: 1,
  updatedAt: 1,
  engineSessionId: ENGINE_ID,
  status: "running",
  timeline: [],
  raw: "",
  usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
  pendingPromptId: null,
};

const prompt: InteractivePrompt = {
  promptId: "p1",
  sessionId: ENGINE_ID,
  kind: "permission",
  tool: "Write",
  title: "Write · note.txt",
  detail: { type: "diff", path: "note.txt", before: null, after: "hi" },
  options: [
    { id: "deny", label: "Refuser", variant: "default", shortcut: null },
    { id: "allow", label: "Autoriser", variant: "primary", shortcut: null },
  ],
  defaultOption: "allow",
  allowFreeText: false,
  risk: "medium",
  source: { type: "protocol" },
  rawExcerpt: null,
};

function apply(...events: EngineEvent[]): ChatSession {
  for (const event of events) useSessionStore.getState().apply(ENGINE_ID, event);
  const session = useSessionStore.getState().sessions.find((s) => s.id === "s1");
  if (!session) throw new Error("session absente");
  return session;
}

describe("session.store", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [{ ...BASE }], activeId: "s1" });
  });

  it("crée une conversation et la met en tête de liste", () => {
    const id = useSessionStore.getState().createSession({
      adapter: "antigravity",
      model: null,
      cwd: null,
      autoMode: "smart",
    });
    const state = useSessionStore.getState();
    expect(state.activeId).toBe(id);
    expect(state.sessions[0]?.id).toBe(id);
    expect(state.sessions).toHaveLength(2);
  });

  it("ne change pas la conversation active pour une conversation du module Code", () => {
    useSessionStore.getState().createSession({
      adapter: "claude",
      model: null,
      cwd: "F:/projet",
      autoMode: "off",
      origin: "code",
      title: "Projet projet",
      activate: false,
    });
    const state = useSessionStore.getState();
    expect(state.activeId).toBe("s1");
    expect(state.sessions[0]).toMatchObject({ origin: "code", title: "Projet projet" });
  });

  it("titre la conversation avec le premier message", () => {
    useSessionStore.getState().appendUser("s1", "Range mon bureau s'il te plaît");
    expect(useSessionStore.getState().sessions[0]?.title).toBe("Range mon bureau s'il te plaît");
  });

  it("supprime une conversation et réactive la suivante", () => {
    const second = useSessionStore
      .getState()
      .createSession({ adapter: "claude", model: null, cwd: null, autoMode: "off" });
    useSessionStore.getState().removeSession(second);
    const state = useSessionStore.getState();
    expect(state.sessions.map((s) => s.id)).toEqual(["s1"]);
    expect(state.activeId).toBe("s1");
  });

  it("ignore les événements d'une session backend inconnue", () => {
    useSessionStore.getState().apply("autre-engine", {
      type: "messageDelta",
      messageId: "m1",
      text: "perdu",
    });
    expect(useSessionStore.getState().sessions[0]?.timeline).toHaveLength(0);
  });

  it("accumule les deltas d'un même message", () => {
    const session = apply(
      { type: "messageDelta", messageId: "m1", text: "Bon" },
      { type: "messageDelta", messageId: "m1", text: "jour" },
      { type: "messageCompleted", messageId: "m1" },
    );
    expect(session.timeline).toHaveLength(1);
    expect(session.timeline[0]).toMatchObject({ kind: "assistant", text: "Bonjour", done: true });
  });

  it("associe le résultat à son appel d'outil", () => {
    const session = apply(
      { type: "toolCall", callId: "c1", tool: "Read", input: { path: "a.txt" } },
      { type: "toolResult", callId: "c1", ok: true, output: "contenu" },
    );
    expect(session.timeline[0]).toMatchObject({ kind: "tool", ok: true, output: "contenu" });
  });

  it("passe en attente sur une question puis la marque résolue", () => {
    const waiting = apply({ type: "prompt", prompt });
    expect(waiting.status).toBe("awaiting");
    expect(waiting.pendingPromptId).toBe("p1");

    const resolved = apply({
      type: "promptResolved",
      promptId: "p1",
      by: "auto",
      optionId: "allow",
    });
    expect(resolved.status).toBe("running");
    expect(resolved.pendingPromptId).toBeNull();
    expect(resolved.timeline[0]).toMatchObject({ kind: "prompt", resolvedBy: "auto" });
  });

  it("libère la session backend à la fin du processus", () => {
    const session = apply({ type: "sessionEnded", exitCode: 0 });
    expect(session.status).toBe("ended");
    expect(session.engineSessionId).toBeNull();
  });

  it("cumule l'usage", () => {
    const session = apply(
      { type: "usage", inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
      { type: "usage", inputTokens: 3, outputTokens: 2, costUsd: 0.02 },
    );
    expect(session.usage).toEqual({ inputTokens: 13, outputTokens: 7, costUsd: 0.02 });
  });
});
