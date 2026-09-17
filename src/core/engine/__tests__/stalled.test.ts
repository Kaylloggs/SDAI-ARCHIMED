import { describe, expect, it } from "vitest";
import { isStalledTurn } from "@/core/engine/useChat";
import type { ChatSession, TimelineItem } from "@/core/engine/session.store";

const turn: TimelineItem = {
  kind: "turn",
  id: "t",
  durationMs: 7100,
  inputTokens: 27000,
  outputTokens: 200,
  thinkingTokens: 0,
  cacheTokens: 0,
  costUsd: null,
  ok: true,
};

const session = (timeline: TimelineItem[], status: ChatSession["status"] = "idle") =>
  ({ status, timeline }) as ChatSession;

describe("réponse coupée en route", () => {
  it("détecte un tour terminé juste après une action", () => {
    const tool: TimelineItem = { kind: "tool", id: "1", tool: "view_file", input: {}, ok: true };
    expect(isStalledTurn(session([tool, turn]))).toBe(true);
  });

  it("ignore une réponse rédigée, un refus, une erreur ou un tour en cours", () => {
    const answer: TimelineItem = { kind: "assistant", id: "a", text: "Voilà.", done: true };
    const error: TimelineItem = { kind: "error", id: "e", message: "x", code: "CLI_ERROR" };
    const tool: TimelineItem = { kind: "tool", id: "1", tool: "Bash", input: {}, ok: true };
    expect(isStalledTurn(session([tool, answer, turn]))).toBe(false);
    expect(isStalledTurn(session([tool, error, turn]))).toBe(false);
    expect(isStalledTurn(session([tool, turn], "running"))).toBe(false);
    expect(isStalledTurn(session([tool, { ...turn, ok: false }]))).toBe(false);
  });
});
