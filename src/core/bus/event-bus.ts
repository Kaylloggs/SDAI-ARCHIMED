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
};

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
