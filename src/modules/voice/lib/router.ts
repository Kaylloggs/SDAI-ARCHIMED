/**
 * Routeur local : reconnaît en quelques microsecondes les commandes courantes (arrêter,
 * répéter, ouvrir un module, changer d'agent…) sans appeler de modèle. Tout le reste
 * part vers l'agent. Français et anglais.
 */
export type Intent =
  | { type: "stop" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "cancel" }
  | { type: "repeat" }
  | { type: "speed"; delta: number }
  | { type: "volume"; delta: number }
  | { type: "open"; module: string }
  | { type: "agent"; adapter: string }
  | { type: "brain"; brain: "local" | "cli" }
  | { type: "localMode"; on: boolean }
  | { type: "status" }
  | { type: "time" }
  | { type: "endSession" }
  | { type: "confirm"; answer: "yes" | "always" | "no" }
  | { type: "ask"; text: string };

export type ModuleRef = { id: string; name: string };

/** Minuscules, sans accents ni ponctuation ; « vas-y » → « vas y ». */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const POLITE = /^(s'il te plait|s'il vous plait|stp|svp|please|hey|ok|bon|alors|euh)\s+/;
const TAIL = /\s+(s'il te plait|s'il vous plait|stp|svp|please|merci)$/;

function strip(text: string): string {
  let out = normalize(text);
  for (let i = 0; i < 2; i += 1) out = out.replace(POLITE, "").replace(TAIL, "");
  return out;
}

const exact = (value: string, list: string[]) => list.includes(value);

/** Réponse à une confirmation en attente (« oui », « oui toujours », « non »). */
export function parseConfirmation(text: string): "yes" | "always" | "no" | null {
  const t = strip(text);
  if (!t) return null;
  if (/\b(toujours|always|pour ce projet)\b/.test(t) && /^(oui|yes|ok|d'accord|vas y|confirme)/.test(t)) return "always";
  if (/^(non|no|nope|annule|surtout pas|pas du tout|arrete|stop|cancel|refuse)\b/.test(t)) return "no";
  if (/^(oui|yes|yep|ouais|ok|okay|d'accord|dac|vas y|go|confirme|je confirme|c'est bon|parfait|valide|fais le|allez)\b/.test(t)) {
    return "yes";
  }
  return null;
}

/** Trouve le module nommé dans la phrase (« ouvre image maker » → image-maker). */
export function matchModule(fragment: string, modules: ModuleRef[]): string | null {
  const wanted = normalize(fragment).replace(/^(le |la |les |l'|mon |ma |the )/, "").replace(/^module /, "").trim();
  if (!wanted) return null;
  const aliases: Record<string, string[]> = {
    code: ["code", "editeur", "editor"],
    chat: ["chat", "discussion", "conversation"],
    "image-maker": ["image maker", "images", "image", "generateur d'images"],
    mcstudio: ["mod studio", "minecraft", "mod maker", "minecraft mod maker"],
    planner: ["planner", "planning", "tableaux", "roadmap", "taches"],
    jobagent: ["job agent", "emploi", "candidatures", "offres"],
    memory: ["memoire", "memory"],
    skills: ["skills", "competences"],
    usage: ["credits", "usage", "consommation"],
    settings: ["reglages", "parametres", "settings"],
    tutorial: ["tutoriel", "tutorial", "aide"],
    home: ["accueil", "home"],
    voice: ["voice", "voix"],
  };
  let best: { id: string; score: number } | null = null;
  for (const module of modules) {
    const names = [normalize(module.name), normalize(module.id).replace(/-/g, " "), ...(aliases[module.id] ?? [])];
    for (const name of names) {
      const score = wanted === name ? 3 : wanted.startsWith(name) || name.startsWith(wanted) ? 2 : wanted.includes(name) ? 1 : 0;
      if (score > 0 && (!best || score > best.score)) best = { id: module.id, score };
    }
  }
  return best?.id ?? null;
}

const AGENTS: Array<[RegExp, string]> = [
  [/\b(claude|cloud code|claude code)\b/, "claude"],
  [/\b(antigravity|gemini)\b/, "antigravity"],
  [/\b(codex|openai codex|chatgpt)\b/, "codex"],
];

export function route(text: string, modules: ModuleRef[] = []): Intent {
  const t = strip(text);
  if (!t) return { type: "ask", text };

  if (exact(t, ["stop", "arrete", "arrete toi", "tais toi", "silence", "chut", "stoppe", "ca suffit", "shut up", "be quiet", "enough"])) {
    return { type: "stop" };
  }
  if (exact(t, ["attends", "attend", "pause", "mets en pause", "une seconde", "hold on", "wait"])) return { type: "pause" };
  if (exact(t, ["continue", "reprends", "vas y continue", "poursuis", "go on", "resume", "keep going"])) return { type: "resume" };
  if (exact(t, ["annule", "annule ca", "laisse tomber", "oublie", "cancel", "never mind", "arrete la tache", "arrete tout"])) {
    return { type: "cancel" };
  }
  if (exact(t, ["repete", "tu peux repeter", "peux tu repeter", "redis le", "quoi", "pardon", "comment", "repeat", "say again", "come again"])) {
    return { type: "repeat" };
  }
  if (/^(parle )?(plus lentement|moins vite|ralentis|slower|slow down)$/.test(t)) return { type: "speed", delta: -0.15 };
  if (/^(parle )?(plus vite|plus rapidement|accelere|faster|speed up)$/.test(t)) return { type: "speed", delta: 0.15 };
  if (/^(parle )?(plus fort|monte le son|louder)$/.test(t)) return { type: "volume", delta: 0.15 };
  if (/^(parle )?(moins fort|baisse le son|quieter|softer)$/.test(t)) return { type: "volume", delta: -0.15 };
  if (/^(qu'est ce que tu fais|que fais tu|tu fais quoi|ou en es tu|ou en est la tache|what are you doing|status)$/.test(t)) {
    return { type: "status" };
  }
  if (/^(quelle heure est il|il est quelle heure|what time is it)$/.test(t)) return { type: "time" };
  if (/^(termine la session|fin de la session|on arrete la|au revoir|bye|goodbye|end session)$/.test(t)) {
    return { type: "endSession" };
  }
  if (/^(travaille |passe )?(en )?mode local$|^work locally$/.test(t)) return { type: "localMode", on: true };
  if (/^(utilise|passe sur|prends) (le )?modele local$|^use (the )?local model$/.test(t)) return { type: "brain", brain: "local" };

  const use = /^(utilise|passe sur|prends|use|switch to) (.+)$/.exec(t);
  if (use) {
    for (const [pattern, adapter] of AGENTS) if (pattern.test(use[2]!)) return { type: "agent", adapter };
  }

  const open = /^(ouvre|affiche|montre moi|va dans|va sur|lance|open|show|go to) (.+)$/.exec(t);
  if (open) {
    const module = matchModule(open[2]!, modules);
    if (module) return { type: "open", module };
  }

  return { type: "ask", text: text.trim() };
}
