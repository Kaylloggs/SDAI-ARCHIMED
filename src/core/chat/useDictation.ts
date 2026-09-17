import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { engineApi } from "@/core/engine/engine.api";

/**
 * Dictée vocale locale : la reconnaissance vocale de Windows transcrit la voix, ARCHIMED
 * n'envoie rien à une IA. Zéro token consommé.
 *
 * `onText(text, final)` : le texte provisoire change tant que la personne parle ; à chaque
 * fin de phrase, un texte confirmé arrive avec `final = true`.
 */
export function useDictation(onText: (text: string, final: boolean) => void) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handler = useRef(onText);
  handler.current = onText;

  // Les écoutes restent en place : les événements n'arrivent que pendant une dictée.
  useEffect(() => {
    const stops: Array<() => void> = [];
    let cancelled = false;
    const subscribe = async () => {
      const listeners = await Promise.all([
        listen<string>("dictation:partial", (event) => handler.current(event.payload, false)),
        listen<string>("dictation:final", (event) => handler.current(event.payload, true)),
        listen<string>("dictation:ended", (event) => {
          setRecording(false);
          setError(event.payload || null);
        }),
      ]).catch(() => []);
      if (cancelled) listeners.forEach((stop) => stop());
      else stops.push(...listeners);
    };
    void subscribe();
    return () => {
      cancelled = true;
      stops.forEach((stop) => stop());
    };
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      await engineApi.dictationStart(null);
      setRecording(true);
    } catch (e) {
      setError((e as { message?: string }).message ?? "Dictée indisponible");
      setRecording(false);
    }
  }, []);

  const stop = useCallback(async () => {
    setRecording(false);
    await engineApi.dictationStop().catch(() => undefined);
  }, []);

  const toggle = useCallback(() => {
    void (recording ? stop() : start());
  }, [recording, start, stop]);

  // Arrêt du moteur quand la barre de saisie disparaît (changement de module, fermeture).
  useEffect(() => () => void engineApi.dictationStop().catch(() => undefined), []);

  return { recording, error, toggle };
}
