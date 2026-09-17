import { useEffect, useRef } from "react";
import { isStalledTurn } from "./useChat";
import type { ChatSession } from "./session.store";

/** Relances automatiques successives au plus, avant de laisser la main à l'utilisateur. */
const MAX_CONSECUTIVE = 3;

/**
 * Relance d'elle-même une réponse coupée (agent arrêté après une action, sans conclure).
 * Chaque fin de tour n'est relancée qu'une fois ; le compteur repart à chaque message
 * de l'utilisateur.
 */
export function useAutoContinue(session: ChatSession | null, continueTurn: (session: ChatSession) => Promise<void>) {
  const handledTurns = useRef(new Set<string>());
  const streak = useRef<{ userMessageId: string | null; count: number }>({ userMessageId: null, count: 0 });

  const lastTurnId = session?.timeline.at(-1)?.kind === "turn" ? session.timeline.at(-1)!.id : null;

  useEffect(() => {
    if (!session || !lastTurnId || handledTurns.current.has(lastTurnId)) return;
    if (!isStalledTurn(session)) return;
    handledTurns.current.add(lastTurnId);

    const lastUser = [...session.timeline].reverse().find((item) => item.kind === "user");
    const userMessageId = lastUser?.id ?? null;
    if (streak.current.userMessageId !== userMessageId) streak.current = { userMessageId, count: 0 };
    if (streak.current.count >= MAX_CONSECUTIVE) return;
    streak.current.count += 1;

    void continueTurn(session).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTurnId, session?.status]);
}
