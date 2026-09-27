/**
 * Détection de la parole par l'énergie du signal (léger, instantané, hors ligne).
 * Découpe le flux du micro en phrases : début quand le niveau dépasse le seuil assez
 * longtemps, fin après un silence.
 */
export type VadOptions = {
  /** Seuil de niveau (RMS 0–1) au-dessus duquel on considère qu'on parle. */
  threshold: number;
  /** Durée de parole avant de valider un début (évite les clics). */
  minSpeechMs: number;
  /** Silence qui clôt une phrase. */
  endSilenceMs: number;
  /** Phrase coupée au-delà. */
  maxUtteranceMs: number;
};

export type VadEvent = { type: "start" } | { type: "end"; durationMs: number } | { type: "none" };

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i]! * frame[i]!;
  return Math.sqrt(sum / Math.max(1, frame.length));
}

/** Sensibilité (0 : peu sensible, 1 : très sensible) → seuil RMS. */
export function thresholdFor(sensitivity: number): number {
  const s = Math.min(1, Math.max(0, sensitivity));
  return 0.06 - s * 0.05;
}

export class Vad {
  private speaking = false;
  private speechMs = 0;
  private silenceMs = 0;
  private utteranceMs = 0;

  constructor(private options: VadOptions) {}

  setOptions(options: Partial<VadOptions>): void {
    this.options = { ...this.options, ...options };
  }

  get active(): boolean {
    return this.speaking;
  }

  /** Traite une trame de `durationMs` au niveau `level`. */
  push(level: number, durationMs: number): VadEvent {
    const loud = level >= this.options.threshold;
    if (!this.speaking) {
      this.speechMs = loud ? this.speechMs + durationMs : 0;
      if (this.speechMs >= this.options.minSpeechMs) {
        this.speaking = true;
        this.silenceMs = 0;
        this.utteranceMs = this.speechMs;
        return { type: "start" };
      }
      return { type: "none" };
    }
    this.utteranceMs += durationMs;
    this.silenceMs = loud ? 0 : this.silenceMs + durationMs;
    if (this.silenceMs >= this.options.endSilenceMs || this.utteranceMs >= this.options.maxUtteranceMs) {
      const durationMs = this.utteranceMs;
      this.reset();
      return { type: "end", durationMs };
    }
    return { type: "none" };
  }

  reset(): void {
    this.speaking = false;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.utteranceMs = 0;
  }
}
