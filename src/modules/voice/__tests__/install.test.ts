import { describe, expect, it } from "vitest";
import type { VoiceModelEntry } from "../api";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { activation, isActive, recommended } from "../settings/install";

const model = (id: string, kind: VoiceModelEntry["kind"], patch: Partial<VoiceModelEntry> = {}): VoiceModelEntry => ({
  id,
  kind,
  name: id,
  description: "",
  engine: "",
  version: id,
  sizeMb: 100,
  ramMb: 100,
  vramMb: null,
  speed: 3,
  quality: 3,
  languages: ["fr", "en"],
  capabilities: [],
  license: "MIT",
  fit: "recommended",
  status: "notInstalled",
  requires: null,
  received: 0,
  total: 0,
  error: null,
  path: null,
  ...patch,
});

describe("installation conseillée", () => {
  const models = [
    model("stt-small", "stt", { quality: 4, sizeMb: 488 }),
    model("stt-base", "stt", { quality: 3, sizeMb: 148 }),
    model("stt-turbo", "stt", { quality: 5, sizeMb: 574, fit: "notRecommended" }),
    model("tts-fr", "tts", { languages: ["fr"], quality: 3 }),
    model("tts-en", "tts", { languages: ["en"], quality: 4 }),
    model("llm-7b", "llm", { fit: "optional", sizeMb: 4700, version: "qwen2.5:7b" }),
    model("llm-3b", "llm", { fit: "optional", sizeMb: 1900, version: "qwen2.5:3b" }),
  ];

  it("choisit le meilleur modèle recommandé, jamais un modèle déconseillé", () => {
    expect(recommended(models, "stt", "fr-FR")?.id).toBe("stt-small");
  });

  it("choisit une voix dans la langue de la personne", () => {
    expect(recommended(models, "tts", "fr-CA")?.id).toBe("tts-fr");
    expect(recommended(models, "tts", "en-US")?.id).toBe("tts-en");
    expect(recommended(models, "tts", "de-DE")).toBeNull();
  });

  it("à défaut de recommandé, prend le plus léger des optionnels", () => {
    expect(recommended(models, "llm", "fr-FR")?.id).toBe("llm-3b");
  });

  it("met le modèle en service", () => {
    const stt = activation(models[1]!)(DEFAULT_SETTINGS);
    expect(stt.stt).toMatchObject({ engine: "whisper", model: "stt-base" });
    expect(isActive(models[1]!, stt)).toBe(true);
    const tts = activation(models[3]!)(DEFAULT_SETTINGS);
    expect(tts.tts).toMatchObject({ engine: "piper", voice: "tts-fr", speaker: null });
    const llm = activation(models[6]!)(DEFAULT_SETTINGS);
    expect(llm.agent.localModel).toBe("qwen2.5:3b");
    expect(isActive(models[5]!, DEFAULT_SETTINGS)).toBe(false);
  });
});
