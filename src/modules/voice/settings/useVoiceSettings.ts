import { useCallback } from "react";
import type { VoiceSettings } from "../lib/settings";
import { useVoiceStore } from "../store";

/** Réglages de la voix et mise à jour d'une section (enregistrée automatiquement). */
export function useVoiceSettings() {
  const settings = useVoiceStore((s) => s.settings);
  const setSettings = useVoiceStore((s) => s.setSettings);
  const update = useCallback(
    <K extends keyof VoiceSettings>(section: K, patch: Partial<VoiceSettings[K]>) =>
      setSettings((s) => ({ ...s, [section]: { ...s[section], ...patch } })),
    [setSettings],
  );
  return { settings, update };
}
