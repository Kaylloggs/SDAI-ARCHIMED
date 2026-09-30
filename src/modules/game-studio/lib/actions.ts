import type { GameAction } from "@/core/ipc/bindings/GameAction";
import type { GameProjectState } from "@/core/ipc/bindings/GameProjectState";
import { ENGINE_LABEL } from "./labels";

/** Capacités de l'adaptateur qui correspondent à chaque action (les noms varient d'un moteur à l'autre). */
const CAPABILITY: Record<GameAction, string[]> = {
  setup: ["setup"],
  check: ["check"],
  test: ["smoke", "test"],
  run: ["run"],
  build: ["build"],
  editor: ["editor"],
};

export type Availability = { available: boolean; reason: string | null };

/**
 * Une action n'est proposée que si la machine la permet vraiment : moteur choisi et installé,
 * capacité déclarée disponible par l'adaptateur. Sinon la raison est donnée, jamais un bouton muet.
 */
export function availability(state: GameProjectState, action: GameAction): Availability {
  const engine = state.project.engine;
  if (!engine) return { available: false, reason: "Choisissez d'abord un moteur dans Réglages." };
  if (!state.install) return { available: false, reason: `${ENGINE_LABEL[engine]} n'est pas installé sur cette machine : installez-le depuis Outils.` };
  const caps = state.capabilities.filter((c) => CAPABILITY[action].includes(c.id));
  if (caps.length === 0) return { available: true, reason: null };
  if (caps.some((c) => c.available !== false)) return { available: true, reason: null };
  const cap = caps[0]!;
  return { available: false, reason: cap.requires ? `Il faut : ${cap.requires}.` : `${cap.label} : indisponible sur cette machine.` };
}
