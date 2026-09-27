/**
 * Lecture des voix synthétisées (WAV, MP3) par la page : la même chaîne audio que le micro,
 * donc l'annulation d'écho du moteur web reconnaît la voix de l'assistant et ne la reprend pas.
 */
export class AudioPlayer {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private finish: (() => void) | null = null;
  private data = new Uint8Array(512);
  private sinkId: string | null = null;

  private ensure(): AudioContext {
    if (!this.context) {
      const context = new AudioContext();
      this.gain = context.createGain();
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 512;
      this.gain.connect(this.analyser).connect(context.destination);
      this.context = context;
      if (this.sinkId) void this.applySink(this.sinkId);
    }
    return this.context;
  }

  /** Sortie choisie (casque, haut-parleurs) ; `null` : sortie par défaut. */
  async setSink(deviceId: string | null): Promise<void> {
    this.sinkId = deviceId;
    if (this.context) await this.applySink(deviceId);
  }

  private async applySink(deviceId: string | null): Promise<void> {
    const context = this.context as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (context?.setSinkId) await context.setSinkId(deviceId ?? "").catch(() => undefined);
  }

  async decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const context = this.ensure();
    return context.decodeAudioData(bytes.slice(0));
  }

  /** Joue un son ; la promesse se résout à la fin ou à l'arrêt (`stop`). */
  async play(buffer: AudioBuffer, volume: number): Promise<void> {
    const context = this.ensure();
    if (context.state === "suspended") await context.resume().catch(() => undefined);
    this.stop();
    const source = context.createBufferSource();
    source.buffer = buffer;
    this.gain!.gain.value = Math.max(0, Math.min(1.5, volume));
    source.connect(this.gain!);
    this.source = source;
    return new Promise((resolve) => {
      this.finish = resolve;
      source.onended = () => {
        if (this.source === source) this.source = null;
        this.finish = null;
        resolve();
      };
      source.start();
    });
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    if (source) {
      try {
        source.stop();
      } catch {
        // déjà arrêté
      }
    }
    this.finish?.();
    this.finish = null;
  }

  /** Niveau de sortie (0–1) pour l'animation. */
  level(): number {
    if (!this.analyser || !this.source) return 0;
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (const value of this.data) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    return Math.min(1, Math.sqrt(sum / this.data.length) * 4);
  }

  get playing(): boolean {
    return this.source !== null;
  }
}

/** Petits sons d'état (désactivables) : écoute, arrêt, annonce, erreur. */
export function earcon(kind: "listen" | "stop" | "notice" | "error", volume = 0.25): void {
  try {
    const context = new AudioContext();
    const tones: Record<typeof kind, number[]> = {
      listen: [660, 880],
      stop: [700, 520],
      notice: [880],
      error: [330, 250],
    };
    let at = context.currentTime;
    for (const frequency of tones[kind]) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(volume, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      osc.connect(gain).connect(context.destination);
      osc.start(at);
      osc.stop(at + 0.13);
      at += 0.09;
    }
    setTimeout(() => void context.close().catch(() => undefined), 600);
  } catch {
    // pas d'audio disponible
  }
}
