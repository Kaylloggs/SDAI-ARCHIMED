import { create } from "zustand";
import { Channel } from "@/core/ipc";
import type { GameAction } from "@/core/ipc/bindings/GameAction";
import type { GameAgentRole } from "@/core/ipc/bindings/GameAgentRole";
import type { GameBuildRecord } from "@/core/ipc/bindings/GameBuildRecord";
import type { GameEnvironment } from "@/core/ipc/bindings/GameEnvironment";
import type { GameJobEvent } from "@/core/ipc/bindings/GameJobEvent";
import type { GameLogLevel } from "@/core/ipc/bindings/GameLogLevel";
import type { GamePlatform } from "@/core/ipc/bindings/GamePlatform";
import type { GameProjectMap } from "@/core/ipc/bindings/GameProjectMap";
import type { GameGraphOp } from "@/core/ipc/bindings/GameGraphOp";
import type { GameProjectPatch } from "@/core/ipc/bindings/GameProjectPatch";
import type { GameProjectState } from "@/core/ipc/bindings/GameProjectState";
import type { GameProjectSummary } from "@/core/ipc/bindings/GameProjectSummary";
import { errorText, gameStudioApi } from "./api";

export type SectionId =
  | "dashboard"
  | "design"
  | "systems"
  | "tasks"
  | "assistant"
  | "documents"
  | "build"
  | "map"
  | "history"
  | "journal"
  | "tools"
  | "integrations"
  | "settings";

export type LogLine = { id: number; level: GameLogLevel; text: string };

/** Action du moteur suivie par l'interface (une par projet). */
export type JobSession = {
  running: boolean;
  jobId: string | null;
  action: GameAction;
  command: string | null;
  startedAt: number;
  lines: LogLine[];
  /** Lignes les plus anciennes retirées de l'affichage (elles restent dans le journal complet). */
  dropped: number;
  /** Secondes sans sortie, signalées par le backend. */
  quietFor: number | null;
  record: GameBuildRecord | null;
  /** Lancée avant l'ouverture de la page : pas de sortie en direct. */
  attached: boolean;
};

/** Demande d'ouverture de l'assistant : rôle, tâche confiée, message préparé (jamais envoyé seul). */
/** `fix` : le message vient d'un échec ; il compte comme une correction une fois envoyé. */
export type AssistantRequest = { role: GameAgentRole; taskId: string | null; text: string; fix?: boolean; nonce: number };

type GameStudioState = {
  projects: GameProjectSummary[];
  loaded: boolean;
  error: string | null;
  openId: string | null;
  /** Projet ouvert, relu après chaque modification. */
  current: GameProjectState | null;
  loadingCurrent: boolean;
  section: SectionId;
  /** Système sélectionné dans la vue Systèmes. */
  selectedSystem: string | null;
  environment: GameEnvironment | null;
  environmentLoading: boolean;
  jobs: Record<string, JobSession>;
  runs: Record<string, GameBuildRecord[]>;
  maps: Record<string, GameProjectMap | null>;
  scanning: Record<string, boolean>;
  assistantRequest: AssistantRequest | null;
  /** Corrections demandées d'affilée à l'agent, par projet (remis à zéro par une réussite). */
  fixRounds: Record<string, number>;

  refresh: () => Promise<void>;
  open: (id: string | null) => Promise<void>;
  reload: () => Promise<void>;
  go: (section: SectionId) => void;
  selectSystem: (id: string | null) => void;
  /** Modifie le graphe du projet ouvert ; rend la phrase d'erreur, ou `null`. */
  apply: (op: GameGraphOp) => Promise<string | null>;
  patch: (patch: GameProjectPatch) => Promise<string | null>;
  loadEnvironment: (refresh?: boolean) => Promise<void>;
  setEnvironment: (env: GameEnvironment) => void;
  clearError: () => void;
  /** Lance une action du moteur ; la promesse rend l'exécution terminée (ou refusée). */
  runAction: (id: string, action: GameAction, platform?: GamePlatform | null, development?: boolean) => Promise<GameBuildRecord>;
  cancelAction: (id: string) => Promise<string | null>;
  /** Action lancée hors de cette page (avant un rechargement) : suivie jusqu'à sa fin. */
  attachRunning: (id: string) => Promise<void>;
  loadRuns: (id: string) => Promise<void>;
  loadMap: (id: string) => Promise<void>;
  scan: (id: string) => Promise<GameProjectMap | string>;
  openAssistant: (request: Omit<AssistantRequest, "nonce">) => void;
  clearAssistantRequest: () => void;
  setFixRounds: (id: string, rounds: number) => void;
};

