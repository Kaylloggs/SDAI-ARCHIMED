import { useUiStore } from "@/core/stores/ui.store";

/**
 * Service `tutorial.open` : ouvre le tutoriel d'un module (id du module), ou « Premiers pas »
 * si ce module n'en a pas. Utilisé par le bouton d'aide de la barre de titre.
 */
export function open(topic: string): void {
  useUiStore.getState().openModule("tutorial", { topic });
}
