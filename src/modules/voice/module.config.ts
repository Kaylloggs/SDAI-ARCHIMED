import { lazy } from "react";
import { AudioLines } from "lucide-react";
import { defineModule } from "@/core/modules";
import tutorial from "./tutorial";

/** L'orchestrateur n'est chargé qu'à la première commande (le manifeste reste léger). */
const voice = async () => (await import("./runtime/instance")).orchestrator();

export default defineModule({
  id: "voice",
  name: "Voice",
  description: "Parler à ARCHIMED : il écoute, répond à voix haute, agit dans vos modules et confie les longues tâches aux agents.",
  version: "0.1.0",
  icon: AudioLines,
  category: "ai",
  order: 12,
  enabledByDefault: true,
  page: lazy(() => import("./index")),
  launchpad: { size: "md" },
  backend: { plugin: "voice" },
  provides: {
    // Faire parler l'assistant depuis n'importe quel module : `speak(text, priority)`.
    "voice.speak": () => import("./services/speak"),
  },
  slots: {
    // Couche vocale permanente : survit aux changements de module.
    "app.background": lazy(() => import("./runtime/VoiceRuntime")),
    // Pastille à côté de la recherche : état, micro, conversation.
    "titlebar.center": lazy(() => import("./components/VoicePill")),
  },
  commands: [
    { id: "voice.toggle", title: "Voix : ouvrir ou couper le micro", run: async () => (await voice()).toggle() },
    { id: "voice.stop", title: "Voix : arrêter la réponse", run: async () => (await voice()).cancel() },
    { id: "voice.end", title: "Voix : terminer la session", run: async () => (await voice()).endSession() },
    { id: "voice.open", title: "Ouvrir les réglages de la voix", run: "navigate" },
  ],
  capabilities: ["speak", "listen", "transcribe", "voice_session", "local_models", "delegate_task"],
  actions: () => import("./agent-actions"),
  tutorial,
});
