export type Subtask = { title: string; done: boolean };

export type Card = {
  id: string;
  columnId: string;
  title: string;
  notes: string;
  /** `AAAA-MM-JJ` ou `null`. */
  due: string | null;
  labels: string[];
  done: boolean;
  createdAt: number;
  /** Présent si la carte provient d'un roadmap.md (clé normalisée du titre). */
  roadmapKey?: string;
  subtasks?: Subtask[];
};

export type Column = {
  id: string;
  title: string;
  /** Titre de section du roadmap.md dont la colonne est issue. */
  roadmapSection?: string;
};

export type Board = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  columns: Column[];
  cards: Card[];
  /** Fichier roadmap.md lié (synchronisé dans les deux sens), ou `null`. */
  roadmapPath: string | null;
  /** Dossier de projet associé (module Code / conversations). */
  projectRoot: string | null;
  lastSync: number | null;
};

/** Miroir de `RoadmapDoc` (src-tauri/src/modules/planner/roadmap.rs). */
export type RoadmapDoc = {
  title: string | null;
  sections: Array<{
    title: string;
    tasks: Array<{ title: string; done: boolean; due: string | null; subtasks: Subtask[] }>;
  }>;
  total: number;
  done: number;
};

export type PlannerTaskInput = { title: string; due?: string | null };
