import { describe, expect, it } from "vitest";
import { buildPrompt } from "../useChat";

describe("buildPrompt", () => {
  it("laisse le message intact sans fichier", () => {
    expect(buildPrompt("Corrige le bug")).toBe("Corrige le bug");
  });

  it("liste les fichiers ciblés avant les pièces jointes", () => {
    const prompt = buildPrompt(
      "Refactorise",
      ["C:/docs/specs.pdf"],
      ["C:/projet/src/main.rs"],
    );
    expect(prompt).toContain("Refactorise");
    expect(prompt.indexOf("Fichiers à modifier")).toBeLessThan(prompt.indexOf("Pièces jointes"));
    expect(prompt).toContain("- C:/projet/src/main.rs");
    expect(prompt).toContain("- C:/docs/specs.pdf");
  });

  it("n'ajoute que la section utile", () => {
    const onlyTargets = buildPrompt("Ajoute un test", [], ["a.ts"]);
    expect(onlyTargets).toContain("Fichiers à modifier");
    expect(onlyTargets).not.toContain("Pièces jointes");
  });
});
