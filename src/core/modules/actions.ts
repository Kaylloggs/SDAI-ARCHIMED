import type { LoadedModule } from "./types";

/**
 * Actions d'un module : ce qu'un agent (voix, Chat, agent externe via MCP) peut lui demander
 * de faire. Chaque module déclare les siennes dans `agent-actions.ts` (chargé à la demande) ; le
 * core ne connaît aucun module, il les découvre par le manifeste.
 *
 * Le niveau de risque décide de la confirmation : `destructive` (supprimer, envoyer, payer)
 * n'est jamais exécuté sans l'accord de la personne, qu'elle parle ou qu'elle clique.
 */
export type ActionRisk = "read" | "write" | "destructive";

export type ActionParam = {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  enum?: string[];
  required?: boolean;
};

/** Commandes des conversations d'agents (voir `useChat`), fournies par l'appelant. */
export type ChatControls = Pick<
  ReturnType<typeof import("@/core/engine/useChat").useChat>,
  "createSession" | "setActive" | "patch" | "send" | "answer" | "stop" | "remove" | "enqueue" | "setPlanMode" | "setAutoMode" | "setModel" | "setAdapter" | "setCwd"
>;

/** Contexte courant de l'application (voir `@/core/context`). */
export type ActionContext = {
  /** Module affiché, projet, fichier, sélection… */
  context: import("@/core/context").AppContextSnapshot;
  /** Affiche un module (la conversation vocale continue). */
  openModule: (moduleId: string, params?: Record<string, unknown>) => void;
  /** Conversations d'agents (envoyer, arrêter, changer de modèle…), si l'appelant les a. */
  chat?: ChatControls;
};

export type ActionResult = {
  ok: boolean;
  /** Phrase courte, lisible et prononçable : « Tableau Roadmap créé avec 4 cartes. » */
  message: string;
  /** Données utiles à l'agent (identifiants, chemins, compteurs). */
  data?: Record<string, unknown>;
  /** Module à afficher pour voir le résultat. */
  open?: { module: string; params?: Record<string, unknown> };
};

export type ModuleAction = {
  /** `snake_case`, unique dans le module. */
  name: string;
  /** Ce que fait l'action, pour l'agent et pour la personne (une phrase). */
  description: string;
  params?: Record<string, ActionParam>;
  risk: ActionRisk;
  /** Phrase de confirmation (actions destructives) : « Supprimer le tableau Roadmap ? » */
  confirm?: (args: Record<string, unknown>) => string;
  run: (args: Record<string, unknown>, ctx: ActionContext) => Promise<ActionResult>;
};

/** Déclare les actions d'un module (fichier `agent-actions.ts`, export par défaut). */
export function defineActions(actions: ModuleAction[]): ModuleAction[] {
  return actions;
}

export type ModuleActions = { module: LoadedModule; actions: ModuleAction[] };

/** Charge les actions des modules actifs ; un module dont le chargement échoue est ignoré. */
export async function loadActions(modules: LoadedModule[]): Promise<ModuleActions[]> {
  const loaded = await Promise.all(
    modules
      .filter((m) => m.actions)
      .map(async (module) => {
        try {
          const exported = await module.actions!();
          return { module, actions: Array.isArray(exported.default) ? exported.default : [] };
        } catch (error) {
          console.error(`[actions] ${module.id} :`, error);
          return { module, actions: [] };
        }
      }),
  );
  return loaded.filter((entry) => entry.actions.length > 0);
}

/** Vérifie les arguments d'un appel ; renvoie le problème en clair, ou `null`. */
export function checkArgs(action: ModuleAction, args: Record<string, unknown>): string | null {
  for (const [name, param] of Object.entries(action.params ?? {})) {
    const value = args[name];
    if (value === undefined || value === null || value === "") {
      if (param.required) return `Paramètre manquant : ${name}.`;
      continue;
    }
    const type = Array.isArray(value) ? "array" : typeof value;
    if (type !== param.type) return `Paramètre ${name} : ${param.type} attendu.`;
    if (param.enum && !param.enum.includes(String(value))) {
      return `Paramètre ${name} : ${param.enum.join(", ")} attendu.`;
    }
  }
  return null;
}

/** Description compacte d'un module pour un agent (outil `list_modules`). */
export function describeModule(entry: { module: LoadedModule; actions: ModuleAction[] }) {
  return {
    id: entry.module.id,
    name: entry.module.name,
    description: entry.module.description,
    capabilities: entry.module.capabilities ?? [],
    actions: entry.actions.map((a) => ({
      name: a.name,
      description: a.description,
      risk: a.risk,
      params: a.params ?? {},
    })),
  };
}

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Retrouve un élément désigné à la voix ou par un agent : identifiant exact, puis nom exact,
 * puis nom qui commence ou contient la demande (accents et casse ignorés). `null` si la
 * demande désigne plusieurs éléments à égalité : l'agent doit préciser.
 */
export function findByName<T>(items: T[], ref: string, name: (item: T) => string, id?: (item: T) => string): T | null {
  const wanted = fold(ref);
  if (!wanted) return null;
  if (id) {
    const exact = items.find((item) => id(item) === ref);
    if (exact) return exact;
  }
  for (const test of [(n: string) => n === wanted, (n: string) => n.startsWith(wanted), (n: string) => n.includes(wanted)]) {
    const found = items.filter((item) => test(fold(name(item))));
    if (found.length === 1) return found[0]!;
    if (found.length > 1) return null;
  }
  return null;
}
