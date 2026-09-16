import { invokeModule } from "@/core/ipc";
import type { Board, RoadmapDoc } from "./types";

export type IcsEvent = { uid: string; title: string; date: string; description: string | null };

export const plannerApi = {
  loadBoards: () => invokeModule<Board[]>("planner", "load_boards"),
  saveBoards: (boards: Board[]) => invokeModule<void>("planner", "save_boards", { boards }),
  readRoadmap: (path: string) => invokeModule<RoadmapDoc>("planner", "read_roadmap", { path }),
  setRoadmapTask: (path: string, title: string, done: boolean) =>
    invokeModule<RoadmapDoc>("planner", "set_roadmap_task", { path, title, done }),
  appendRoadmapTasks: (path: string, section: string, tasks: string[]) =>
    invokeModule<RoadmapDoc>("planner", "append_roadmap_tasks", { path, section, tasks }),
  findRoadmap: (root: string) => invokeModule<string | null>("planner", "find_roadmap", { root }),
  watchRoadmap: (path: string) => invokeModule<void>("planner", "watch_roadmap", { path }),
  unwatchRoadmap: (path: string) => invokeModule<void>("planner", "unwatch_roadmap", { path }),
  exportIcs: (path: string, calendarName: string, events: IcsEvent[]) =>
    invokeModule<number>("planner", "export_ics", { path, calendarName, events }),
};

/** Événement émis par le backend quand un roadmap.md surveillé change. */
export const ROADMAP_CHANGED = "planner:roadmap-changed";
