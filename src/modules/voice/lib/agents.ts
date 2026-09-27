const AGENT_NAMES: Record<string, string> = { claude: "Claude Code", antigravity: "Antigravity", codex: "Codex" };

/** Nom lisible d'une CLI d'IA (« claude » → « Claude Code »). */
export const agentName = (adapter: string) => AGENT_NAMES[adapter] ?? adapter;
