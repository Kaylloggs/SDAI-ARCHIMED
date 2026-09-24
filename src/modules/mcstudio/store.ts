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
  /** Arrêt demandé (serveur : `stop` envoyé, en attente de l'enregistrement du monde). */
  stopping: boolean;
};

type McStudioState = {
  projects: ProjectSummary[];
  loaded: boolean;
  error: string | null;
  openId: string | null;
  /** Compilation ou partie en cours (une à la fois par projet). */
  builds: Record<string, BuildSession>;
  /** Serveur de test, lancé à côté pour le rejoindre depuis le jeu. */
  servers: Record<string, BuildSession>;
  /** Augmente quand l'icône d'un projet change : l'aperçu contourne le cache. */
  iconRevision: Record<string, number>;
  /** Corrections d'affilée demandées à l'IA après un build en échec (bornées). */
  fixRounds: Record<string, number>;
  /** Conversation de l'assistant à afficher (ouverte depuis l'accueil). */
  focus: { projectId: string; conversationId: string } | null;
  /** Message préparé ailleurs (portage…) à déposer dans la saisie de l'assistant. */
  handoff: { projectId: string; text: string } | null;

  refresh: () => Promise<void>;
  upsert: (project: ProjectSummary) => void;
  forget: (id: string) => void;
  open: (id: string | null) => void;
  startBuild: (id: string, task: BuildTask, offline: boolean) => Promise<void>;
  cancelBuild: (id: string) => Promise<void>;
  /** `force` : sans attendre que le serveur enregistre le monde. */
  stopServer: (id: string, force?: boolean) => Promise<void>;
  /** Commande tapée dans la console du serveur ; l'écho apparaît dans son journal. */
  sendServerCommand: (id: string, command: string) => Promise<void>;
  bumpIcon: (id: string) => void;
  setFixRounds: (id: string, rounds: number) => void;
  setFocus: (focus: { projectId: string; conversationId: string } | null) => void;
  setHandoff: (handoff: { projectId: string; text: string } | null) => void;
};

let nextLine = 0;
type Slot = "builds" | "servers";
const slotOf = (task: BuildTask): Slot => (task === "runServer" ? "servers" : "builds");
const pending = new Map<string, { slot: Slot; id: string; lines: LogLine[] }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  flushTimer = null;
  const batches = [...pending.values()];
  pending.clear();
  useMcStudioStore.setState((state) => {
    const next = { builds: { ...state.builds }, servers: { ...state.servers } };
    for (const { slot, id, lines } of batches) {
      const session = next[slot][id];
      if (!session) continue;
      const merged = session.lines.concat(lines);
      const overflow = Math.max(0, merged.length - MAX_VISIBLE_LINES);
      next[slot][id] = { ...session, lines: overflow ? merged.slice(overflow) : merged, dropped: session.dropped + overflow };
    }
    return next;
  });
}

function queueLine(slot: Slot, id: string, line: LogLine) {
  const key = `${slot}|${id}`;
  const batch = pending.get(key) ?? { slot, id, lines: [] };
  batch.lines.push(line);
  pending.set(key, batch);
  flushTimer ??= setTimeout(flush, FLUSH_MS);
}

function patchSession(slot: Slot, id: string, patch: Partial<BuildSession>) {
  useMcStudioStore.setState((state) => {
    const session = state[slot][id];
    return session ? { [slot]: { ...state[slot], [id]: { ...session, ...patch } } } : {};
  });
}

export const useMcStudioStore = create<McStudioState>()((set, get) => ({
  projects: [],
  loaded: false,
  error: null,
  openId: null,
  builds: {},
  servers: {},
  iconRevision: {},
  fixRounds: {},
  focus: null,
  handoff: null,

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
    const slot = slotOf(task);
    if (get()[slot][id]?.running) return;
    set((state) => ({
      [slot]: {
        ...state[slot],
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
          stopping: false,
        },
      },
    }));

    const channel = new Channel<BuildEvent>();
    channel.onmessage = (event) => {
      switch (event.type) {
        case "started":
          patchSession(slot, id, { command: event.command, javaVersion: event.javaVersion });
          break;
        case "task":
          patchSession(slot, id, { currentTask: event.name });
          break;
        case "line":
          queueLine(slot, id, { id: nextLine++, level: event.level, text: event.text });
          break;
        case "finished":
          flush();
          patchSession(slot, id, { running: false, currentTask: null, record: event.record });
          void mcstudioApi.getProject(id).then(get().upsert).catch(() => undefined);
          break;
      }
    };

    try {
      await mcstudioApi.build(id, task, offline, channel);
    } catch (error) {
      // Refus avant le lancement (Java absent, wrapper manquant…) : rien n'a tourné.
      patchSession(slot, id, {
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

  bumpIcon: (id) => set((state) => ({ iconRevision: { ...state.iconRevision, [id]: Date.now() } })),
  setFixRounds: (id, rounds) => set((state) => ({ fixRounds: { ...state.fixRounds, [id]: rounds } })),
  setFocus: (focus) => set({ focus }),
  setHandoff: (handoff) => set({ handoff }),

  cancelBuild: async (id) => {
    try {
      await mcstudioApi.cancelBuild(id);
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  stopServer: async (id, force = false) => {
    patchSession("servers", id, { stopping: true });
    try {
      await mcstudioApi.stopServer(id, force);
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  sendServerCommand: async (id, command) => {
    await mcstudioApi.sendServerCommand(id, command);
    queueLine("servers", id, { id: nextLine++, level: "info", text: `> ${command}` });
  },
}));
