import { useCallback, useEffect, useState } from "react";
import { useBusEvent } from "@/core/bus/event-bus";
import { useModuleContext } from "@/core/context";
import { useUiStore } from "@/core/stores/ui.store";
import { NewGameWizard } from "./components/NewGameWizard";
import { ProjectList } from "./components/ProjectList";
import { Workspace } from "./components/workspace/Workspace";
import { useGameStudioStore, type SectionId } from "./store";

const SELF = "game-studio";
const SECTIONS: SectionId[] = ["dashboard", "design", "systems", "tasks", "build", "map", "history", "journal", "tools", "integrations", "settings"];

/** Page de Game Studio : la liste des jeux, l'assistant de création, ou l'espace d'un projet. */
export default function GameStudioModule() {
  const [creating, setCreating] = useState(false);
  const openId = useGameStudioStore((s) => s.openId);
  const current = useGameStudioStore((s) => s.current);
  const section = useGameStudioStore((s) => s.section);
  const selectedSystem = useGameStudioStore((s) => s.selectedSystem);
  const handoff = useUiStore((s) => s.moduleParams[SELF]);

  // Ce que la personne regarde, pour la voix et les agents (« ajoute la météo à mon jeu »).
  const selected = current?.graph.systems.find((s) => s.id === selectedSystem);
  useModuleContext(
    SELF,
    openId && current
      ? {
          project: { name: current.project.name, path: current.project.root },
          object: selected ? { type: "système", name: selected.name, id: selected.id } : null,
          details: {
            projectId: current.project.id,
            engine: current.project.engine,
            section,
            systems: current.graph.systems.length,
            openTasks: current.graph.tasks.filter((t) => !["done", "cancelled"].includes(t.status)).length,
          },
        }
      : null,
  );

  useEffect(() => {
    void useGameStudioStore.getState().refresh();
  }, []);

  // Données modifiées par un agent ou la voix : la page les relit.
  const onChanged = useCallback((event: { module: string }) => {
    if (event.module !== SELF) return;
    const store = useGameStudioStore.getState();
    void store.refresh();
    void store.reload();
  }, []);
  useBusEvent("module.data.changed", onChanged);

  // Ouverture demandée par un autre écran ou un agent : { projectId, section, create }.
  useEffect(() => {
    if (!handoff) return;
    useUiStore.getState().clearModuleParams(SELF);
    const store = useGameStudioStore.getState();
    if (handoff["create"] === true) {
      setCreating(true);
      return;
    }
    const projectId = handoff["projectId"];
    const wanted = handoff["section"];
    void (async () => {
      if (typeof projectId === "string" && projectId !== store.openId) await store.open(projectId);
      if (typeof wanted === "string" && (SECTIONS as string[]).includes(wanted)) store.go(wanted as SectionId);
    })();
  }, [handoff]);

  if (creating) {
    return (
      <div className="h-full overflow-y-auto">
        <NewGameWizard onClose={() => setCreating(false)} />
      </div>
    );
  }
  if (openId) return <Workspace />;
  return (
    <div className="h-full overflow-y-auto">
      <ProjectList onCreate={() => setCreating(true)} />
    </div>
  );
}
