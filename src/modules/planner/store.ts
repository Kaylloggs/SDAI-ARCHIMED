import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { plannerApi, ROADMAP_CHANGED } from "./api";
import { addCards, createBoard, syncBoardWithRoadmap } from "./lib/board";
import type { Board, Card, PlannerTaskInput } from "./types";

type State = {
  boards: Board[];
  activeBoardId: string | null;
  loaded: boolean;
  error: string | null;

  load: () => Promise<void>;
  setActive: (id: string) => void;
  createBoard: (init: { name: string; roadmapPath?: string | null; projectRoot?: string | null }) => Promise<string>;
  renameBoard: (id: string, name: string) => void;
  deleteBoard: (id: string) => void;
  updateBoard: (id: string, update: (board: Board) => Board) => void;
  syncRoadmap: (id: string) => Promise<void>;
  setCardDone: (boardId: string, card: Card, done: boolean) => Promise<void>;
  /** Ajoute des tâches : au roadmap.md si le tableau en a un, sinon comme cartes. */
  addTasks: (boardId: string, tasks: PlannerTaskInput[]) => Promise<void>;
};

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let unlisten: (() => void) | undefined;

function message(error: unknown): string {
  return (error as { message?: string }).message ?? String(error);
}

export const usePlannerStore = create<State>()((set, get) => {
  /** Sauvegarde différée : regroupe les modifications rapprochées (glisser, saisie). */
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      plannerApi.saveBoards(get().boards).catch((error) => set({ error: message(error) }));
    }, 400);
  };

  const replace = (id: string, board: Board) => {
    set((state) => ({ boards: state.boards.map((b) => (b.id === id ? board : b)) }));
    persist();
  };

  return {
    boards: [],
    activeBoardId: null,
    loaded: false,
    error: null,

    load: async () => {
      if (get().loaded) return;
      try {
        const boards = await plannerApi.loadBoards();
        set({ boards, loaded: true, activeBoardId: boards[0]?.id ?? null });

        // Les roadmaps liées sont surveillées : une modification (par l'IA) resynchronise.
        for (const board of boards) {
          if (board.roadmapPath) {
            void plannerApi.watchRoadmap(board.roadmapPath).catch(() => undefined);
            void get().syncRoadmap(board.id);
          }
        }
        if (!unlisten) {
          try {
            unlisten = await listen<string>(ROADMAP_CHANGED, (event) => {
              const changed = event.payload.toLowerCase();
              for (const board of get().boards) {
                if (board.roadmapPath?.toLowerCase() === changed) void get().syncRoadmap(board.id);
              }
            });
          } catch {
            // hors Tauri : pas d'événements
          }
        }
      } catch (error) {
        set({ loaded: true, error: message(error) });
      }
    },

    setActive: (activeBoardId) => set({ activeBoardId }),

    createBoard: async (init) => {
      const board = createBoard(init);
      set((state) => ({ boards: [...state.boards, board], activeBoardId: board.id }));
      persist();
      if (board.roadmapPath) {
        await plannerApi.watchRoadmap(board.roadmapPath).catch(() => undefined);
        await get().syncRoadmap(board.id);
      }
      return board.id;
    },

    renameBoard: (id, name) => {
      const board = get().boards.find((b) => b.id === id);
      if (board && name.trim()) replace(id, { ...board, name: name.trim(), updatedAt: Date.now() });
    },

    deleteBoard: (id) => {
      const board = get().boards.find((b) => b.id === id);
      if (board?.roadmapPath) void plannerApi.unwatchRoadmap(board.roadmapPath).catch(() => undefined);
      set((state) => {
        const boards = state.boards.filter((b) => b.id !== id);
        return {
          boards,
          activeBoardId: state.activeBoardId === id ? (boards[0]?.id ?? null) : state.activeBoardId,
        };
      });
      persist();
    },

    updateBoard: (id, update) => {
      const board = get().boards.find((b) => b.id === id);
      if (board) replace(id, { ...update(board), updatedAt: Date.now() });
    },

    syncRoadmap: async (id) => {
      const board = get().boards.find((b) => b.id === id);
      if (!board?.roadmapPath) return;
      try {
        const doc = await plannerApi.readRoadmap(board.roadmapPath);
        const latest = get().boards.find((b) => b.id === id);
        if (latest) replace(id, syncBoardWithRoadmap(latest, doc));
        set({ error: null });
      } catch (error) {
        set({ error: `Roadmap illisible : ${message(error)}` });
      }
    },

    setCardDone: async (boardId, card, done) => {
      const board = get().boards.find((b) => b.id === boardId);
      if (!board) return;

      // Carte issue du roadmap : on écrit dans le fichier, qui fait foi.
      if (board.roadmapPath && card.roadmapKey) {
        try {
          const doc = await plannerApi.setRoadmapTask(board.roadmapPath, card.title, done);
          const latest = get().boards.find((b) => b.id === boardId);
          if (latest) replace(boardId, syncBoardWithRoadmap(latest, doc));
        } catch (error) {
          set({ error: message(error) });
        }
        return;
      }

      replace(boardId, {
        ...board,
        cards: board.cards.map((c) => (c.id === card.id ? { ...c, done } : c)),
        updatedAt: Date.now(),
      });
    },

    addTasks: async (boardId, tasks) => {
      const board = get().boards.find((b) => b.id === boardId);
      if (!board || tasks.length === 0) return;

      if (board.roadmapPath) {
        const titles = tasks.map((task) => (task.due ? `${task.title} @${task.due}` : task.title));
        try {
          const doc = await plannerApi.appendRoadmapTasks(
            board.roadmapPath,
            "À trier (ajouté depuis ARCHIMED)",
            titles,
          );
          const latest = get().boards.find((b) => b.id === boardId);
          if (latest) replace(boardId, syncBoardWithRoadmap(latest, doc));
        } catch (error) {
          set({ error: message(error) });
        }
        return;
      }

      replace(boardId, addCards(board, tasks));
    },
  };
});
