import { describe, expect, it } from "vitest";
import { applyTokenSaver, cavemanRules } from "@/core/engine/tokenSaver";

describe("économie de tokens (caveman)", () => {
  it("embarque le skill sans son en-tête YAML", () => {
    const rules = cavemanRules();
    expect(rules).not.toMatch(/^---/);
    expect(rules).toContain("caveman");
  });

  it("envoie les règles complètes une fois, puis un rappel d'une ligne", () => {
    const first = applyTokenSaver("Corrige le bug", "ultra", false, "RÈGLES");
    expect(first).toContain("niveau ultra");
    expect(first).toContain("RÈGLES");
    expect(first.endsWith("Corrige le bug")).toBe(true);

    const next = applyTokenSaver("Et les tests ?", "ultra", true, "RÈGLES");
    expect(next).not.toContain("RÈGLES");
    expect(next.split("\n")[0]).toContain("Mode caveman ultra actif");
    expect(next.endsWith("Et les tests ?")).toBe(true);
  });
});
