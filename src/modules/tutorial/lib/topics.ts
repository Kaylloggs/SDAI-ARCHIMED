import type { LucideIcon } from "lucide-react";
import type { LoadedModule, ModuleTutorial } from "@/core/modules";

/** Un tutoriel de la liste : la visite, un module, ou la création d'un module. */
export type Topic = {
  id: string;
  title: string;
  icon: LucideIcon;
  /** `null` : module sans tutoriel (module personnel, par exemple). */
  tutorial: ModuleTutorial | null;
  /** Module à ouvrir depuis le tutoriel. */
  moduleId?: string;
  /** Faux si le module est désactivé (son tutoriel reste lisible). */
  enabled: boolean;
};

export type TopicGroup = { id: "start" | "modules" | "more"; label: string; topics: Topic[] };

type Guides = { start: Topic; createModule: Topic };

/**
 * Groupes de la liste :
 * - « Bien démarrer » : la visite, puis les modules du socle qui ont un tutoriel (Réglages) ;
 * - « Modules » : chaque module installé, désactivé compris ;
 * - « Aller plus loin » : créer un module.
 * Les modules supprimés n'apparaissent pas ; le module Tutoriel ne se liste pas lui-même.
 */
export function buildGroups(
  modules: readonly LoadedModule[],
  options: { selfId: string; removed: readonly string[]; isEnabled: (module: LoadedModule) => boolean },
  guides: Guides,
): TopicGroup[] {
  const visible = modules.filter((m) => m.id !== options.selfId && !options.removed.includes(m.id));
  const asTopic = (m: LoadedModule): Topic => ({
    id: m.id,
    title: m.name,
    icon: m.icon,
    tutorial: m.tutorial ?? null,
    moduleId: m.id,
    enabled: options.isEnabled(m),
  });
  const groups: TopicGroup[] = [
    {
      id: "start",
      label: "Bien démarrer",
      topics: [guides.start, ...visible.filter((m) => m.required && m.tutorial).map(asTopic)],
    },
    { id: "modules", label: "Modules", topics: visible.filter((m) => !m.required).map(asTopic) },
    { id: "more", label: "Aller plus loin", topics: [guides.createModule] },
  ];
  return groups.filter((g) => g.topics.length > 0);
}

/** Minuscules sans accents : « Échéance » trouve « echeance ». */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function haystack(topic: Topic): string {
  const t = topic.tutorial;
  const parts = [topic.title];
  if (t) {
    parts.push(t.summary, ...(t.tips ?? []));
    for (const step of t.steps) parts.push(step.title, step.text);
  }
  return normalize(parts.join(" "));
}

/** Tutoriels dont le titre, le résumé, une étape ou une astuce contient tous les mots cherchés. */
export function searchGroups(groups: readonly TopicGroup[], query: string): TopicGroup[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...groups];
  return groups
    .map((g) => ({ ...g, topics: g.topics.filter((t) => words.every((w) => haystack(t).includes(w))) }))
    .filter((g) => g.topics.length > 0);
}

/** Sujet demandé de l'extérieur (service `tutorial.open`) : un module sans tutoriel mène à la visite. */
export function resolveTopic(groups: readonly TopicGroup[], wanted: string, fallback: string): string {
  const topic = groups.flatMap((g) => g.topics).find((t) => t.id === wanted);
  return topic?.tutorial ? topic.id : fallback;
}

/** Tutoriel suivant dans la liste, pour enchaîner après « Terminer ». */
export function nextTopic(groups: readonly TopicGroup[], current: string): Topic | undefined {
  const all = groups.flatMap((g) => g.topics).filter((t) => t.tutorial);
  const index = all.findIndex((t) => t.id === current);
  return index >= 0 ? all[index + 1] : undefined;
}
