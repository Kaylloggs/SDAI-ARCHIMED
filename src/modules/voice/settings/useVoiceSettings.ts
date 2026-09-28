import { useCallback } from "react";
import type { VoiceSettings } from "../lib/settings";
import { useVoiceStore } from "../store";

/** Sections de réglages (tout sauf le numéro de révision). */
type Section = Exclude<keyof VoiceSettings, "revision">;

/** Réglages de la voix et mise à jour d'une section (enregistrée automatiquement). */
export function useVoiceSettings() {
  const settings = useVoiceStore((s) => s.settings);
  const setSettings = useVoiceStore((s) => s.setSettings);
  const update = useCallback(
    <K extends Section>(section: K, patch: Partial<VoiceSettings[K]>) =>
      setSettings((s) => ({ ...s, [section]: { ...s[section], ...patch } })),
    [setSettings],
  );
  return { settings, update };
}
