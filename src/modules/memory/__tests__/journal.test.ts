import { describe, expect, it } from "vitest";
import { journalEntry, memoryLines, type TurnSummary } from "../lib/journal";

const turn: TurnSummary = {
  conversationId: "c1",
  origin: "code",
  title: "Parseur",
  adapter: "claude",
  cwd: "F:/p",
  request: "  Ajoute le parseur  ",
  answer: "C'est fait.\n\n📌 Mémoire : le projet utilise pnpm, pas npm\n- 📌 Memoire: tests avec Vitest",
  tools: [
    { tool: "Write", input: { file_path: "F:/p/src/parser.ts" }, ok: true },
    { tool: "Edit", input: { file_path: "F:/p/src/old.ts" }, ok: false },
    { tool: "Bash", input: { command: "pnpm test" }, ok: true },
    { tool: "run_command", input: { CommandLine: "pnpm check" }, ok: true },
    { tool: "Read", input: { file_path: "F:/p/README.md" }, ok: true },
  ],
};

describe("journal de la mémoire", () => {
  it("résume un tour : fichiers modifiés et commandes réussies", () => {
    const entry = journalEntry(turn, new Date(1_700_000_000_000));
    expect(entry.at).toBe(1_700_000_000);
    expect(entry.request).toBe("Ajoute le parseur");
    expect(entry.files).toEqual(["F:/p/src/parser.ts"]);
    expect(entry.commands).toEqual(["pnpm test", "pnpm check"]);
    expect(entry.outcome).toBe("C'est fait.");
  });

  it("extrait les lignes 📌 Mémoire écrites par l'IA", () => {
    expect(memoryLines(turn.answer)).toEqual(["le projet utilise pnpm, pas npm", "tests avec Vitest"]);
    expect(memoryLines("rien à retenir")).toEqual([]);
  });
});
