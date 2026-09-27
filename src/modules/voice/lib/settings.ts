import type { AutoMode } from "@/core/engine/types";

/** Serveur Voicebox local (github.com/jamiepine/voicebox). */
export const VOICEBOX_URL = "http://127.0.0.1:17493";

export type SttEngineId = "windows" | "whisper" | "openai" | "groq" | "elevenlabs" | "voicebox" | "custom";
export type TtsEngineId = "system" | "piper" | "openai" | "elevenlabs" | "voicebox" | "custom";
export type ListenMode = "toggle" | "push" | "wake";
export type Brain = "cli" | "local";
export type EnginePriority = "low" | "normal" | "high";

export type VoiceSettings = {
  general: {
    /** Langue parlée et répondue (BCP-47). */
    language: string;
    /** `toggle` : un clic ou un raccourci ouvre l'écoute ; `push` : maintenir ; `wake` : mot d'éveil. */
    mode: ListenMode;
    wakeWord: string;
    /** Continuer d'écouter après chaque réponse (conversation naturelle, interruption possible). */
    continuous: boolean;
    /** Annonces pendant les tâches longues : `off`, `short`, `detailed`. */
    progress: "off" | "short" | "detailed";
    sounds: boolean;
    liveTranscript: boolean;
  };
  microphone: { deviceId: string | null; sensitivity: number; echoCancellation: boolean; noiseSuppression: boolean };
  speaker: { deviceId: string | null; volume: number };
  stt: { engine: SttEngineId; model: string; cloudModel: string; baseUrl: string; fallback: SttEngineId | null };
  tts: {
    engine: TtsEngineId;
    voice: string | null;
    speaker: number | null;
    speed: number;
    pitch: number;
    emotion: string;
    model: string;
    baseUrl: string;
    stability: number;
    style: number;
    fallback: TtsEngineId | null;
  };
  agent: { brain: Brain; adapter: string; model: string | null; localModel: string; autoMode: AutoMode };
  privacy: { localOnly: boolean; allowCloudFallback: boolean };
  overlay: { mini: boolean; animations: boolean; captions: boolean };
  shortcuts: { toggle: string; pushToTalk: string };
  performance: { priority: EnginePriority; preload: boolean };
  mcp: { shareTools: boolean };
};

export const DEFAULT_SETTINGS: VoiceSettings = {
  general: {
    language: "fr-FR",
    mode: "toggle",
    wakeWord: "Archimède",
    continuous: true,
    progress: "short",
    sounds: true,
    liveTranscript: true,
  },
  microphone: { deviceId: null, sensitivity: 0.6, echoCancellation: true, noiseSuppression: true },
  speaker: { deviceId: null, volume: 1 },
  stt: { engine: "windows", model: "stt-whisper-base", cloudModel: "", baseUrl: "http://127.0.0.1:17493", fallback: null },
  tts: {
    engine: "system",
    voice: null,
    speaker: null,
    speed: 1,
    pitch: 1,
    emotion: "",
    model: "",
    baseUrl: "http://127.0.0.1:8880/v1",
    stability: 0.5,
    style: 0,
    fallback: "system",
  },
  agent: { brain: "cli", adapter: "claude", model: null, localModel: "qwen2.5:3b", autoMode: "smart" },
  privacy: { localOnly: false, allowCloudFallback: false },
  overlay: { mini: false, animations: true, captions: true },
  shortcuts: { toggle: "Ctrl+Shift+Space", pushToTalk: "Ctrl+Space" },
  performance: { priority: "normal", preload: true },
  mcp: { shareTools: true },
};

/** Réglages enregistrés + valeurs par défaut pour ce qui manque (nouvelle version, fichier abîmé). */
export function normalizeSettings(raw: unknown): VoiceSettings {
  const saved = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, Record<string, unknown>>;
  for (const [section, defaults] of Object.entries(out)) {
    const value = saved[section];
    if (!value || typeof value !== "object") continue;
    for (const key of Object.keys(defaults)) {
      const next = (value as Record<string, unknown>)[key];
      const current = defaults[key];
      if (next === undefined) continue;
      if (current === null || typeof next === typeof current) defaults[key] = next;
    }
  }
  return out as unknown as VoiceSettings;
}

export const STT_ENGINES: Record<SttEngineId, { label: string; hint: string }> = {
  windows: { label: "Windows (système)", hint: "Reconnaissance de Windows, hors ligne une fois la langue installée." },
  whisper: { label: "Whisper local", hint: "whisper.cpp sur votre machine : précis, rien ne sort." },
  openai: { label: "OpenAI", hint: "gpt-4o-mini-transcribe, en ligne." },
  groq: { label: "Groq", hint: "Whisper Large v3 Turbo, en ligne, très rapide." },
  elevenlabs: { label: "ElevenLabs", hint: "Scribe, en ligne." },
  voicebox: { label: "Voicebox", hint: "Serveur Voicebox lancé sur cette machine." },
  custom: { label: "Serveur compatible", hint: "Adresse compatible OpenAI (/audio/transcriptions)." },
};

export const TTS_ENGINES: Record<TtsEngineId, { label: string; hint: string; pitch: boolean; emotion: boolean }> = {
  system: { label: "Voix du système", hint: "Voix installées sur l'ordinateur, instantanées.", pitch: true, emotion: false },
  piper: { label: "Piper local", hint: "Voix neuronales locales, rapides et hors ligne.", pitch: false, emotion: false },
  openai: { label: "OpenAI", hint: "gpt-4o-mini-tts : ton et émotion réglables, en ligne.", pitch: false, emotion: true },
  elevenlabs: { label: "ElevenLabs", hint: "Voix expressives, vos voix personnelles, en ligne.", pitch: false, emotion: true },
  voicebox: { label: "Voicebox", hint: "Profils de voix Voicebox, sur cette machine.", pitch: false, emotion: true },
  custom: { label: "Serveur compatible", hint: "Kokoro-FastAPI, LocalAI… (/audio/speech).", pitch: false, emotion: false },
};
