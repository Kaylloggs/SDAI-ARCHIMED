import type { ChatSession } from "@/core/engine/session.store";

export type SessionGroup = { label: string; sessions: ChatSession[] };

const DAY = 24 * 60 * 60 * 1000;

/** Minuit du jour de `timestamp`, heure locale. */
function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Conversations rangées par date de dernière activité, les plus récentes d'abord. */
export function groupSessions(sessions: ChatSession[], now = Date.now()): SessionGroup[] {
  const today = startOfDay(now);
  const groups: SessionGroup[] = [
    { label: "Aujourd'hui", sessions: [] },
    { label: "Hier", sessions: [] },
    { label: "7 derniers jours", sessions: [] },
    { label: "Plus ancien", sessions: [] },
  ];
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const session of sorted) {
    const at = session.updatedAt;
    const index = at >= today ? 0 : at >= today - DAY ? 1 : at >= today - 7 * DAY ? 2 : 3;
    groups[index]!.sessions.push(session);
  }
  return groups.filter((group) => group.sessions.length > 0);
}

/** Recherche dans le titre, le dossier et les messages de la personne. */
export function matchesSearch(session: ChatSession, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (session.title.toLowerCase().includes(q)) return true;
  if (session.cwd?.toLowerCase().includes(q)) return true;
  return session.timeline.some((item) => item.kind === "user" && item.text.toLowerCase().includes(q));
}

export type SessionState = "working" | "waiting" | "error" | "idle";

/** Ce que la liste signale : l'agent travaille, attend une réponse, ou s'est arrêté sur une erreur. */
export function sessionState(session: Pick<ChatSession, "status" | "pendingPromptId">): SessionState {
  if (session.status === "awaiting" || session.pendingPromptId) return "waiting";
  if (session.status === "starting" || session.status === "running") return "working";
  if (session.status === "error") return "error";
  return "idle";
}
