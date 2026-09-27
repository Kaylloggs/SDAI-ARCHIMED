import { VoiceOrchestrator } from "../agent/orchestrator";

let instance: VoiceOrchestrator | null = null;

/** L'orchestrateur unique (créé à la première demande, gardé tant que l'application tourne). */
export function orchestrator(): VoiceOrchestrator {
  instance ??= new VoiceOrchestrator();
  return instance;
}
