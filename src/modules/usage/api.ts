import { invokeModule } from "@/core/ipc";

export type RateWindow = { id: string; utilization: number; resetsAt: number | null };
export type AdapterLimits = { status: string; windows: RateWindow[]; observedAt: number };

export type Totals = {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheTokens: number;
  costUsd: number;
  durationMs: number;
};

export type TurnRecord = {
  at: number;
  adapter: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheTokens: number;
  costUsd: number | null;
  durationMs: number | null;
};

export type UsageSummary = {
  since: number;
  byAdapter: Record<string, Totals>;
  byDay: Array<{ day: string; totals: Totals }>;
  recent: TurnRecord[];
  limits: Record<string, AdapterLimits>;
};

export type ClaudeAccount = {
  loggedIn?: boolean;
  authMethod?: string;
  subscriptionType?: string;
  email?: string;
};

export const usageApi = {
  summary: (days: number) => invokeModule<UsageSummary>("usage", "summary", { days }),
  claudeAccount: () => invokeModule<ClaudeAccount>("usage", "claude_account"),
  refreshClaudeLimits: () => invokeModule<AdapterLimits>("usage", "refresh_claude_limits"),
};
