import { describe, expect, it } from "vitest";
import type { ModelInfo } from "@/core/engine/types";
import { resolveModel, switchModel } from "../models";

const levels = (id: string, list: string[], auto = true) =>
  (auto ? ["auto", ...list] : list).map((level) => ({
    id: level === "auto" ? id : `${id}:${level}`,
    level,
    label: level,
  }));

const claude: ModelInfo[] = [
  { id: "claude-opus-5-5", label: "Opus 5.5", efforts: levels("claude-opus-5-5", ["low", "medium", "high", "xhigh", "max"]) },
  { id: "claude-sonnet-5", label: "Sonnet 5", efforts: levels("claude-sonnet-5", ["low", "medium", "high", "xhigh", "max"]) },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", efforts: [] },
];

const gemini: ModelInfo[] = [
  {
    id: "gemini-3.8-flash-medium",
    label: "Gemini 3.8 Flash",
    efforts: ["low", "medium", "high"].map((level) => ({ id: `gemini-3.8-flash-${level}`, level, label: level })),
  },
  { id: "gemini-3.8-pro-high", label: "Gemini 3.8 Pro", efforts: [{ id: "gemini-3.8-pro-high", level: "high", label: "high" }] },
];

describe("sélection du modèle", () => {
  it("retrouve le modèle et le niveau d'un identifiant exact", () => {
    const choice = resolveModel(claude, "claude-opus-5-5:xhigh", "claude-sonnet-5");
    expect(choice?.model.label).toBe("Opus 5.5");
    expect(choice?.effort?.level).toBe("xhigh");
    expect(resolveModel(claude, "claude-opus-5-5", null)?.effort?.level).toBe("auto");
    expect(resolveModel(gemini, "gemini-3.8-flash-high", null)?.model.label).toBe("Gemini 3.8 Flash");
  });

  it("rapproche un identifiant enregistré avant les noms réels", () => {
    const choice = resolveModel(claude, "sonnet:medium", null);
    expect(choice?.model.label).toBe("Sonnet 5");
    expect(choice?.effort?.level).toBe("medium");
    expect(resolveModel(claude, "haiku", null)?.model.label).toBe("Haiku 4.5");
  });

  it("retombe sur le modèle par défaut, ou sur rien", () => {
    expect(resolveModel(claude, "inconnu", "claude-sonnet-5")?.model.label).toBe("Sonnet 5");
    expect(resolveModel(claude, null, "claude-sonnet-5")?.effort?.level).toBe("auto");
    expect(resolveModel(gemini, null, null)).toBeNull();
  });

  it("garde le niveau d'effort en changeant de modèle quand c'est possible", () => {
    const current = resolveModel(claude, "claude-sonnet-5:high", null)?.effort ?? null;
    expect(switchModel(claude[0]!, current)).toBe("claude-opus-5-5:high");
    expect(switchModel(claude[2]!, current)).toBe("claude-haiku-4-5");
    expect(switchModel(gemini[0]!, current)).toBe("gemini-3.8-flash-high");
    expect(switchModel(gemini[0]!, null)).toBe("gemini-3.8-flash-medium");
  });
});
