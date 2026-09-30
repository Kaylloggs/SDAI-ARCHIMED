import type { GameTask } from "@/core/ipc/bindings/GameTask";

/** Tâches prêtes : à faire, et dont toutes les tâches préalables sont terminées (même règle que le Rust). */
export function readyTasks(tasks: GameTask[]): GameTask[] {
  const done = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));
  return tasks
    .filter((t) => t.status === "todo" && t.dependsOn.every((d) => done.has(d)))
    .sort((a, b) => a.order - b.order);
}

/** Tâches qui attendent `id`. */
export function waitingOn(tasks: GameTask[], id: string): GameTask[] {
  return tasks.filter((t) => t.dependsOn.includes(id));
}

/** Tâche vide prête à remplir (l'identifiant est donné par le backend). */
export function blankTask(order: number): GameTask {
  const now = new Date().toISOString();
  return {
    id: "",
    title: "",
    description: "",
    status: "todo",
    role: "programming",
    dependsOn: [],
    systems: [],
    files: [],
    expected: "",
    validation: "",
    phase: null,
    conversationId: null,
    result: null,
    order,
    createdAt: now,
    updatedAt: now,
  };
}
