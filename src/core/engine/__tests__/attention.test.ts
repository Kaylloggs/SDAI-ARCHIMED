import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn(), UserAttentionType: { Informational: 2 } }));

const { needsAttention } = await import("../useAttention");

describe("needsAttention", () => {
  it("signale la fin d'un tour et une question, pas le premier passage ni le démarrage", () => {
    const seen = new Map();
    expect(needsAttention(seen, [{ id: "a", status: "idle" }])).toBe(false);
    expect(needsAttention(seen, [{ id: "a", status: "running" }])).toBe(false);
    expect(needsAttention(seen, [{ id: "a", status: "running" }])).toBe(false);
    expect(needsAttention(seen, [{ id: "a", status: "awaiting" }])).toBe(true);
    expect(needsAttention(seen, [{ id: "a", status: "running" }])).toBe(false);
    expect(needsAttention(seen, [{ id: "a", status: "idle" }])).toBe(true);
    expect(needsAttention(seen, [{ id: "a", status: "idle" }])).toBe(false);
  });

  it("une erreur en plein travail compte aussi", () => {
    const seen = new Map([["b", "starting" as const]]);
    expect(needsAttention(seen, [{ id: "b", status: "error" }])).toBe(true);
  });
});
