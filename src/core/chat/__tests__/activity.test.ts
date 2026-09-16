import { describe, expect, it } from "vitest";
import { categorize, formatDuration, formatTokens, liveLabel, summarizeTools } from "../activity";

describe("activité de l'agent", () => {
  it("classe les outils de Claude, Antigravity et Codex", () => {
    expect(categorize("Write")).toBe("create");
    expect(categorize("replace_file_content")).toBe("edit");
    expect(categorize("run_command")).toBe("command");
    expect(categorize("shell")).toBe("command");
    expect(categorize("Grep")).toBe("search");
    expect(categorize("mcp__archimed__x")).toBe("other");
  });

  it("résume un tour comme l'application Claude", () => {
    expect(
      summarizeTools([
        { tool: "Write", ok: true },
        { tool: "write_to_file", ok: true },
        { tool: "Bash", ok: true },
        { tool: "Bash", ok: false },
        { tool: "Edit", ok: true },
      ]),
    ).toBe("2 fichiers créés · 1 fichier modifié · 2 commandes exécutées · 1 en échec");
  });

  it("décrit l'action en cours", () => {
    expect(liveLabel("thinking", null)).toBe("Réflexion");
    expect(liveLabel("tool", "Write · C:/projet/src/main.rs")).toBe("Création de main.rs");
    expect(liveLabel("tool", "Bash · pnpm test")).toBe("Exécution de pnpm test");
  });

  it("formate durée et tokens", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(12_400)).toBe("12,4 s");
    expect(formatDuration(125_000)).toBe("2 min 05 s");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(14_213).replace(/\s/g, " ")).toBe("14,2 k");
  });
});
