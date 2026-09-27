import type { ChatSession } from "@/core/engine/session.store";
import { summarizeTools } from "./activity";

/** Conversation → Markdown (copier, partager). Les actions de l'agent sont résumées. */
export function conversationMarkdown(session: Pick<ChatSession, "title" | "adapter" | "model" | "cwd" | "timeline">, agentName: string): string {
  const lines = [`# ${session.title}`, "", `- Agent : ${agentName}${session.model ? ` (${session.model})` : ""}`];
  if (session.cwd) lines.push(`- Dossier : ${session.cwd}`);
  lines.push("");
  let tools: Array<{ tool: string; ok?: boolean }> = [];
  const flush = () => {
    if (tools.length > 0) lines.push(`> ${summarizeTools(tools)}`, "");
    tools = [];
  };
  for (const item of session.timeline) {
    if (item.kind === "tool") {
      tools.push({ tool: item.tool, ok: item.ok });
      continue;
    }
    if (item.kind === "user") {
      flush();
      lines.push("## Vous", "", item.text.trim(), "");
    } else if (item.kind === "assistant" && item.text.trim()) {
      flush();
      lines.push(`## ${agentName}`, "", item.text.trim(), "");
    } else if (item.kind === "error") {
      flush();
      lines.push(`> Erreur : ${item.message}`, "");
    }
  }
  flush();
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Jauge de contexte : pourcentage utilisé (0–100), ou `null` sans fenêtre connue. */
export function contextPercent(context: { used: number; window: number | null } | undefined): number | null {
  if (!context?.window) return null;
  return Math.min(100, Math.round((context.used / context.window) * 100));
}
