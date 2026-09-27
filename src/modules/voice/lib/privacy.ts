import type { VoiceSettings } from "./settings";

export type Location = "local" | "cloud";
export type PrivacyRow = { stage: string; location: Location; detail: string };

const isLocalUrl = (url: string) => /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i.test(url.trim());

export function sttLocation(settings: VoiceSettings): Location {
  const { engine, baseUrl } = settings.stt;
  if (engine === "windows" || engine === "whisper") return "local";
  if (engine === "voicebox" || engine === "custom") return isLocalUrl(baseUrl) ? "local" : "cloud";
  return "cloud";
}

export function ttsLocation(settings: VoiceSettings): Location {
  const { engine, baseUrl } = settings.tts;
  if (engine === "system" || engine === "piper") return "local";
  if (engine === "voicebox") return "local";
  if (engine === "custom") return isLocalUrl(baseUrl) ? "local" : "cloud";
  return "cloud";
}

export function brainLocation(settings: VoiceSettings): Location {
  return settings.agent.brain === "local" ? "local" : "cloud";
}

/** Ce qui sort de l'ordinateur, étape par étape (affiché dans la pastille et les réglages). */
export function privacyRows(settings: VoiceSettings, agentName: string): PrivacyRow[] {
  const stt = sttLocation(settings);
  const tts = ttsLocation(settings);
  const brain = brainLocation(settings);
  return [
    { stage: "Micro", location: "local", detail: "Le son reste sur l'ordinateur jusqu'à la reconnaissance." },
    {
      stage: "Reconnaissance",
      location: stt,
      detail: stt === "local" ? "Transcrite sur cette machine." : "Votre voix est envoyée au fournisseur choisi.",
    },
    {
      stage: "Intelligence",
      location: brain,
      detail: brain === "local" ? "Modèle local (Ollama)." : `Le texte transcrit part vers ${agentName}.`,
    },
    {
      stage: "Voix",
      location: tts,
      detail: tts === "local" ? "Synthétisée sur cette machine." : "Le texte de la réponse part vers le fournisseur de voix.",
    },
  ];
}

/** Hors ligne possible : tout est local. */
export function fullyOffline(settings: VoiceSettings): boolean {
  return sttLocation(settings) === "local" && ttsLocation(settings) === "local" && brainLocation(settings) === "local";
}

/**
 * Mode « local d'abord » : les moteurs en ligne sont remplacés par leur équivalent local.
 * Renvoie les réglages effectifs (les réglages enregistrés ne changent pas).
 */
export function effectiveSettings(settings: VoiceSettings): VoiceSettings {
  if (!settings.privacy.localOnly) return settings;
  const next = structuredClone(settings);
  if (sttLocation(settings) === "cloud") next.stt.engine = "windows";
  if (ttsLocation(settings) === "cloud") next.tts.engine = "system";
  return next;
}
