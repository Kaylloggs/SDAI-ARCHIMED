import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Blocks, Compass } from "lucide-react";
import { allModules } from "@/core/modules";
import { isModuleEnabled, useModulesStore } from "@/core/stores/modules.store";
import { useUiStore } from "@/core/stores/ui.store";
import { pageFade } from "@/design-system/motion";
import { Stage } from "./components/Stage";
import { TopicList } from "./components/TopicList";
import createModule from "./content/create-module";
import start from "./content/start";
import { buildGroups, nextTopic, resolveTopic, searchGroups, type Topic } from "./lib/topics";
import { CREATE_MODULE_TOPIC, START_TOPIC, useTutorialStore } from "./store";

const SELF = "tutorial";

const GUIDES: { start: Topic; createModule: Topic } = {
  start: { id: START_TOPIC, title: "Premiers pas", icon: Compass, tutorial: start, enabled: true },
  createModule: {
    id: CREATE_MODULE_TOPIC,
    title: "Créer un module",
    icon: Blocks,
    tutorial: createModule,
    enabled: true,
  },
};

/** Élément où la saisie a priorité sur les flèches (champ de recherche…). */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

/**
 * Tutoriel : la visite de l'application, le tutoriel de chaque module (lu dans son manifest)
 * et la création d'un module. Tout nouveau module y apparaît avec son `tutorial.ts`.
 */
export default function TutorialModule() {
  const { topic: selected, steps, done, select, setStep, finish, restart } = useTutorialStore();
  const removed = useModulesStore((s) => s.removed);
  const overrides = useModulesStore((s) => s.overrides);
  const params = useUiStore((s) => s.moduleParams[SELF]);
  const clearModuleParams = useUiStore((s) => s.clearModuleParams);
  const navigate = useUiStore((s) => s.navigate);
  const [query, setQuery] = useState("");
  const [finishedView, setFinishedView] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);

  const groups = useMemo(
    () =>
      buildGroups(
        allModules,
        { selfId: SELF, removed, isEnabled: (m) => isModuleEnabled(overrides, m) },
        GUIDES,
      ),
    [removed, overrides],
  );
  const shown = useMemo(() => searchGroups(groups, query), [groups, query]);
  const topics = groups.flatMap((g) => g.topics);
  const topic = topics.find((t) => t.id === selected) ?? GUIDES.start;
  const count = topic.tutorial?.steps.length ?? 0;
  const step = Math.min(steps[topic.id] ?? 0, Math.max(count - 1, 0));
  const withTutorial = topics.filter((t) => t.tutorial);
  const finished = withTutorial.filter((t) => done[t.id]).length;

  const open = useCallback(
    (id: string) => {
      select(id);
      setFinishedView(false);
      setDirection(1);
    },
    [select],
  );

  const goTo = useCallback(
    (target: number) => {
      if (target < 0 || target >= count) return;
      setDirection(target >= step ? 1 : -1);
      setStep(topic.id, target);
    },
    [count, step, setStep, topic.id],
  );

  const complete = useCallback(() => {
    finish(topic.id);
    setFinishedView(true);
  }, [finish, topic.id]);

  // Ouverture demandée par le service `tutorial.open` (bouton d'aide de la barre de titre).
  useEffect(() => {
    const wanted = params?.topic;
    if (typeof wanted !== "string") return;
    open(resolveTopic(groups, wanted, START_TOPIC));
    clearModuleParams(SELF);
  }, [params, groups, open, clearModuleParams]);

  // ← → changent d'étape partout dans le module, sauf pendant une saisie.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return;
      if (finishedView || !topic.tutorial) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (step === count - 1) complete();
        else goTo(step + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(step - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishedView, topic.tutorial, step, count, goTo, complete]);

  return (
    <div className="flex h-full min-h-0">
      <TopicList
        groups={shown}
        active={topic.id}
        done={done}
        total={withTutorial.length}
        finished={finished}
        query={query}
        onQuery={setQuery}
        onSelect={open}
      />
      <main className="min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={topic.id} variants={pageFade} initial="hidden" animate="visible" exit="exit" className="h-full">
            <Stage
              topic={topic}
              step={step}
              direction={direction}
              finished={finishedView}
              next={nextTopic(groups, topic.id)}
              onStep={goTo}
              onFinish={complete}
              onRestart={() => {
                restart(topic.id);
                setDirection(-1);
                setFinishedView(false);
              }}
              onSelect={open}
              onOpenModule={navigate}
              onOpenSettings={() => navigate("settings")}
            />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
