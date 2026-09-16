import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore, type SessionState } from "../session.store";
import type { EngineEvent, InteractivePrompt } from "../types";

const SESSION: SessionState = {
  id: "s1",
  adapter: "claude",
  model: "sonnet",
  autoMode: "off",
  status: "starting",
  timeline: [],
  raw: "",
  usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
  pendingPromptId: null,
};

const prompt: InteractivePrompt = {
  promptId: "p1",
  sessionId: "s1",
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

function apply(...events: EngineEvent[]) {
  for (const event of events) useSessionStore.getState().apply("s1", event);
  const session = useSessionStore.getState().sessions["s1"];
  if (!session) throw new Error("session absente");
  return session;
}

describe("session.store", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: { s1: { ...SESSION } }, activeSessionId: "s1" });
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

  it("retire une question invalidée non résolue", () => {
    apply({ type: "prompt", prompt });
    const session = apply({ type: "promptInvalidated", promptId: "p1" });
    expect(session.timeline).toHaveLength(0);
    expect(session.pendingPromptId).toBeNull();
  });

  it("cumule l'usage", () => {
    const session = apply(
      { type: "usage", inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
      { type: "usage", inputTokens: 3, outputTokens: 2, costUsd: 0.02 },
    );
    expect(session.usage).toEqual({ inputTokens: 13, outputTokens: 7, costUsd: 0.02 });
  });
});
