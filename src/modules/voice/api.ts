import { Channel, invokeModule } from "@/core/ipc";
import type { HardwareInfo } from "@/core/ipc/bindings/HardwareInfo";
import type { LocalChatEvent } from "@/core/ipc/bindings/LocalChatEvent";
import type { LocalServerStatus } from "@/core/ipc/bindings/LocalServerStatus";
import type { McpInfo } from "@/core/ipc/bindings/McpInfo";
import type { VoiceModelEntry } from "@/core/ipc/bindings/VoiceModelEntry";
import type { VoiceOption } from "@/core/ipc/bindings/VoiceOption";
import type { VoiceProviderStatus } from "@/core/ipc/bindings/VoiceProviderStatus";
import type { VoiceSessionSummary } from "@/core/ipc/bindings/VoiceSessionSummary";
import type { VoiceToolStatus } from "@/core/ipc/bindings/VoiceToolStatus";
import type { EnginePriority } from "./lib/settings";

export type { HardwareInfo, LocalChatEvent, LocalServerStatus, McpInfo, VoiceModelEntry, VoiceOption, VoiceProviderStatus, VoiceSessionSummary, VoiceToolStatus };
export type { VoiceInstallProgress } from "@/core/ipc/bindings/VoiceInstallProgress";
export type { VoiceModelProgress } from "@/core/ipc/bindings/VoiceModelProgress";
export type { McpCall } from "@/core/ipc/bindings/McpCall";

const call = <T>(command: string, args?: Record<string, unknown>) => invokeModule<T>("voice", `voice_${command}`, args);

export type TranscribeRequest = {
  engine: string;
  /** WAV 16 kHz mono, base64. */
  wav: string;
  language?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  priority?: EnginePriority;
};

export type SpeakRequest = {
  engine: string;
  text: string;
  voice?: string | null;
  speaker?: number | null;
  speed?: number;
  language?: string | null;
  instructions?: string | null;
  expressive?: { stability?: number; style?: number };
  model?: string | null;
  baseUrl?: string | null;
  priority?: EnginePriority;
};

export type McpReply = { ok: boolean; text: string; data?: Record<string, unknown> | null };

export const voiceApi = {
  hardware: () => call<HardwareInfo>("hardware_info"),
  models: () => call<VoiceModelEntry[]>("list_models"),
  download: (id: string) => call<void>("download_model", { id }),
  pause: (id: string) => call<void>("pause_model", { id }),
  remove: (id: string) => call<void>("delete_model", { id }),
  verify: (id: string) => call<void>("verify_model", { id }),
  prepareStt: (model: string, language: string, priority?: EnginePriority) => call<void>("prepare_stt", { model, language, priority }),
  transcribe: (request: TranscribeRequest) => call<string>("transcribe", { request }),
  /** Son de la phrase (WAV ou MP3). */
  synthesize: (request: SpeakRequest) => call<ArrayBuffer>("synthesize", { request }),
  voices: (engine: string, baseUrl?: string | null) => call<VoiceOption[]>("list_voices", { engine, baseUrl: baseUrl ?? null }),
  providers: () => call<VoiceProviderStatus[]>("providers"),
  setKey: (provider: string, key: string) => call<void>("set_provider_key", { provider, key }),
  clearKey: (provider: string) => call<void>("clear_provider_key", { provider }),
  ollama: () => call<LocalServerStatus>("ollama_status"),
  voicebox: (baseUrl?: string | null) => call<LocalServerStatus>("voicebox_status", { baseUrl: baseUrl ?? null }),
  localChat: (chatId: string, model: string, messages: Array<{ role: string; content: string }>, onEvent: Channel<LocalChatEvent>) =>
    call<void>("local_chat", { chatId, model, messages, onEvent }),
  cancelLocalChat: (chatId: string) => call<void>("cancel_local_chat", { chatId }),
  mcpInfo: () => call<McpInfo>("mcp_info"),
  mcpRespond: (callId: string, reply: McpReply) => call<void>("mcp_respond", { callId, reply }),
  bridgeReady: (ready: boolean) => call<void>("bridge_ready", { ready }),
  stopEngines: () => call<void>("stop_engines"),
  getSettings: () => call<unknown>("get_settings"),
  saveSettings: (settings: unknown) => call<void>("save_settings", { settings }),
  sessions: () => call<VoiceSessionSummary[]>("list_sessions"),
  session: (id: string) => call<unknown>("get_session", { id }),
  saveSession: (session: unknown) => call<void>("save_session", { session }),
  deleteSession: (id: string) => call<void>("delete_session", { id }),
  /** Ollama et Voicebox : installés, lancés, installables d'un clic. */
  tools: () => call<VoiceToolStatus[]>("tools"),
  /** `ollama`, `voicebox`, `claude`, `codex` ; avancement par l'événement `voice:install`. */
  installTool: (id: string) => call<string>("install_tool", { id }),
  launchTool: (id: string) => call<void>("launch_tool", { id }),
  /** Terminal ouvert sur la CLI d'un agent, pour s'y connecter soi-même. */
  agentTerminal: (adapter: string) => call<void>("agent_terminal", { adapter }),
  openSystemSpeech: () => call<void>("open_system_speech"),
};

export { Channel };
