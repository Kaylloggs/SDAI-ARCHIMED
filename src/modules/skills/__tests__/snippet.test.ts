import { describe, expect, it } from "vitest";
import { skillSnippet } from "../lib/snippet";

const skill = { id: "caveman", name: "caveman", path: String.raw`C:\Users\a\skills\caveman`, targets: ["claude"] };

describe("skill inséré dans le composer", () => {
  it("utilise la commande native de Claude quand le skill est activé pour lui", () => {
    expect(skillSnippet(skill, "claude")).toBe("/caveman ");
  });

  it("désigne le SKILL.md pour les autres CLI ou un skill non synchronisé", () => {
    expect(skillSnippet(skill, "antigravity")).toContain(String.raw`C:\Users\a\skills\caveman\SKILL.md`);
    expect(skillSnippet({ ...skill, targets: [] }, "claude")).toContain("SKILL.md");
  });
});
