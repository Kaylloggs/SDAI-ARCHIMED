import type { LogLevel } from "@/core/ipc/bindings/LogLevel";

export type LevelFilter = "all" | LogLevel;

/** Filtre « Avertissements » : les erreurs restent visibles, elles sont plus graves. */
export function visibleAt(level: LogLevel, filter: LevelFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "error":
      return level === "error";
    case "warning":
      return level === "error" || level === "warning";
    default:
      return level === filter;
  }
}

/** Même classement que le backend (`gradle.rs`), pour relire un journal archivé. */
export function levelOf(text: string): LogLevel {
  const lower = text.toLowerCase();
  if (text.includes("FAILED") || lower.includes("error:") || text.includes("ERROR") || text.startsWith("FAILURE") || text.startsWith("e: ")) {
    return "error";
  }
  if (lower.includes("warning:") || text.includes("WARN") || text.startsWith("w: ") || text.includes("deprecat")) {
    return "warning";
  }
  if (text.includes("DEBUG")) return "debug";
  return "info";
}
