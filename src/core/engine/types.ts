/**
 * Contrat du moteur — miroir des types Rust (`src-tauri/src/engine/event.rs`).
 * Sera généré par ts-rs en Phase 2 ; garder synchronisé en attendant.
 */

export type AdapterId = string;
export type SessionId = string;

export type TransportKind = "structured" | "pty";

export type AdapterInfo = {
  id: AdapterId;
  name: string;
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  transport: TransportKind;
  models: ModelInfo[];
  defaultModel: string | null;
  accent: "claude" | "antigravity" | "neutral";
  /** Message d'aide si non installé. */
  hint: string | null;
};

export type ModelInfo = { id: string; label: string };

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AutoMode = "off" | "smart" | "full";

export type PromptKind = "confirm" | "choice" | "permission" | "freeText";

export type PromptOption = {
  id: string;
  label: string;
  variant: "primary" | "default" | "danger";
  shortcut: string | null;
};

export type PromptDetail =
  | { type: "diff"; path: string; before: string | null; after: string }
  | { type: "command"; line: string; cwd: string | null }
  | { type: "text"; text: string }
  | { type: "json"; value: unknown };

export type PromptSource =
  | { type: "protocol" }
  | { type: "structured" }
  | { type: "screen"; ruleId: string; confidence: number };

export type InteractivePrompt = {
  promptId: string;
  sessionId: SessionId;
  kind: PromptKind;
  tool: string | null;
  title: string;
  detail: PromptDetail | null;
  options: PromptOption[];
  defaultOption: string | null;
  allowFreeText: boolean;
  risk: RiskLevel;
  source: PromptSource;
  rawExcerpt: string | null;
};

export type ResolvedBy = "user" | "auto" | "policy";

export type ActivityPhase = "thinking" | "responding" | "tool";

export type RateWindow = { id: string; utilization: number; resetsAt: number | null };

export type EngineEvent =
  | { type: "sessionStarted"; sessionId: SessionId; adapter: AdapterId; model: string; transport: TransportKind }
  | { type: "cliSession"; cliSessionId: string }
  | { type: "messageDelta"; messageId: string; text: string }
  | { type: "messageCompleted"; messageId: string }
  | { type: "activity"; phase: ActivityPhase; label: string | null }
  | {
      type: "turnCompleted";
      durationMs: number | null;
      inputTokens: number;
      outputTokens: number;
      thinkingTokens: number;
      cacheTokens: number;
      costUsd: number | null;
      ok: boolean;
    }
  | { type: "rateLimit"; status: string; windows: RateWindow[] }
  | { type: "toolCall"; callId: string; tool: string; input: unknown }
  | { type: "toolResult"; callId: string; ok: boolean; output: string }
  | { type: "prompt"; prompt: InteractivePrompt }
  | { type: "promptResolved"; promptId: string; by: ResolvedBy; optionId: string | null }
  | { type: "promptInvalidated"; promptId: string }
  | { type: "rawOutput"; chunk: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; costUsd: number | null }
  | { type: "error"; code: string; message: string; recoverable: boolean }
  | { type: "sessionEnded"; exitCode: number | null };

export type PromptAnswer = {
  optionId?: string;
  text?: string;
  editedInput?: unknown;
};
