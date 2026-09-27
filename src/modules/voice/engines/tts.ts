import { voiceApi } from "../api";
import { AudioPlayer } from "../audio/player";
import { VOICEBOX_URL, type TtsEngineId, type VoiceSettings } from "../lib/settings";
import { ttsLocation, type Location } from "../lib/privacy";

export interface TtsEngine {
  readonly engine: TtsEngineId;
  readonly location: Location;
  /** Dit la phrase ; se résout à la fin, ou dès `stop()`. */
  speak(text: string): Promise<void>;
  /** Prépare la phrase suivante pendant que celle-ci est dite. */
  prefetch(text: string): void;
  stop(): void;
  level(): number;
  /** La voix passe par l'annulation d'écho de la page (sinon : seuil d'interruption relevé). */
  readonly echoCancelled: boolean;
}

/** Voix installées sur l'ordinateur (Windows, macOS…), instantanées et hors ligne. */
class SystemTts implements TtsEngine {
  readonly engine = "system" as const;
  readonly location = "local" as const;
  readonly echoCancelled = false;
  private speaking = false;
  private pulse = 0;

  constructor(private readonly settings: VoiceSettings) {}

  private voice(): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis?.getVoices() ?? [];
    const wanted = this.settings.tts.voice;
    if (wanted) {
      const exact = voices.find((v) => v.voiceURI === wanted || v.name === wanted);
      if (exact) return exact;
    }
    const lang = this.settings.general.language.toLowerCase();
    return (
      voices.find((v) => v.lang.toLowerCase() === lang && /natural|neural|online/i.test(v.name)) ??
      voices.find((v) => v.lang.toLowerCase() === lang) ??
      voices.find((v) => v.lang.toLowerCase().startsWith(lang.split("-")[0]!)) ??
      null
    );
  }

  speak(text: string): Promise<void> {
    const synth = window.speechSynthesis;
    if (!synth) return Promise.reject(new Error("Aucune voix système sur cette machine."));
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = this.voice();
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? this.settings.general.language;
      utterance.rate = this.settings.tts.speed;
      utterance.pitch = this.settings.tts.pitch;
      utterance.volume = Math.min(1, this.settings.speaker.volume);
      utterance.onboundary = () => {
        this.pulse = 1;
      };
      utterance.onend = () => {
        this.speaking = false;
        resolve();
      };
      utterance.onerror = (event) => {
        this.speaking = false;
        if (event.error === "interrupted" || event.error === "canceled") resolve();
        else reject(new Error(`Voix système : ${event.error}`));
      };
      this.speaking = true;
      synth.speak(utterance);
    });
  }

  prefetch(): void {}

  stop(): void {
    this.speaking = false;
    window.speechSynthesis?.cancel();
  }

  level(): number {
    if (!this.speaking) return 0;
    // Pas d'accès au son de la voix système : pulsation aux limites de mots.
    this.pulse = Math.max(0.35, this.pulse * 0.9);
    return this.pulse * (0.6 + Math.random() * 0.4);
  }
}

/** Voix produite par un moteur (Piper, OpenAI, ElevenLabs, Voicebox, serveur compatible). */
class RemoteTts implements TtsEngine {
  readonly location: Location;
  readonly echoCancelled = true;
  private cache = new Map<string, Promise<AudioBuffer>>();
  private stopped = false;

  constructor(
    readonly engine: TtsEngineId,
    private readonly settings: VoiceSettings,
    private readonly player: AudioPlayer,
  ) {
    this.location = ttsLocation({ ...settings, tts: { ...settings.tts, engine } });
  }

  private fetch(text: string): Promise<AudioBuffer> {
    const cached = this.cache.get(text);
    if (cached) return cached;
    const { tts, general, performance } = this.settings;
    const promise = voiceApi
      .synthesize({
        engine: this.engine,
        text,
        voice: tts.voice,
        speaker: tts.speaker,
        speed: tts.speed,
        language: general.language,
        instructions: tts.emotion || null,
        expressive: { stability: tts.stability, style: tts.style },
        model: tts.model || null,
        baseUrl: this.engine === "custom" ? tts.baseUrl : this.engine === "voicebox" ? VOICEBOX_URL : null,
        priority: performance.priority,
      })
      .then((bytes) => this.player.decode(bytes));
    this.cache.set(text, promise);
    // Un échec ne reste pas en cache.
    promise.catch(() => this.cache.delete(text));
    if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
    return promise;
  }

  async speak(text: string): Promise<void> {
    this.stopped = false;
    const buffer = await this.fetch(text);
    this.cache.delete(text);
    if (this.stopped) return;
    await this.player.play(buffer, this.settings.speaker.volume);
  }

  prefetch(text: string): void {
    void this.fetch(text).catch(() => undefined);
  }

  stop(): void {
    this.stopped = true;
    this.player.stop();
  }

  level(): number {
    return this.player.level();
  }
}

export function createTts(settings: VoiceSettings, player: AudioPlayer, engine: TtsEngineId = settings.tts.engine): TtsEngine {
  return engine === "system" ? new SystemTts(settings) : new RemoteTts(engine, settings, player);
}

/** Voix système disponibles (chargées de façon asynchrone par le moteur web). */
export function systemVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}
