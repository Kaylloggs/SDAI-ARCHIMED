import { samePath } from "@/core/editor";
import type { ChatSession } from "@/core/engine/session.store";
import type { DraftInfo } from "../../api";

/** Origine des conversations de l'atelier (atelier et essais). */
export const ORIGIN_SKILLS = "skills";

/** Conversation de l'atelier pour un brouillon (les essais ont leur propre dossier). */
export function makerSession(sessions: ChatSession[], draft: DraftInfo | null): ChatSession | null {
  if (!draft) return null;
  return (
    sessions
      .filter((s) => s.origin === ORIGIN_SKILLS && s.cwd !== null && samePath(s.cwd, draft.path))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  );
}

/** Brouillon auquel appartient une conversation (atelier ou essai), d'après son dossier. */
export function draftOfSession(drafts: DraftInfo[], cwd: string | null): DraftInfo | null {
  if (!cwd) return null;
  const norm = (p: string) => p.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  const target = norm(cwd);
  return drafts.find((d) => target === norm(d.path) || target.startsWith(`${norm(d.path)}/`)) ?? null;
}
