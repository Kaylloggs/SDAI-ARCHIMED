import type { VoiceStatus } from "../store";

/** Ce que montre la vague : le micro, la voix de l'assistant, un travail en cours, ou rien. */
export type WaveMode = "rest" | "input" | "output" | "busy" | "paused" | "error";

export function waveMode(status: VoiceStatus): WaveMode {
  switch (status) {
    case "listening":
    case "hearing":
      return "input";
    case "speaking":
      return "output";
    case "transcribing":
    case "thinking":
    case "tool":
      return "busy";
    case "paused":
      return "paused";
    case "error":
      return "error";
    default:
      return "rest";
  }
}

/** Libellé court de la pastille (une ou deux mots). */
export function statusLabel(status: VoiceStatus, tool?: string | null): string {
  switch (status) {
    case "off":
      return "Parler";
    case "idle":
      return "Micro coupé";
    case "listening":
      return "À l'écoute";
    case "hearing":
      return "Je vous entends";
    case "transcribing":
      return "Transcription";
    case "thinking":
      return "Réflexion";
    case "tool":
      return tool ? capitalize(tool) : "Action";
    case "speaking":
      return "Réponse";
    case "paused":
      return "En pause";
    case "error":
      return "Erreur";
  }
}

/** Phrase complète pour les lecteurs d'écran et l'infobulle. */
export function statusSentence(status: VoiceStatus, tool?: string | null): string {
  switch (status) {
    case "off":
      return "Prêt : ouvrez le micro pour commencer.";
    case "idle":
      return "Session ouverte, micro coupé.";
    case "listening":
      return "Micro ouvert : ARCHIMED écoute.";
    case "hearing":
      return "Micro ouvert : vous parlez.";
    case "transcribing":
      return "Transcription de ce que vous avez dit.";
    case "thinking":
      return "L'assistant prépare sa réponse.";
    case "tool":
      return tool ? `L'assistant utilise un outil : ${tool}.` : "L'assistant utilise un outil.";
    case "speaking":
      return "L'assistant répond à voix haute.";
    case "paused":
      return "Voix en pause.";
    case "error":
      return "Un problème empêche l'assistant vocal de fonctionner.";
  }
}

/** Une réponse ou une action est en cours et peut être arrêtée. */
export function busy(status: VoiceStatus): boolean {
  return status === "thinking" || status === "tool" || status === "speaking" || status === "transcribing" || status === "paused";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
