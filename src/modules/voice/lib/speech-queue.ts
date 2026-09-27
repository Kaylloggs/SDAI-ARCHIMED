import type { VoicePriority } from "@/core/bus/event-bus";

export type SpeechItem = {
  id: string;
  text: string;
  priority: VoicePriority;
  /** `reply` : réponse en cours ; `notice` : annonce d'un module ou d'un agent. */
  kind: "reply" | "notice";
  source?: string;
  queuedAt: number;
};

const RANK: Record<VoicePriority, number> = { low: 0, normal: 1, high: 2, critical: 3 };
/** Annonces basses gardées au plus : au-delà, les plus anciennes sont oubliées. */
const MAX_LOW = 3;
/** Une annonce basse trop ancienne n'a plus d'intérêt. */
const LOW_TTL_MS = 60_000;

/**
 * File des phrases à dire, par priorité :
 * - `critical` coupe la parole ;
 * - `high` passe devant, après la phrase en cours ;
 * - `normal` suit l'ordre d'arrivée (réponses) ;
 * - `low` attend un moment calme et n'interrompt jamais une conversation.
 */
export class SpeechQueue {
  private items: SpeechItem[] = [];

  get size(): number {
    return this.items.length;
  }

  list(): readonly SpeechItem[] {
    return this.items;
  }

  /** Ajoute ; renvoie `true` si la phrase en cours doit être coupée. */
  add(item: SpeechItem): boolean {
    if (item.priority === "low") {
      const lows = this.items.filter((i) => i.priority === "low");
      if (lows.length >= MAX_LOW) this.items = this.items.filter((i) => i !== lows[0]);
      this.items.push(item);
      return false;
    }
    // Insérée après les éléments de priorité supérieure ou égale.
    const index = this.items.findIndex((i) => RANK[i.priority] < RANK[item.priority]);
    if (index < 0) this.items.push(item);
    else this.items.splice(index, 0, item);
    return item.priority === "critical";
  }

  /**
   * Prochaine phrase. `busy` : la personne parle ou une conversation est en cours ; les
   * annonces basses attendent alors.
   */
  next(busy: boolean, now = Date.now()): SpeechItem | null {
    this.items = this.items.filter((i) => i.priority !== "low" || now - i.queuedAt < LOW_TTL_MS);
    const index = this.items.findIndex((i) => i.priority !== "low" || !busy);
    if (index < 0) return null;
    const [item] = this.items.splice(index, 1);
    return item ?? null;
  }

  peek(busy: boolean): SpeechItem | null {
    return this.items.find((i) => i.priority !== "low" || !busy) ?? null;
  }

  /** Oublie la réponse en cours (interruption), garde les annonces. */
  dropReplies(): void {
    this.items = this.items.filter((i) => i.kind !== "reply");
  }

  clear(): void {
    this.items = [];
  }
}
