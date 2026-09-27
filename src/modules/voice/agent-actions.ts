import { defineActions } from "@/core/modules";
import { useVoiceStore } from "./store";
import { SECTIONS, isSection } from "./settings/sections";

/** Actions du module Voice pour les agents (les outils MCP `speak`, `notify`… existent à part). */
export default defineActions([
  {
    name: "open_settings",
    description: "Affiche une section des réglages de la voix (reconnaissance, voix, modèles locaux, confidentialité…).",
    params: {
      section: { type: "string", description: "Section à afficher.", enum: SECTIONS.map((s) => s.id), required: true },
    },
    risk: "read",
    run: async (args) => {
      const section = isSection(args.section) ? args.section : "general";
      const label = SECTIONS.find((s) => s.id === section)?.label ?? section;
      return { ok: true, message: `Réglages de la voix : ${label}.`, open: { module: "voice", params: { section } } };
    },
  },
  {
    name: "enable_local_mode",
    description: "Passe la reconnaissance et la voix sur l'ordinateur (rien ne part en ligne pour ces étapes).",
    risk: "write",
    run: async () => {
      // L'écoute redémarre d'elle-même avec les moteurs locaux (VoiceRuntime).
      useVoiceStore.getState().setSettings((s) => ({ ...s, privacy: { ...s.privacy, localOnly: true } }));
      return { ok: true, message: "Mode local activé : reconnaissance et voix sur l'ordinateur." };
    },
  },
]);
