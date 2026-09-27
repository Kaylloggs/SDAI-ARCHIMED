import type { AppContextSnapshot, ModuleContext } from "@/core/context";

const LANGUAGE_NAMES: Record<string, string> = { fr: "français", en: "English", es: "español", de: "Deutsch", it: "italiano" };

export function languageName(tag: string): string {
  return LANGUAGE_NAMES[tag.split("-")[0]!.toLowerCase()] ?? tag;
}

/**
 * Consignes de l'agent vocal (ajoutées au prompt système de la CLI). Il parle, agit avec les
 * outils d'ARCHIMED et ne prétend jamais avoir fait ce qu'aucun outil n'a confirmé.
 */
export function cliSystemPrompt(language: string): string {
  const lang = languageName(language);
  return [
    `Tu es la voix d'ARCHIMED, une application de bureau. La personne te parle à voix haute ; ta réponse est lue par une synthèse vocale. Réponds en ${lang}.`,
    "À l'oral : phrases courtes et naturelles, deux ou trois au plus sauf demande contraire. Jamais de Markdown, de tableau, de liste à puces, d'emoji ni d'adresse web. Ne lis jamais de code : dis où il se trouve.",
    "Tu agis dans l'application avec les outils mcp__archimed__* : get_context (ce que la personne regarde : module, projet, fichier, sélection), list_modules puis run_action (actions des modules : créer une image, une carte, compiler un mod…), open_module (afficher un module), start_task (confier un long travail de code à un agent dans le Chat) et task_status, speak (annonce brève pendant un travail long).",
    "Pour « lui », « ça », « cette image » : appelle d'abord get_context. Pour une demande en plusieurs étapes, annonce en une phrase ce que tu vas faire (speak), puis enchaîne les outils.",
    "Tu peux aussi lire, créer et modifier des fichiers et lancer des commandes dans le dossier de travail, avec tes outils habituels.",
    "Règle absolue : ne dis jamais qu'une chose est faite, créée, compilée ou envoyée si l'outil ne l'a pas confirmé. Si aucun outil ne permet de le faire, dis-le simplement et propose une autre voie.",
  ].join("\n");
}

/**
 * Consignes du modèle local (Ollama) : assistant rapide qui répond aux questions simples et
 * délègue le reste.
 */
export function localSystemPrompt(language: string, modules: string[]): string {
  const lang = languageName(language);
  return [
    `Tu es la voix d'ARCHIMED, en ${lang}. Réponses orales très courtes (une ou deux phrases), sans Markdown ni emoji.`,
    `Modules de l'application : ${modules.join(", ")}.`,
    "Tu réponds toi-même aux questions simples et à la conversation.",
    "Si la demande demande d'agir (créer, modifier, coder, générer une image, compiler, chercher dans un projet…), réponds uniquement par une ligne : DELEGUER: suivie de la consigne complète et autonome à transmettre à un agent plus puissant.",
  ].join("\n");
}

function describeModule(id: string, ctx: ModuleContext): string {
  const parts: string[] = [];
  if (ctx.project) parts.push(`projet « ${ctx.project.name} »${ctx.project.path ? ` (${ctx.project.path})` : ""}`);
  if (ctx.file) parts.push(`fichier ${ctx.file}`);
  if (ctx.object) parts.push(`${ctx.object.type} sélectionné : ${ctx.object.name}`);
  if (ctx.image?.path || ctx.image?.description) parts.push(`image : ${ctx.image.description ?? ctx.image.path}`);
  if (ctx.selection) parts.push(`sélection : « ${ctx.selection.slice(0, 200)} »`);
  if (ctx.task) parts.push(`tâche : ${ctx.task}`);
  for (const [key, value] of Object.entries(ctx.details ?? {})) {
    if (value !== null && value !== "") parts.push(`${key} : ${value}`);
  }
  return `${id} — ${parts.join(" ; ") || "rien de sélectionné"}`;
}

/** Contexte ajouté devant chaque phrase envoyée à l'agent (court, lisible). */
export function contextPreamble(snapshot: AppContextSnapshot, moduleNames: Record<string, string>): string {
  const active = snapshot.activeModule;
  const lines = [`Module affiché : ${moduleNames[active] ?? active}.`];
  const activeCtx = snapshot.modules[active];
  if (activeCtx) lines.push(`Contexte : ${describeModule(active, activeCtx)}.`);
  const others = Object.entries(snapshot.modules).filter(([id]) => id !== active).slice(0, 3);
  for (const [id, ctx] of others) lines.push(`Aussi ouvert : ${describeModule(id, ctx)}.`);
  return `[ARCHIMED] ${lines.join(" ")}`;
}

/** Réponse du modèle local qui demande une délégation ; renvoie la consigne. */
export function delegation(answer: string): string | null {
  const match = /^\s*D[EÉ]L[EÉ]GUER\s*:\s*([\s\S]+)$/i.exec(answer.trim());
  return match ? match[1]!.trim() : null;
}
