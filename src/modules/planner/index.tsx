import { useEffect } from "react";
import { KanbanSquare, Loader2 } from "lucide-react";
import { EmptyState } from "@/design-system/primitives";
import { useUiStore } from "@/core/stores/ui.store";
import { useModuleContext } from "@/core/context";
import { usePlannerStore } from "./store";
import { BoardSidebar } from "./components/BoardSidebar";
import { BoardView } from "./components/BoardView";

export default function PlannerModule() {
  const { boards, activeBoardId, loaded, load, setActive } = usePlannerStore();
  const handoff = useUiStore((s) => s.moduleParams["planner"]);
  const clearParams = useUiStore((s) => s.clearModuleParams);

  useEffect(() => {
    void load();
  }, [load]);

  // Ouverture ciblée depuis un autre module (ex : bandeau roadmap du module Code).
  useEffect(() => {
    const boardId = typeof handoff?.["boardId"] === "string" ? (handoff["boardId"] as string) : null;
    if (loaded && boardId) {
      setActive(boardId);
      clearParams("planner");
    }
  }, [handoff, loaded, setActive, clearParams]);

  const board = boards.find((b) => b.id === activeBoardId) ?? null;

  // Tableau affiché, pour la voix et les agents (« ajoute une tâche ici »).
  useModuleContext(
    "planner",
    board
      ? {
          object: { type: "tableau", name: board.name, id: board.id },
          project: board.projectRoot ? { name: board.name, path: board.projectRoot } : undefined,
          file: board.roadmapPath,
          details: { cards: board.cards.length, done: board.cards.filter((c) => c.done).length },
        }
      : null,
  );

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-text-subtle">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <BoardSidebar />
      {board ? (
        <BoardView key={board.id} board={board} />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<KanbanSquare size={28} strokeWidth={1.5} />}
            title="Aucun tableau"
            description="Créez un tableau avec le bouton +. Liez-le à un roadmap.md pour qu'il suive automatiquement l'avancement d'un projet."
          />
        </div>
      )}
    </div>
  );
}
