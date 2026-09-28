import { bus } from "@/core/bus/event-bus";
import { invokeCore } from "@/core/ipc";
import { checkArgs, loadActions, type ActionContext, type ActionParam, type ActionResult, type ActionRisk, type ModuleAction } from "./actions";
import type { LoadedModule } from "./types";

/**
 * Base de commandes des modules : tout ce qu'un agent (voix, CLI via le serveur MCP) peut
 * faire dans un module. Elle est construite à partir du code du module, jamais tenue à la main :
 *
 * - les actions de `agent-actions.ts` ;
 * - `open` (afficher le module), que chaque module reçoit ;
 * - les commandes de la palette (`commands` du manifeste) qui font autre chose qu'ouvrir.
 *
 * Elle suit donc les modules : un module créé ou modifié y apparaît tel qu'il est, un module
 * désactivé ou supprimé n'y figure plus. Une copie par module est tenue sur le disque
 * (`<données>/commands/<module>.json`, `syncCommandCatalogs`), retirée avec le module.
 */
export type ModuleCommands = { module: LoadedModule; actions: ModuleAction[] };

/** Commande telle qu'un agent la voit (sans le code qui l'exécute). */
export type CommandInfo = {
  module: string;
  name: string;
  description: string;
  risk: ActionRisk;
  params: Record<string, ActionParam>;
};

/** Base de commandes d'un module, écrite sur le disque. */
export type CommandCatalog = {
  module: { id: string; name: string; description: string; version: string; capabilities: string[] };
  commands: CommandInfo[];
};

/** Commande qui affiche le module ; ses paramètres d'ouverture passent tels quels. */
function openCommand(module: LoadedModule): ModuleAction {
  return {
    name: "open",
    description: `Affiche le module ${module.name}.`,
    params: { params: { type: "object", description: "Paramètres d'ouverture propres au module (facultatif)." } },
    risk: "read",
    run: async (args, ctx) => {
      const params = args.params && typeof args.params === "object" ? (args.params as Record<string, unknown>) : undefined;
      ctx.openModule(module.id, params);
      return { ok: true, message: `${module.name} est affiché.` };
    },
  };
}

const snake = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Commandes de la palette qui agissent (celles qui ouvrent le module sont couvertes par `open`). */
function paletteCommands(module: LoadedModule): ModuleAction[] {
  return (module.commands ?? []).flatMap((command) => {
    const run = command.run;
    if (run === "navigate") return [];
    const local = command.id.startsWith(`${module.id}.`) ? command.id.slice(module.id.length + 1) : command.id;
    return [
      {
        name: `ui_${snake(local)}`,
        description: `${command.title} (commande de la palette).`,
        risk: "write" as const,
        run: async () => {
          await run();
          return { ok: true, message: `${command.title} : fait.` };
        },
      },
    ];
  });
}

/** Ajoute aux actions d'un module ses commandes communes, sans écraser les siennes. */
export function withBuiltins(module: LoadedModule, actions: ModuleAction[]): ModuleAction[] {
  const own = new Set(actions.map((a) => a.name));
  const builtins = [openCommand(module), ...paletteCommands(module)].filter((a) => !own.has(a.name));
  return [...actions, ...builtins];
}

/** Base de commandes des modules actifs : chaque module y figure, même sans `agent-actions.ts`. */
export async function loadCommands(modules: LoadedModule[]): Promise<ModuleCommands[]> {
  const loaded = await loadActions(modules);
  return modules.map((module) => ({
    module,
    actions: withBuiltins(module, loaded.find((entry) => entry.module.id === module.id)?.actions ?? []),
  }));
}

export function commandInfo(module: LoadedModule, action: ModuleAction): CommandInfo {
  return { module: module.id, name: action.name, description: action.description, risk: action.risk, params: action.params ?? {} };
}

export function catalogOf(entry: ModuleCommands): CommandCatalog {
  const { module } = entry;
  return {
    module: {
      id: module.id,
      name: module.name,
      description: module.description,
      version: module.version,
      capabilities: module.capabilities ?? [],
    },
    commands: entry.actions.map((action) => commandInfo(module, action)),
  };
}

