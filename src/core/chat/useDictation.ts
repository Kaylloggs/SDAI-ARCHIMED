import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { engineApi } from "@/core/engine/engine.api";

/**
 * Dictée vocale locale : la reconnaissance vocale de Windows transcrit la voix, ARCHIMED
 * n'envoie rien à une IA. Zéro token consommé.
 *
 * `onText(text, final)` : le texte provisoire change tant que la personne parle ; à chaque
 * fin de phrase, un texte confirmé arrive avec `final = true`.
 *
 * Le moteur écoute **le micro par défaut de Windows**, qui n'est pas toujours celui qu'on
 * croit : `level` (0 → 1) montre ce qu'il entend vraiment et `warning` prévient quand
 * l'entrée reste muette.
 */
export function useDictation(onText: (text: string, final: boolean) => void) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [device, setDevice] = useState<string | null>(null);
  const handler = useRef(onText);
  handler.current = onText;

  // Les écoutes restent en place : les événements n'arrivent que pendant une dictée.
  useEffect(() => {
    const stops: Array<() => void> = [];
    let cancelled = false;
    const subscribe = async () => {
      const listeners = await Promise.all([
        listen<string>("dictation:started", () => {
          setRecording(true);
          setError(null);
          setWarning(null);
        }),
        listen<string>("dictation:partial", (event) =>
          handler.current(event.payload, false),
        ),
        listen<string>("dictation:final", (event) =>
          handler.current(event.payload, true),
        ),
        listen<string>("dictation:level", (event) =>
          setLevel(Number(event.payload) || 0),
        ),
        listen<string>("dictation:warning", (event) =>
          setWarning(event.payload || null),
        ),
        listen<string>("dictation:ended", (event) => {
          setRecording(false);
          setLevel(0);
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
    setWarning(null);
    // Le nom du micro sert aux messages : « Realtek » plutôt que « le micro ».
    void engineApi
      .dictationDevice()
      .then(setDevice)
      .catch(() => setDevice(null));
    try {
      // L'état passe à « écoute » sur l'événement `dictation:started` du moteur.
      await engineApi.dictationStart(null);
    } catch (e) {
      setError((e as { message?: string }).message ?? "Dictée indisponible");
      setRecording(false);
    }
  }, []);

  const stop = useCallback(async () => {
    setRecording(false);
    setLevel(0);
    await engineApi.dictationStop().catch(() => undefined);
  }, []);

  const toggle = useCallback(() => {
    void (recording ? stop() : start());
  }, [recording, start, stop]);

  // Arrêt du moteur quand la barre de saisie disparaît (changement de module, fermeture).
  useEffect(
    () => () => void engineApi.dictationStop().catch(() => undefined),
    [],
  );

  return { recording, error, warning, level, device, toggle };
}
