import { create } from "zustand";
import { Channel } from "@/core/ipc";
import type { BuildEvent } from "@/core/ipc/bindings/BuildEvent";
import type { BuildRecord } from "@/core/ipc/bindings/BuildRecord";
import type { BuildTask } from "@/core/ipc/bindings/BuildTask";
import type { LogLevel } from "@/core/ipc/bindings/LogLevel";
import type { ProjectSummary } from "@/core/ipc/bindings/ProjectSummary";
import { errorText, mcstudioApi } from "./api";

/** Lignes gardées à l'écran ; le journal complet reste dans `.mcstudio/builds/`. */
export const MAX_VISIBLE_LINES = 5000;
/** Les lignes de Gradle arrivent par rafales : l'affichage est regroupé. */
const FLUSH_MS = 80;

export type LogLine = { id: number; level: LogLevel; text: string };

export type BuildSession = {
  running: boolean;
  task: BuildTask;
  command: string | null;
  javaVersion: string | null;
  currentTask: string | null;
  startedAt: number;
  lines: LogLine[];
  /** Lignes écartées en tête pour tenir sous `MAX_VISIBLE_LINES`. */
  dropped: number;
  record: BuildRecord | null;
};

type McStudioState = {
  projects: ProjectSummary[];
  loaded: boolean;
  error: string | null;
  openId: string | null;
  builds: Record<string, BuildSession>;

  refresh: () => Promise<void>;
  upsert: (project: ProjectSummary) => void;
  forget: (id: string) => void;
  open: (id: string | null) => void;
  startBuild: (id: string, task: BuildTask, offline: boolean) => Promise<void>;
  cancelBuild: (id: string) => Promise<void>;
};

let nextLine = 0;
const pending = new Map<string, LogLine[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  flushTimer = null;
  const batches = [...pending.entries()];
  pending.clear();
  useMcStudioStore.setState((state) => {
    const builds = { ...state.builds };
    for (const [id, lines] of batches) {
      const session = builds[id];
      if (!session) continue;
      const merged = session.lines.concat(lines);
      const overflow = Math.max(0, merged.length - MAX_VISIBLE_LINES);
      builds[id] = { ...session, lines: overflow ? merged.slice(overflow) : merged, dropped: session.dropped + overflow };
    }
    return { builds };
  });
}

function queueLine(id: string, line: LogLine) {
  const list = pending.get(id) ?? [];
  list.push(line);
  pending.set(id, list);
  flushTimer ??= setTimeout(flush, FLUSH_MS);
}

function patchSession(id: string, patch: Partial<BuildSession>) {
  useMcStudioStore.setState((state) => {
    const session = state.builds[id];
    return session ? { builds: { ...state.builds, [id]: { ...session, ...patch } } } : {};
  });
}

export const useMcStudioStore = create<McStudioState>()((set, get) => ({
  projects: [],
  loaded: false,
  error: null,
  openId: null,
  builds: {},

  refresh: async () => {
    try {
      const projects = await mcstudioApi.listProjects();
      set({ projects, loaded: true, error: null });
    } catch (error) {
      set({ loaded: true, error: errorText(error) });
    }
  },

  upsert: (project) =>
    set((state) => ({
      projects: [project, ...state.projects.filter((p) => p.id !== project.id)],
    })),

  forget: (id) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      openId: state.openId === id ? null : state.openId,
    })),

  open: (id) => set({ openId: id }),

  startBuild: async (id, task, offline) => {
    if (get().builds[id]?.running) return;
    set((state) => ({
      builds: {
        ...state.builds,
        [id]: {
          running: true,
          task,
          command: null,
          javaVersion: null,
          currentTask: null,
          startedAt: Date.now(),
          lines: [],
          dropped: 0,
          record: null,
        },
      },
    }));

    const channel = new Channel<BuildEvent>();
    channel.onmessage = (event) => {
      switch (event.type) {
        case "started":
          patchSession(id, { command: event.command, javaVersion: event.javaVersion });
          break;
        case "task":
          patchSession(id, { currentTask: event.name });
          break;
        case "line":
          queueLine(id, { id: nextLine++, level: event.level, text: event.text });
          break;
        case "finished":
          flush();
          patchSession(id, { running: false, currentTask: null, record: event.record });
          void mcstudioApi.getProject(id).then(get().upsert).catch(() => undefined);
          break;
      }
    };

    try {
      await mcstudioApi.build(id, task, offline, channel);
    } catch (error) {
      // Refus avant le lancement (Java absent, wrapper manquant…) : rien n'a tourné.
      patchSession(id, {
        running: false,
        record: {
          id: "",
          task,
          status: "failed",
          startedAt: new Date().toISOString(),
          durationMs: 0,
          exitCode: null,
          command: "",
          jar: null,
          dist: null,
          issues: [],
          summary: errorText(error),
        },
      });
    }
  },

  cancelBuild: async (id) => {
    try {
      await mcstudioApi.cancelBuild(id);
    } catch (error) {
      set({ error: errorText(error) });
    }
  },
}));
