import { useEffect, useRef } from "react";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import type { ChatSession, SessionStatus } from "./session.store";

const WORKING: SessionStatus[] = ["starting", "running"];
const STOPPED: SessionStatus[] = ["idle", "awaiting", "error"];

/**
 * Sessions qui viennent de finir leur tour ou d'attendre une réponse depuis le dernier passage.
 * `seen` est mis à jour (statut courant de chaque session).
 */
export function needsAttention(seen: Map<string, SessionStatus>, sessions: Pick<ChatSession, "id" | "status">[]): boolean {
  let notify = false;
  for (const session of sessions) {
    const before = seen.get(session.id);
    if (before && WORKING.includes(before) && STOPPED.includes(session.status)) notify = true;
    seen.set(session.id, session.status);
  }
  return notify;
}

/**
 * Fenêtre en arrière-plan : la barre des tâches signale qu'un agent a fini son tour ou attend
 * une réponse. Rien quand ARCHIMED est au premier plan.
 */
export function useTurnAttention(sessions: ChatSession[]) {
  const seen = useRef(new Map<string, SessionStatus>());
  useEffect(() => {
    if (!needsAttention(seen.current, sessions) || document.hasFocus()) return;
    void getCurrentWindow()
      .requestUserAttention(UserAttentionType.Informational)
      .catch(() => undefined);
  }, [sessions]);
}
