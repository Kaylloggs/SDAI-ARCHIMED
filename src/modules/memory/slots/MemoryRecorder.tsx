import { useEffect } from "react";
import { bus } from "@/core/bus/event-bus";
import { memoryApi } from "../api";
import { journalEntry, memoryLines } from "../lib/journal";

/**
 * Composant invisible (slot `app.background`) : chaque fin de tour d'agent alimente le
 * journal, et les lignes « 📌 Mémoire : … » écrites par l'IA deviennent des notes du projet.
 * Le backend ignore l'enregistrement si la capture est désactivée.
 */
export default function MemoryRecorder() {
  useEffect(
    () =>
      bus.on("engine.turn.completed", (turn) => {
        if (!turn.request && !turn.answer) return;
        void memoryApi.recordTurn(journalEntry(turn)).catch(() => undefined);
        void memoryApi
          .getSettings()
          .then((settings) => {
            if (!settings.capture) return;
            for (const line of memoryLines(turn.answer)) {
              void memoryApi.addNote(line, turn.cwd, "ai").catch(() => undefined);
            }
          })
          .catch(() => undefined);
      }),
    [],
  );
  return null;
}
