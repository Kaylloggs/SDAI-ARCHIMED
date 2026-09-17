import { Channel, invokeCore } from "@/core/ipc";
import type {
  AdapterInfo,
  AutoMode,
  EngineEvent,
  PromptAnswer,
  SessionId,
} from "./types";

export const engineApi = {
  /** Détection mise en cache 10 min côté Rust ; `force` relance le sondage. */
  listAdapters: (force = false) => invokeCore<AdapterInfo[]>("engine_list_adapters", { force }),

  /** Force le chemin d'une CLI hors PATH (`null` = détection automatique). */
  setBinaryOverride: (adapter: string, path: string | null) =>
    invokeCore<void>("engine_set_binary_override", { adapter, path }),

  startSession: (params: {
    adapter: string;
    model: string | null;
    cwd: string | null;
    autoMode: AutoMode;
    /** Identifiant de conversation de la CLI à reprendre (contexte conservé). */
    resume: string | null;
    /** Réglages « Économie de tokens » (Réglages) appliqués au lancement. */
    tuning?: EngineTuning;
    onEvent: Channel<EngineEvent>;
  }) => invokeCore<SessionId>("engine_start_session", params),

  sendMessage: (sessionId: SessionId, text: string) =>
    invokeCore<void>("engine_send_message", { sessionId, text }),

  answerPrompt: (sessionId: SessionId, promptId: string, answer: PromptAnswer) =>
    invokeCore<void>("engine_answer_prompt", { sessionId, promptId, answer }),

  setAutoMode: (sessionId: SessionId, mode: AutoMode) =>
    invokeCore<void>("engine_set_auto_mode", { sessionId, mode }),

  stopSession: (sessionId: SessionId) =>
    invokeCore<void>("engine_stop_session", { sessionId }),

  defaultCwd: () => invokeCore<string>("engine_default_cwd"),

  /** Ouvre le dossier des adaptateurs TOML (ajouter une CLI sans code). */
  openAdaptersDir: () => invokeCore<void>("engine_open_adapters_dir"),

  /** Chemins cités par une IA → chemins existants (`null` si introuvable). */
  resolvePaths: (candidates: string[], cwd: string | null, hints: string[]) =>
    invokeCore<Array<ResolvedPath | null>>("engine_resolve_paths", { candidates, cwd, hints }),

  /** Application par défaut (programmes refusés côté Rust). */
  openPath: (path: string) => invokeCore<void>("engine_open_path", { path }),

  revealPath: (path: string) => invokeCore<void>("engine_reveal_path", { path }),

  /**
   * Dictée vocale locale (reconnaissance vocale de Windows) : aucun appel réseau à une IA,
   * donc aucun token. Le texte arrive par les événements `dictation:partial` / `dictation:final`.
   */
  dictationStart: (language: string | null) => invokeCore<void>("engine_dictation_start", { language }),
  dictationStop: () => invokeCore<void>("engine_dictation_stop"),

  /** Ports locaux qui répondent (serveurs de test). */
  probePorts: (ports: number[]) => invokeCore<number[]>("engine_probe_ports", { ports }),
};

export type ResolvedPath = { path: string; isDir: boolean };

/** Miroir de `EngineTuning` (src-tauri/src/engine/event.rs). */
export type EngineTuning = {
  effort: string | null;
  disableSkills: boolean;
  cacheFriendly: boolean;
  compactAt: string | null;
};
