import type { JournalEntry } from "../api";

/** Résumé d'un tour tel qu'émis sur le bus (`engine.turn.completed`). */
export type TurnSummary = {
  conversationId: string;
  origin: "chat" | "code";
  title: string;
  adapter: string;
  cwd: string | null;
  request: string;
  answer: string;
  tools: Array<{ tool: string; input: unknown; ok?: boolean }>;
};

const FILE_KEYS = ["file_path", "path", "notebook_path", "TargetFile", "AbsolutePath"];
const COMMAND_KEYS = ["command", "CommandLine", "cmd"];
const EDIT_TOOL = /write|edit|replace|create|notebook/i;
const SHELL_TOOL = /bash|powershell|command|shell|terminal|exec/i;

/** Préfixe des lignes que l'IA écrit pour enrichir la mémoire (consigne du bloc injecté). */
export const MEMORY_LINE = /^\s*(?:[-*]\s*)?📌\s*M[ée]moire\s*:\s*(.+)$/gimu;

function stringField(input: unknown, keys: string[]): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Lignes « 📌 Mémoire : … » d'une réponse. */
export function memoryLines(answer: string): string[] {
  return [...answer.matchAll(MEMORY_LINE)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((line) => line.length > 0);
}

/** Entrée de journal : demande, résultat, fichiers modifiés et commandes réussis. */
export function journalEntry(turn: TurnSummary, now: Date = new Date()): JournalEntry {
  const files = new Set<string>();
  const commands = new Set<string>();
  for (const call of turn.tools) {
    if (call.ok === false) continue;
    const command = SHELL_TOOL.test(call.tool) ? stringField(call.input, COMMAND_KEYS) : null;
    if (command) commands.add(command);
    const file = EDIT_TOOL.test(call.tool) ? stringField(call.input, FILE_KEYS) : null;
    if (file) files.add(file);
  }

  const outcome = turn.answer.replace(MEMORY_LINE, "").replace(/\n{3,}/g, "\n\n").trim();
  return {
    at: Math.floor(now.getTime() / 1000),
    conversationId: turn.conversationId,
    origin: turn.origin,
    adapter: turn.adapter,
    project: turn.cwd,
    title: turn.title,
    request: turn.request.trim(),
    outcome,
    files: [...files],
    commands: [...commands],
  };
}
