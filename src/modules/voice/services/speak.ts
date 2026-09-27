import { bus, type VoicePriority } from "@/core/bus/event-bus";

/**
 * Service `voice.speak` : faire parler l'assistant depuis un module.
 * `low` n'interrompt jamais une conversation ; `high` passe devant ; `critical` coupe la parole.
 */
export function speak(text: string, priority: VoicePriority = "normal", source?: string): void {
  bus.emit("voice.speak", { text, priority, source });
}

export default { speak };
