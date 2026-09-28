import { describe, expect, it } from "vitest";
import type { AdapterInfo } from "@/core/engine/types";
import { routeModel, tierOf } from "../lib/routing";

const adapter = (id: string, name: string, models: Array<[string, string]>, installed = true): AdapterInfo =>
  ({
    id,
    name,
    installed,
    version: null,
    binaryPath: null,
    transport: "structured",
    models: models.map(([modelId, label]) => ({ id: modelId, label, efforts: [] })),
    defaultModel: models[0]?.[0] ?? null,
    accent: "neutral",
    hint: null,
  }) as unknown as AdapterInfo;

const claude = adapter("claude", "Claude Code", [
  ["claude-fable-5-1", "Fable 5.1"],
  ["claude-opus-5-5", "Opus 5.5"],
  ["claude-opus-5", "Opus 5"],
  ["claude-sonnet-5", "Sonnet 5"],
  ["claude-haiku-4-5", "Haiku 4.5"],
]);
const antigravity = adapter("antigravity", "Antigravity", [
  ["gemini-3.8-flash", "Gemini 3.8 Flash"],
  ["gemini-3.5-pro", "Gemini 3.5 Pro"],
]);
const codex = adapter("codex", "Codex", [
  ["gpt-5.3-codex", "GPT-5.3 Codex"],
  ["gpt-5.3-codex-mini", "GPT-5.3 Codex Mini"],
]);

describe("modèle selon la tâche", () => {
  it("range les modèles par gamme", () => {
    expect(tierOf({ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" })).toBe("light");
    expect(tierOf({ id: "claude-haiku-4-5", label: "Haiku 4.5" })).toBe("light");
    expect(tierOf({ id: "gpt-5.3-codex-mini", label: "GPT-5.3 Codex Mini" })).toBe("light");
    expect(tierOf({ id: "claude-opus-5-5", label: "Opus 5.5" })).toBe("strong");
    expect(tierOf({ id: "gemini-3.5-pro", label: "Gemini 3.5 Pro" })).toBe("strong");
    expect(tierOf({ id: "claude-sonnet-5", label: "Sonnet 5" })).toBe("balanced");
  });

  it("petit modèle pour une tâche simple, le plus puissant pour une tâche complexe", () => {
    const all = [claude, antigravity, codex];
    expect(routeModel(all, "simple", "claude")).toMatchObject({ adapter: "antigravity", model: "gemini-3.8-flash" });
    expect(routeModel(all, "complex", "claude")).toMatchObject({ adapter: "claude", model: "claude-opus-5-5", label: "Opus 5.5" });
    expect(routeModel(all, "standard", "claude")).toMatchObject({ adapter: "claude", model: "claude-sonnet-5" });
  });

  it("reste dans l'agent demandé et se replie sans modèle de la gamme", () => {
    expect(routeModel([claude, antigravity], "simple", "claude", "claude")).toMatchObject({ adapter: "claude", model: "claude-haiku-4-5" });
    expect(routeModel([codex], "complex", "codex")).toMatchObject({ adapter: "codex", model: "gpt-5.3-codex" });
    expect(routeModel([adapter("claude", "Claude Code", [["claude-opus-5-5", "Opus 5.5"]], false), antigravity], "complex", "claude")).toMatchObject({
      adapter: "antigravity",
      model: "gemini-3.5-pro",
    });
    expect(routeModel([], "simple", "claude")).toBeNull();
  });
});