const MAX_VISIBLE_LINES = 5000;
const FLUSH_MS = 100;
let nextLine = 0;
const pending = new Map<string, LogLine[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const waiting = new Map<string, (record: GameBuildRecord) => void>();

function flush() {
  flushTimer = null;
  const batches = [...pending.entries()];
  pending.clear();
  useGameStudioStore.setState((state) => {
    const jobs = { ...state.jobs };
    for (const [id, lines] of batches) {
      const job = jobs[id];
      if (!job) continue;
      const merged = job.lines.concat(lines);
      const overflow = Math.max(0, merged.length - MAX_VISIBLE_LINES);
      jobs[id] = { ...job, lines: overflow ? merged.slice(overflow) : merged, dropped: job.dropped + overflow };
    }
    return { jobs };
  });
}

function queueLine(id: string, line: LogLine) {
  const batch = pending.get(id) ?? [];
  batch.push(line);
  pending.set(id, batch);
  flushTimer ??= setTimeout(flush, FLUSH_MS);
}

function patchJob(id: string, patch: Partial<JobSession>) {
  useGameStudioStore.setState((state) => {
    const job = state.jobs[id];
    return job ? { jobs: { ...state.jobs, [id]: { ...job, ...patch } } } : {};
  });
}

/** Exécution refusée avant tout lancement (moteur absent, préréglage manquant…). */
export function refusedRecord(action: GameAction, summary: string): GameBuildRecord {
  return {
    id: "",
    action,
    platform: null,
    development: false,
    status: "failed",
    startedAt: new Date().toISOString(),
    durationMs: 0,
    exitCode: null,
    command: "",
    output: null,
    summary,
    diagnostics: [],
    logLines: 0,
  };
}

export const useGameStudioStore = create<GameStudioState>()((set, get) => ({
  projects: [],
  loaded: false,
  error: null,
  openId: null,
  current: null,
  loadingCurrent: false,
  section: "dashboard",
  selectedSystem: null,
  environment: null,
  environmentLoading: false,
  jobs: {},
  runs: {},
  maps: {},
  scanning: {},
  assistantRequest: null,
  fixRounds: {},

  refresh: async () => {
    try {
      const projects = await gameStudioApi.list();
      set({ projects, loaded: true });
    } catch (error) {
      set({ error: errorText(error), loaded: true });
    }
  },

  open: async (id) => {
    set({ openId: id, current: null, selectedSystem: null, section: "dashboard" });
    if (id) await get().reload();
  },

  reload: async () => {
    const id = get().openId;
    if (!id) return;
    set({ loadingCurrent: true });
    try {
      const current = await gameStudioApi.state(id);
      if (get().openId === id) set({ current, loadingCurrent: false, error: null });
    } catch (error) {
      set({ error: errorText(error), loadingCurrent: false });
    }
  },

  go: (section) => set({ section }),
  selectSystem: (selectedSystem) => set({ selectedSystem }),

  apply: async (op) => {
    const { openId, current } = get();
    if (!openId || !current) return "Aucun projet ouvert.";
    try {
      const graph = await gameStudioApi.graphOp(openId, op);
      set({ current: { ...current, graph } });
      void get().refresh();
      return null;
    } catch (error) {
      return errorText(error);
    }
  },

  patch: async (patch) => {
    const { openId } = get();
    if (!openId) return "Aucun projet ouvert.";
    try {
      await gameStudioApi.update(openId, patch);
      await Promise.all([get().reload(), get().refresh()]);
      return null;
    } catch (error) {
      return errorText(error);
    }
  },

  loadEnvironment: async (refresh = false) => {
    set({ environmentLoading: true });
    try {
      const environment = await gameStudioApi.environment(refresh);
      set({ environment, environmentLoading: false });
    } catch (error) {
      set({ error: errorText(error), environmentLoading: false });
    }
  },

  setEnvironment: (environment) => set({ environment }),
  clearError: () => set({ error: null }),

  runAction: async (id, action, platform = null, development = false) => {
    const busy = get().jobs[id];
    if (busy?.running) return refusedRecord(action, "Une action est déjà en cours sur ce projet : attendez sa fin ou arrêtez-la.");
    pending.delete(id);
    set((state) => ({
      jobs: {
        ...state.jobs,
        [id]: { running: true, jobId: null, action, command: null, startedAt: Date.now(), lines: [], dropped: 0, quietFor: null, record: null, attached: false },
      },
    }));
    const done = new Promise<GameBuildRecord>((resolve) => waiting.set(id, resolve));
    const channel = new Channel<GameJobEvent>();
    channel.onmessage = (event) => {
      switch (event.kind) {
        case "started":
          patchJob(id, { jobId: event.jobId, command: event.command });
          break;
        case "line":
          queueLine(id, { id: nextLine++, level: event.level, text: event.text });
          if (get().jobs[id]?.quietFor) patchJob(id, { quietFor: null });
          break;
        case "quiet":
          patchJob(id, { quietFor: event.seconds });
          break;
        case "finished": {
          flush();
          patchJob(id, { running: false, quietFor: null, record: event.record });
          if (event.record.status === "success" && get().fixRounds[id]) get().setFixRounds(id, 0);
          waiting.get(id)?.(event.record);
          waiting.delete(id);
          void get().loadRuns(id);
          void get().refresh();
          if (get().openId === id) void get().reload();
          break;
        }
      }
    };
    try {
      await gameStudioApi.runAction(id, action, platform, development, channel);
    } catch (error) {
      const record = refusedRecord(action, errorText(error));
      patchJob(id, { running: false, record });
      waiting.delete(id);
      return record;
    }
    return done;
  },

  cancelAction: async (id) => {
    try {
      await gameStudioApi.cancelAction(id);
      return null;
    } catch (error) {
      return errorText(error);
    }
  },

  attachRunning: async (id) => {
    if (get().jobs[id]?.running) return;
    const running = await gameStudioApi.currentAction(id).catch(() => null);
    if (!running) return;
    set((state) => ({
      jobs: {
        ...state.jobs,
        [id]: {
          running: true,
          jobId: running.jobId,
          action: running.action,
          command: running.command,
          startedAt: Date.parse(running.startedAt) || Date.now(),
          lines: [],
          dropped: 0,
          quietFor: null,
          record: null,
          attached: true,
        },
      },
    }));
    // Pas de flux pour cette exécution : on attend qu'elle se termine, puis on lit son résultat.
    const poll = async () => {
      const still = await gameStudioApi.currentAction(id).catch(() => null);
      if (still && still.jobId === running.jobId) {
        setTimeout(() => void poll(), 2000);
        return;
      }
      const runs = await gameStudioApi.runs(id).catch(() => []);
      set((state) => ({ runs: { ...state.runs, [id]: runs } }));
      patchJob(id, { running: false, record: runs.find((r) => r.id === running.jobId) ?? null });
      if (get().openId === id) void get().reload();
    };
    setTimeout(() => void poll(), 2000);
  },

  loadRuns: async (id) => {
    try {
      const runs = await gameStudioApi.runs(id);
      set((state) => ({ runs: { ...state.runs, [id]: runs } }));
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  loadMap: async (id) => {
    try {
      const map = await gameStudioApi.map(id);
      set((state) => ({ maps: { ...state.maps, [id]: map } }));
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  openAssistant: (request) => set({ assistantRequest: { ...request, nonce: Date.now() }, section: "assistant" }),
  clearAssistantRequest: () => set({ assistantRequest: null }),
  setFixRounds: (id, rounds) => set((state) => ({ fixRounds: { ...state.fixRounds, [id]: rounds } })),

  scan: async (id) => {
    set((state) => ({ scanning: { ...state.scanning, [id]: true } }));
    try {
      const map = await gameStudioApi.scan(id);
      set((state) => ({ maps: { ...state.maps, [id]: map }, scanning: { ...state.scanning, [id]: false } }));
      return map;
    } catch (error) {
      set((state) => ({ scanning: { ...state.scanning, [id]: false } }));
      return errorText(error);
    }
  },
}));
