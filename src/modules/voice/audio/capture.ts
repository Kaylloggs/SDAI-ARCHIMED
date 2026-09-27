import { Vad, rms, thresholdFor } from "../lib/vad";
import { concat, resample } from "../lib/wav";

export type CaptureCallbacks = {
  onLevel: (level: number) => void;
  onSpeechStart: () => void;
  /** Phrase terminée : échantillons 16 kHz mono. */
  onUtterance: (samples: Float32Array, durationMs: number) => void;
  onError: (message: string) => void;
};

export type CaptureOptions = {
  deviceId: string | null;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  sensitivity: number;
  /** `vad` : découpe seul les phrases ; `manual` : entre `begin()` et `end()` (appuyer pour parler). */
  segmentation: "vad" | "manual";
};

const FRAME_MS = 20;
const PRE_ROLL_MS = 300;
export const TARGET_RATE = 16_000;

/** Processeur audio minimal : recopie chaque bloc du micro vers le fil principal. */
const TAP = `class ArchimedTap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor("archimed-tap", ArchimedTap);`;

/**
 * Micro de la page : annulation d'écho (la voix de l'assistant jouée par l'application n'est
 * pas reprise), réduction du bruit, découpe en phrases par l'énergie du signal.
 */
export class MicCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private vad = new Vad({ threshold: 0.03, minSpeechMs: 160, endSilenceMs: 750, maxUtteranceMs: 30_000 });
  private pending = new Float32Array(0);
  private preRoll: Float32Array[] = [];
  private speech: Float32Array[] = [];
  private manualActive = false;
  private lastLevelAt = 0;
  private boost = 1;
  private options: CaptureOptions | null = null;

  constructor(private readonly callbacks: CaptureCallbacks) {}

  get running(): boolean {
    return this.context !== null;
  }

  async start(options: CaptureOptions): Promise<void> {
    this.options = options;
    this.vad.setOptions({ threshold: thresholdFor(options.sensitivity) * this.boost });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
          echoCancellation: options.echoCancellation,
          noiseSuppression: options.noiseSuppression,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (error) {
      const name = (error as DOMException)?.name;
      this.callbacks.onError(
        name === "NotAllowedError"
          ? "Accès au micro refusé : autorisez-le pour ARCHIMED dans les paramètres de confidentialité du système."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "Je n'arrive pas à accéder au microphone sélectionné : branchez-le ou choisissez-en un autre dans Voice › Micro et son."
            : `Micro indisponible (${(error as Error)?.message ?? name}).`,
      );
      throw error;
    }
    const context = new AudioContext();
    this.context = context;
    const source = context.createMediaStreamSource(this.stream);
    const silent = context.createGain();
    silent.gain.value = 0;
    silent.connect(context.destination);
    try {
      const url = URL.createObjectURL(new Blob([TAP], { type: "application/javascript" }));
      await context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const tap = new AudioWorkletNode(context, "archimed-tap");
      tap.port.onmessage = (event: MessageEvent<Float32Array>) => this.feed(event.data);
      source.connect(tap).connect(silent);
      this.nodes = [source, tap, silent];
    } catch {
      // Ancien moteur web : processeur de script (déprécié mais universel).
      const processor = context.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = (event) => this.feed(new Float32Array(event.inputBuffer.getChannelData(0)));
      source.connect(processor).connect(silent);
      this.nodes = [source, processor, silent];
    }
    // Micro débranché en cours d'écoute.
    this.stream.getAudioTracks().forEach((track) => {
      track.onended = () => this.callbacks.onError("Le micro s'est déconnecté.");
    });
  }

  stop(): void {
    this.nodes.forEach((node) => node.disconnect());
    this.nodes = [];
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.vad.reset();
    this.speech = [];
    this.preRoll = [];
    this.pending = new Float32Array(0);
    this.manualActive = false;
    this.callbacks.onLevel(0);
  }

  setSensitivity(sensitivity: number): void {
    if (this.options) this.options.sensitivity = sensitivity;
    this.vad.setOptions({ threshold: thresholdFor(sensitivity) * this.boost });
  }

  /**
   * Pendant que l'assistant parle par des haut-parleurs sans annulation d'écho (voix du
   * système), il faut parler plus fort pour lui couper la parole.
   */
  setEchoGuard(factor: number): void {
    this.boost = factor;
    this.vad.setOptions({ threshold: thresholdFor(this.options?.sensitivity ?? 0.6) * factor });
  }

  /** Appuyer pour parler : début de l'enregistrement. */
  begin(): void {
    this.manualActive = true;
    this.speech = [...this.preRoll];
    this.callbacks.onSpeechStart();
  }

  /** Relâcher : la phrase part en transcription. */
  end(): void {
    if (!this.manualActive) return;
    this.manualActive = false;
    this.emit();
  }

  private feed(block: Float32Array): void {
    const context = this.context;
    if (!context) return;
    const frameSize = Math.round((context.sampleRate * FRAME_MS) / 1000);
    const merged = new Float32Array(this.pending.length + block.length);
    merged.set(this.pending);
    merged.set(block, this.pending.length);
    let offset = 0;
    while (merged.length - offset >= frameSize) {
      this.frame(merged.slice(offset, offset + frameSize));
      offset += frameSize;
    }
    this.pending = merged.slice(offset);
  }

  private frame(frame: Float32Array): void {
    const level = rms(frame);
    const now = performance.now();
    if (now - this.lastLevelAt > 50) {
      this.lastLevelAt = now;
      this.callbacks.onLevel(Math.min(1, level * 6));
    }
    if (this.options?.segmentation === "manual") {
      if (this.manualActive) this.speech.push(frame);
      else this.remember(frame);
      return;
    }
    const event = this.vad.push(level, FRAME_MS);
    if (event.type === "start") {
      this.speech = [...this.preRoll, frame];
      this.callbacks.onSpeechStart();
    } else if (this.vad.active) {
      this.speech.push(frame);
    } else if (event.type === "end") {
      this.speech.push(frame);
      this.emit();
    } else {
      this.remember(frame);
    }
  }

  private remember(frame: Float32Array): void {
    this.preRoll.push(frame);
    while (this.preRoll.length * FRAME_MS > PRE_ROLL_MS) this.preRoll.shift();
  }

  private emit(): void {
    const context = this.context;
    const frames = this.speech;
    this.speech = [];
    if (!context || frames.length === 0) return;
    const samples = resample(concat(frames), context.sampleRate, TARGET_RATE);
    this.callbacks.onUtterance(samples, (samples.length / TARGET_RATE) * 1000);
  }
}

/** Micros et sorties audio de la machine (noms visibles une fois l'accès au micro accordé). */
export async function listDevices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: devices.filter((d) => d.kind === "audioinput"),
      outputs: devices.filter((d) => d.kind === "audiooutput"),
    };
  } catch {
    return { inputs: [], outputs: [] };
  }
}
