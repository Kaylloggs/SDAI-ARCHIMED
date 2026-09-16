/**
 * Résumé lisible de ce que fait un agent, façon application Claude :
 * « 2 fichiers créés · 1 modifié · 2 commandes exécutées ».
 * Noms d'outils couverts : Claude Code, Antigravity, Codex (inconnus → « action »).
 */

export type ToolCategory = "create" | "edit" | "command" | "read" | "search" | "web" | "task" | "other";

const CATEGORIES: Record<ToolCategory, string[]> = {
  create: ["Write", "write_to_file", "create_file", "NotebookWrite"],
  edit: ["Edit", "MultiEdit", "NotebookEdit", "replace_file_content", "edit_file", "multi_replace_file_content", "patch"],
  command: ["Bash", "PowerShell", "run_command", "run_terminal_cmd", "shell", "BashOutput", "KillShell"],
  read: ["Read", "view_file", "read_file", "NotebookRead", "view_code_item", "list_dir", "LS"],
  search: ["Grep", "Glob", "grep_search", "codebase_search", "find_by_name", "file_search"],
  web: ["WebFetch", "WebSearch", "search_web", "read_url_content", "browser_get_dom"],
  task: ["Task", "TodoWrite", "Agent"],
  other: [],
};

const LOOKUP = new Map<string, ToolCategory>(
  (Object.entries(CATEGORIES) as Array<[ToolCategory, string[]]>).flatMap(([category, tools]) =>
    tools.map((tool) => [tool.toLowerCase(), category] as const),
  ),
);

export function categorize(tool: string): ToolCategory {
  const exact = LOOKUP.get(tool.toLowerCase());
  if (exact) return exact;
  if (tool.startsWith("browser_")) return "web";
  if (tool.startsWith("mcp__")) return "other";
  return "other";
}

const LABELS: Record<ToolCategory, (n: number) => string> = {
  create: (n) => `${n} fichier${n > 1 ? "s" : ""} créé${n > 1 ? "s" : ""}`,
  edit: (n) => `${n} fichier${n > 1 ? "s" : ""} modifié${n > 1 ? "s" : ""}`,
  command: (n) => `${n} commande${n > 1 ? "s" : ""} exécutée${n > 1 ? "s" : ""}`,
  read: (n) => `${n} lecture${n > 1 ? "s" : ""}`,
  search: (n) => `${n} recherche${n > 1 ? "s" : ""}`,
  web: (n) => `${n} page${n > 1 ? "s" : ""} web`,
  task: (n) => `${n} étape${n > 1 ? "s" : ""} planifiée${n > 1 ? "s" : ""}`,
  other: (n) => `${n} action${n > 1 ? "s" : ""}`,
};

const ORDER: ToolCategory[] = ["create", "edit", "command", "read", "search", "web", "task", "other"];

export function summarizeTools(tools: Array<{ tool: string; ok?: boolean }>): string {
  const counts = new Map<ToolCategory, number>();
  for (const { tool } of tools) {
    const category = categorize(tool);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const parts = ORDER.filter((c) => counts.has(c)).map((c) => LABELS[c](counts.get(c)!));
  const failed = tools.filter((t) => t.ok === false).length;
  if (failed > 0) parts.push(`${failed} en échec`);
  return parts.join(" · ");
}

/** Libellé de l'action en cours pour l'indicateur « en direct ». */
export function liveLabel(phase: "thinking" | "responding" | "tool", label: string | null): string {
  if (phase === "thinking") return "Réflexion";
  if (phase === "responding") return "Rédaction de la réponse";
  if (!label) return "Action en cours";
  const [tool, ...rest] = label.split(" · ");
  const detail = rest.join(" · ");
  const name = detail.split(/[\\/]/).filter(Boolean).at(-1) ?? detail;
  switch (categorize(tool ?? "")) {
    case "create":
      return name ? `Création de ${name}` : "Création d'un fichier";
    case "edit":
      return name ? `Modification de ${name}` : "Modification d'un fichier";
    case "command":
      return detail ? `Exécution de ${detail.length > 48 ? `${detail.slice(0, 47)}…` : detail}` : "Exécution d'une commande";
    case "read":
      return name ? `Lecture de ${name}` : "Lecture";
    case "search":
      return "Recherche dans le projet";
    case "web":
      return "Consultation du web";
    case "task":
      return "Planification";
    default:
      return tool ? `Utilise ${tool}` : "Action en cours";
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${String(Math.round(seconds % 60)).padStart(2, "0")} s`;
}

export function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 1_000_000) return `${(count / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k`;
  return `${(count / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} M`;
}
