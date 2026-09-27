/**
 * Commandes « / » de la zone de saisie : celles d'ARCHIMED (exécutées ici) et celles de la
 * CLI (intégrées, du projet, skills), envoyées telles quelles à l'agent.
 */

export type SlashCommand = {
  name: string;
  description: string;
  /** `app` : exécutée par ARCHIMED ; `cli` : texte envoyé à l'agent. */
  kind: "app" | "cli";
};

export const APP_COMMANDS: SlashCommand[] = [
  { name: "nouveau", description: "Nouvelle conversation dans le même dossier", kind: "app" },
  { name: "plan", description: "Mode plan : l'agent propose un plan avant de modifier quoi que ce soit", kind: "app" },
  { name: "modifications", description: "Voir les fichiers modifiés et leurs différences", kind: "app" },
  { name: "copier", description: "Copier toute la conversation en Markdown", kind: "app" },
  { name: "renommer", description: "Renommer la conversation", kind: "app" },
];

/** Descriptions des commandes courantes de Claude Code (les autres : « Commande de la CLI »). */
const KNOWN: Record<string, string> = {
  compact: "Résumer la conversation pour libérer du contexte",
  context: "Voir ce qui occupe le contexte",
  cost: "Coût et durée de la session",
  init: "Créer un CLAUDE.md décrivant le projet",
  review: "Relire les modifications en cours",
  "security-review": "Chercher les failles de sécurité des modifications",
  "pr-comments": "Récupérer les commentaires d'une pull request",
  todos: "Voir la liste des tâches",
  memory: "Modifier la mémoire du projet",
  agents: "Gérer les sous-agents",
  mcp: "État des serveurs MCP",
  help: "Aide de la CLI",
  "release-notes": "Nouveautés de la CLI",
};

export function cliCommands(names: string[]): SlashCommand[] {
  const seen = new Set(APP_COMMANDS.map((c) => c.name));
  const commands: SlashCommand[] = [];
  for (const raw of names) {
    const name = raw.replace(/^\//, "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    commands.push({ name, description: KNOWN[name] ?? "Commande de la CLI", kind: "cli" });
  }
  return commands;
}

/** `/pla` au début du message, sans espace : la requête du menu ; sinon `null`. */
export function slashQuery(text: string): string | null {
  const match = /^\/([\w:.-]*)$/.exec(text);
  return match ? match[1]!.toLowerCase() : null;
}

export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase();
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q));
  const contains = commands.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, 12);
}
