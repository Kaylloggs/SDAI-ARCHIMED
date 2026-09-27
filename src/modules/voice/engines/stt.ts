import { listen } from "@tauri-apps/api/event";
import { engineApi } from "@/core/engine/engine.api";
import { voiceApi } from "../api";
import { MicCapture } from "../audio/capture";
import { encodeWav, toBase64 } from "../lib/wav";
import type { EnginePriority, SttEngineId, VoiceSettings } from "../lib/settings";
import { sttLocation, type Location } from "../lib/privacy";

export type SttCallbacks = {
  onLevel: (level: number) => void;
  onSpeechStart: () => void;
  /** Texte provisoire pendant qu'on parle (moteurs qui le permettent). */
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onTranscribing: (busy: boolean) => void;
  onError: (message: string) => void;
};

export interface SttSession {
  readonly engine: SttEngineId;
  readonly location: Location;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Appuyer pour parler. */
  begin(): void;
  end(): void;
  /** Voix de l'assistant jouée sans annulation d'écho : seuil de détection relevé. */
  setEchoGuard(factor: number): void;
}

export const isWindows = () => typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

/** Reconnaissance de Windows (moteur du système, hors ligne, texte provisoire en direct). */
class WindowsStt implements SttSession {
  readonly engine = "windows" as const;
  readonly location = "local" as const;
  private stops: Array<() => void> = [];
  private started = false;

  constructor(
    private readonly settings: VoiceSettings,
    private readonly callbacks: SttCallbacks,
  ) {}

  async start(): Promise<void> {
    if (this.stops.length === 0) {
      this.stops = await Promise.all([
        listen<string>("dictation:partial", (e) => {
          if (e.payload) {
            this.callbacks.onSpeechStart();
            this.callbacks.onPartial(e.payload);
          }
        }),
        listen<string>("dictation:final", (e) => e.payload && this.callbacks.onFinal(e.payload)),
        listen<string>("dictation:level", (e) => this.callbacks.onLevel(Number(e.payload) || 0)),
        listen<string>("dictation:ended", (e) => {
          this.started = false;
          if (e.payload) this.callbacks.onError(e.payload);
        }),
      ]);
    }
    if (this.settings.general.mode !== "push") await this.open();
  }

  private async open(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      await engineApi.dictationStart(this.settings.general.language);
    } catch (e) {
      this.started = false;
      this.callbacks.onError((e as { message?: string }).message ?? "Reconnaissance de Windows indisponible.");
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    await engineApi.dictationStop().catch(() => undefined);
    this.stops.forEach((stop) => stop());
    this.stops = [];
    this.callbacks.onLevel(0);
  }

  begin(): void {
    void this.open();
  }

  end(): void {
    this.started = false;
    void engineApi.dictationStop().catch(() => undefined);
  }

  setEchoGuard(): void {}
}

/** Micro de la page + moteur de transcription (local ou en ligne) par phrase. */
class CaptureStt implements SttSession {
  readonly location: Location;
  private capture: MicCapture;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly engine: SttEngineId,
    private readonly settings: VoiceSettings,
    private readonly callbacks: SttCallbacks,
    private readonly fallback: SttEngineId | null,
  ) {
    this.location = sttLocation({ ...settings, stt: { ...settings.stt, engine } });
    this.capture = new MicCapture({
      onLevel: callbacks.onLevel,
      onSpeechStart: callbacks.onSpeechStart,
      onError: callbacks.onError,
      onUtterance: (samples, durationMs) => {
        // Moins de 300 ms : un bruit, pas une phrase.
        if (durationMs < 300) return;
        const wav = toBase64(encodeWav(samples, 16_000));
        this.queue = this.queue.then(() => this.transcribe(wav));
      },
    });
  }

  private request(engine: SttEngineId, wav: string) {
    const { stt, general, performance } = this.settings;
    return {
      engine,
      wav,
      language: general.language,
      model: engine === "whisper" ? stt.model : stt.cloudModel || null,
      baseUrl: engine === "voicebox" || engine === "custom" ? stt.baseUrl : null,
      priority: performance.priority as EnginePriority,
    };
  }

  private async transcribe(wav: string): Promise<void> {
    this.callbacks.onTranscribing(true);
    try {
      const text = await voiceApi.transcribe(this.request(this.engine, wav));
      if (text.trim()) this.callbacks.onFinal(text.trim());
    } catch (e) {
      const message = (e as { message?: string }).message ?? "Transcription impossible.";
      if (this.fallback && this.fallback !== this.engine && this.fallback !== "windows") {
        try {
          const text = await voiceApi.transcribe(this.request(this.fallback, wav));
          if (text.trim()) this.callbacks.onFinal(text.trim());
          return;
        } catch {
          // l'erreur d'origine est la plus parlante
        }
      }
      this.callbacks.onError(message);
    } finally {
      this.callbacks.onTranscribing(false);
    }
  }

  async start(): Promise<void> {
    const { microphone, general, stt, performance } = this.settings;
    // Le modèle local se charge pendant qu'on ouvre le micro.
    if (this.engine === "whisper" && performance.preload) {
      void voiceApi.prepareStt(stt.model, general.language.split("-")[0]!, performance.priority).catch((e) =>
        this.callbacks.onError((e as { message?: string }).message ?? "Whisper indisponible."),
      );
    }
    await this.capture.start({
      deviceId: microphone.deviceId,
      echoCancellation: microphone.echoCancellation,
      noiseSuppression: microphone.noiseSuppression,
      sensitivity: microphone.sensitivity,
      segmentation: general.mode === "push" ? "manual" : "vad",
    });
  }

  async stop(): Promise<void> {
    this.capture.stop();
  }

  begin(): void {
    this.capture.begin();
  }

  end(): void {
    this.capture.end();
  }

  setEchoGuard(factor: number): void {
    this.capture.setEchoGuard(factor);
  }
}

/** Moteur de reconnaissance selon les réglages (Windows seulement sous Windows). */
export function createStt(settings: VoiceSettings, callbacks: SttCallbacks): SttSession {
  const engine = settings.stt.engine === "windows" && !isWindows() ? "whisper" : settings.stt.engine;
  if (engine === "windows") return new WindowsStt(settings, callbacks);
  const fallback = settings.stt.fallback;
  const allowed = fallback && (settings.privacy.allowCloudFallback || sttLocation({ ...settings, stt: { ...settings.stt, engine: fallback } }) === "local");
  return new CaptureStt(engine, settings, callbacks, allowed ? fallback : null);
}