/**
 * Lance une commande (arguments vérifiés). Une commande qui modifie quelque chose le signale
 * (`module.data.changed`) : la page du module, si elle est ouverte, relit ses données. La
 * confirmation des commandes destructrices revient à l'appelant.
 */
export async function runCommand(
  module: LoadedModule,
  action: ModuleAction,
  args: Record<string, unknown>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const problem = checkArgs(action, args);
  if (problem) return { ok: false, message: problem };
  const result = await action.run(args, ctx);
  if (result.ok && action.risk !== "read") bus.emit("module.data.changed", { module: module.id, command: action.name });
  return result;
}

// ── Recherche ─────────────────────────────────────────────────────────────────────────

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const STOPWORDS = new Set(
  (
    "le la les l un une des de du d a au aux en dans sur pour par avec et ou ce cet cette ces mon ma mes ton ta tes son sa ses " +
    "notre nos votre vos leur leurs qui que quoi est sont je tu il elle on nous vous ils moi toi se s y " +
    "the an of to in on for with and or my your its is are be this that it me"
  ).split(" "),
);

/** Mots de même sens, en français et en anglais (formes pliées, sans accents). */
const SYNONYMS: string[][] = [
  ["ajouter", "add", "creer", "create", "nouveau", "nouvelle", "new", "inserer", "insert", "faire", "make"],
  ["modifier", "edit", "update", "changer", "change", "renommer", "rename", "mettre", "set", "editer", "corriger", "remplacer"],
  ["supprimer", "delete", "remove", "effacer", "retirer", "enlever", "jeter", "vider", "clear"],
  ["deplacer", "move", "bouger", "glisser", "classer", "ranger", "reordonner", "reorder"],
  ["lister", "list", "voir", "afficher", "show", "montrer", "get", "lire", "read", "consulter", "detail", "details"],
  ["chercher", "search", "find", "trouver", "rechercher"],
  ["ouvrir", "open", "aller", "naviguer", "go"],
  ["carte", "card", "tache", "task", "todo", "item"],
  ["tableau", "board", "kanban"],
  ["colonne", "column", "statut", "status", "etape"],
  ["terminer", "complete", "finir", "fini", "termine", "cocher", "check", "done"],
  ["decocher", "uncheck", "rouvrir", "reopen"],
  ["echeance", "due", "deadline", "date", "jour", "limite"],
  ["etiquette", "label", "tag"],
  ["priorite", "priority", "urgent", "important"],
  ["sous", "subtask", "checklist", "etape"],
  ["description", "note", "texte", "contenu", "content", "body"],
  ["image", "photo", "picture", "illustration", "dessin", "visuel"],
  ["projet", "project", "dossier", "folder", "workspace"],
  ["fichier", "file", "document"],
  ["envoyer", "send", "poster", "publier", "publish"],
  ["generer", "generate", "produire"],
  ["compiler", "build", "construire", "exporter", "export"],
  ["memoire", "memory", "souvenir", "retenir", "remember", "rappeler"],
  ["oublier", "forget"],
  ["theme", "apparence", "couleur", "color", "sombre", "clair", "dark", "light"],
  ["activer", "enable", "allumer", "brancher"],
  ["desactiver", "disable", "eteindre", "couper", "debrancher"],
  ["conversation", "discussion", "chat", "message", "session"],
  ["texture", "skin"],
  ["bloc", "block"],
  ["objet", "item"],
  ["recette", "recipe", "craft"],
  ["mod", "minecraft", "jeu", "game"],
  ["offre", "job", "emploi", "annonce", "poste"],
  ["candidature", "application", "postuler", "apply", "lettre", "letter"],
  ["competence", "skill"],
  ["modele", "model"],
  ["reglage", "setting", "parametre", "option", "preference"],
  ["mise", "jour", "update", "upgrade"],
  ["credit", "usage", "consommation", "quota", "limite"],
  ["tutoriel", "tutorial", "guide", "aide", "help"],
  ["voix", "voice", "vocal", "parler", "speak", "micro"],
  ["verifier", "check", "controler", "tester", "test"],
  ["lancer", "run", "executer", "demarrer", "start", "launch", "jouer", "play"],
  ["arreter", "stop", "annuler", "cancel", "interrompre"],
  ["terminal", "commande", "command", "console", "shell", "npm", "pnpm", "cargo", "script"],
  ["retourner", "flip", "miroir", "inverser", "pivoter", "rotate", "tourner", "rotation"],
  ["recadrer", "crop", "rogner", "redimensionner", "resize", "agrandir", "upscale", "reduire"],
  ["fond", "background", "arriere"],
  ["expliquer", "explain", "comment", "apprendre", "marche", "fonctionne"],
  ["vite", "rapide", "lent", "lentement", "debit", "speed", "vitesse"],
  ["volume", "fort", "bas", "son", "sound"],
];

