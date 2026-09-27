import { create } from "zustand";
import type { VoicePriority } from "@/core/bus/event-bus";
import { DEFAULT_SETTINGS, normalizeSettings, type VoiceSettings } from "./lib/settings";
import { voiceApi } from "./api";

export type VoiceStatus =
  | "off"
  | "idle"
  | "listening"
  | "hearing"
  | "transcribing"
  | "thinking"
  | "tool"
  | "speaking"
  | "paused"
  | "error";

export type Turn = {
  id: string;
  role: "user" | "assistant" | "notice" | "system";
  text: string;
  at: number;
  /** Outils utilisés pendant ce tour (réponses de l'assistant). */
  tools?: string[];
  source?: string;
  priority?: VoicePriority;
};

export type VoiceTask = {
  id: string;
  title: string;
  agent: string;
  conversationId: string;
  status: "running" | "done" | "failed" | "stopped";
  startedAt: number;
  endedAt?: number;
  summary?: string;
  activity?: string | null;
};

export type VoiceSession = {
  id: string;
  title: string;
  startedAt: number;
  updatedAt: number;
  turns: Turn[];
  tasks: VoiceTask[];
  /** Conversation de l'agent (moteur) propre à cette session ; oubliée à la fin de la session. */
  conversationId: string | null;
  agent: string;
  brain: "cli" | "local";
};

export type Confirmation = {
  id: string;
  question: string;
  /** `always` proposé quand l'agent le permet. */
  always: boolean;
  source: string;
};

type State = {
  settings: VoiceSettings;
  loaded: boolean;
  status: VoiceStatus;
  /** Micro ouvert (indépendant de l'état : l'assistant peut parler micro ouvert). */
  micOn: boolean;
  /** Texte en cours de reconnaissance. */
  partial: string;
  error: string | null;
  session: VoiceSession | null;
  /** Outils utilisés pendant le tour en cours. */
  tools: string[];
  confirmation: Confirmation | null;
  /** Phrase en cours de lecture (sous-titres). */
  caption: string;
  panelOpen: boolean;
  /** Modèles à activer dès la fin de leur installation (« Installer et utiliser »). */
  activateOnInstall: Record<string, (s: VoiceSettings) => VoiceSettings>;
  setSettings: (update: (s: VoiceSettings) => VoiceSettings) => void;
  load: () => Promise<void>;
  patch: (partial: Partial<Omit<State, "setSettings" | "load" | "patch" | "updateSession">>) => void;
  updateSession: (update: (s: VoiceSession) => VoiceSession) => void;
};

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useVoiceStore = create<State>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  status: "off",
  micOn: false,
  partial: "",
  error: null,
  session: null,
  tools: [],
  confirmation: null,
  caption: "",
  panelOpen: false,
  activateOnInstall: {},
  setSettings: (update) => {
    const settings = update(get().settings);
    set({ settings });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void voiceApi.saveSettings(settings).catch(() => undefined), 400);
  },
  load: async () => {
    if (get().loaded) return;
    const raw = await voiceApi.getSettings().catch(() => null);
    set({ settings: normalizeSettings(raw), loaded: true });
  },
  patch: (partial) => set(partial),
  updateSession: (update) => {
    const session = get().session;
    if (!session) return;
    set({ session: { ...update(session), updatedAt: Date.now() } });
  },
}));

/** Niveaux audio lus par l'animation (hors store : 20 mises à jour par seconde). */
export const meter = {
  input: 0,
  output: () => 0,
};
