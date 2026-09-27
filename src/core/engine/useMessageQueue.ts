import { useEffect, useRef } from "react";
import { useSessionStore, type ChatSession } from "./session.store";

/**
 * Envoie les messages mis en file pendant que l'agent travaillait, un par un, dès qu'il a fini
 * son tour (et qu'aucune question n'attend de réponse).
 */
export function useMessageQueue(
  session: ChatSession | null,
  send: (chat: ChatSession, text: string, attachments: string[], targets: string[]) => Promise<void>,
) {
  const sending = useRef<string | null>(null);
  const next = session?.queue?.[0];
  // Fin de tour (ou processus terminé) sans question en attente. Une erreur garde la file.
  const free = (session?.status === "idle" || session?.status === "ended") && !session.pendingPromptId;

  useEffect(() => {
    if (!session || !next || !free || sending.current === next.id) return;
    sending.current = next.id;
    const current = useSessionStore.getState().sessions.find((s) => s.id === session.id);
    useSessionStore.getState().patch(session.id, { queue: (current?.queue ?? []).filter((m) => m.id !== next.id) });
    void send(session, next.text, next.attachments, next.targets).finally(() => {
      sending.current = null;
    });
  }, [session, next, free, send]);
}