/** Racine grossière : minuscules sans accents, sans marque du pluriel ni terminaison courante. */
function stem(word: string): string {
  let w = word;
  if (w.length > 4 && /(s|x)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && /(er|ez|ee|es|ent)$/.test(w)) w = w.replace(/(er|ez|ee|es|ent)$/, "");
  else if (w.length > 4 && /e$/.test(w)) w = w.slice(0, -1);
  return w;
}

const SYNONYM_INDEX: Map<string, number[]> = (() => {
  const index = new Map<string, number[]>();
  SYNONYMS.forEach((group, i) => {
    for (const word of group) {
      const key = stem(word);
      index.set(key, [...(index.get(key) ?? []), i]);
    }
  });
  return index;
})();

function words(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function groupsOf(word: string): number[] {
  return SYNONYM_INDEX.get(stem(word)) ?? [];
}

/** Proximité d'un mot de la demande avec un mot de la commande (0 : sans rapport). */
function closeness(wanted: string, candidate: string): number {
  const a = stem(wanted);
  const b = stem(candidate);
  if (a === b) return 3;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return 2;
  const shared = groupsOf(wanted).some((g) => groupsOf(candidate).includes(g));
  return shared ? 2 : 0;
}

export type CommandMatch = { module: LoadedModule; action: ModuleAction; score: number };

/**
 * Cherche des commandes : `module` limite à un module, `query` décrit ce qu'on veut faire
 * (« modifier une carte », « rename board »). Sans requête : les commandes du module (ou de
 * tous), dans leur ordre. Mots rapprochés par racine et par synonymes français et anglais ; le
 * nom de la commande pèse plus que sa description, et le début de la description plus que la fin.
 */
export function searchCommands(
  entries: ModuleCommands[],
  { module, query, limit = 12 }: { module?: string; query?: string; limit?: number },
): CommandMatch[] {
  const scope = module ? entries.filter((e) => e.module.id === module) : entries;
  const all = scope.flatMap((e) => e.actions.map((action) => ({ module: e.module, action, score: 0 })));
  const wanted = words(query ?? "");
  if (wanted.length === 0) return module ? all : all.slice(0, Math.max(limit, 1));

  const scored = all.map((match) => {
    const name = match.action.name.split("_").filter(Boolean);
    // Une description commence par ce que fait la commande : ses premiers mots pèsent plus.
    const text = words(match.action.description);
    const params = words(Object.keys(match.action.params ?? {}).join(" "));
    const home = words(`${match.module.id} ${match.module.name}`);
    let score = 0;
    let hits = 0;
    for (const word of wanted) {
      const best = Math.max(
        ...name.map((n) => closeness(word, n) * 2),
        ...text.map((t, i) => closeness(word, t) * (i < 6 ? 1.25 : 1)),
        ...params.map((p) => closeness(word, p)),
        ...home.map((h) => (closeness(word, h) > 0 ? 1 : 0)),
        0,
      );
      if (best > 0) hits += 1;
      score += best;
    }
    // Toute la demande couverte : devant une commande qui n'en couvre qu'un mot très fort.
    return { ...match, score: score * (hits / wanted.length) };
  });
  return scored
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(limit, 1));
}

// ── Copie sur le disque ───────────────────────────────────────────────────────────────

/**
 * Écrit la base de commandes de chaque module actif (`<données>/commands/<module>.json`) et
 * retire celle des modules désactivés ou supprimés. Hors application (aperçu navigateur) : rien.
 */
export async function syncCommandCatalogs(entries: ModuleCommands[]): Promise<number> {
  try {
    return await invokeCore<number>("commands_sync", { catalogs: entries.map(catalogOf) });
  } catch {
    return 0;
  }
}
