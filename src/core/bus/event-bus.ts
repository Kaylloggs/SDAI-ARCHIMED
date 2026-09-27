import { useEffect } from "react";

/**
 * Bus d'événements frontend : seul canal de communication entre modules
 * pour les faits (pas pour les appels). Types déclarés ici.
 */
export type BusEvents = {
  "skills.changed": { count: number };
  "settings.changed": { key: string };
  "modules.changed": { id: string; enabled: boolean };
  "engine.session.started": { sessionId: string; adapter: string };
  "engine.prompt.resolved": { sessionId: string; promptId: string };
  /** Fin d'un tour d'agent (voir `turnSummary`, session.store.ts). */
  "engine.turn.completed": {
    conversationId: string;
    /** Module qui a créé la conversation (`chat`, `code`, `mcstudio`…). */
    origin: string;
    title: string;
    adapter: string;
    cwd: string | null;
    request: string;
    answer: string;
    tools: Array<{ tool: string; input: unknown; ok?: boolean }>;
  };
  /** Un module est affiché (navigation, commande vocale, agent). */
  "module.opened": { id: string; params?: Record<string, unknown> };
  /** Couche vocale (module Voice) : l'écoute démarre ou s'arrête. */
  "voice.started": { sessionId: string };
  "voice.stopped": { sessionId: string };
  /** Phrase reconnue (`final` : phrase terminée). */
  "voice.transcript": { text: string; final: boolean };
  /** Réponse de l'assistant vocal (texte complet d'un tour). */
  "voice.response": { text: string };
  "voice.speaking": { text: string; priority: VoicePriority };
  /** La personne a coupé la parole à l'assistant. */
  "voice.interrupted": { text: string };
  /**
   * Faire parler l'assistant depuis n'importe quel module (sans dépendre du module Voice :
   * ignoré s'il est absent). « Build terminé » → low ; « permission demandée » → high.
   */
  "voice.speak": { text: string; priority?: VoicePriority; source?: string };
  /** Tâche confiée à un agent (voix ou outil MCP `start_task`). */
  "voice.task.started": { taskId: string; title: string; agent: string };
  "voice.task.completed": { taskId: string; title: string; summary: string };
  "voice.task.failed": { taskId: string; title: string; error: string };
  /** Un agent commence ou termine un tour (toutes origines). */
  "agent.started": { conversationId: string; origin: string; adapter: string };
  "agent.completed": { conversationId: string; origin: string; ok: boolean };
};

export type VoicePriority = "low" | "normal" | "high" | "critical";

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;

const handlers = new Map<string, Set<Handler<never>>>();

export const bus = {
  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    for (const handler of handlers.get(event) ?? []) {
      (handler as Handler<K>)(payload);
    }
  },
  on<K extends keyof BusEvents>(event: K, handler: Handler<K>): () => void {
    const set = handlers.get(event) ?? new Set();
    set.add(handler as Handler<never>);
    handlers.set(event, set);
    return () => set.delete(handler as Handler<never>);
  },
};

export function useBusEvent<K extends keyof BusEvents>(
  event: K,
  handler: Handler<K>,
): void {
  useEffect(() => bus.on(event, handler), [event, handler]);
}
