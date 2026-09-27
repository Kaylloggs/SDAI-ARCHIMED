import { describe, expect, it } from "vitest";
import { formatMegabytes, percent, releaseHighlights } from "../notes";

describe("panneau de mise à jour", () => {
  it("retire l'en-tête d'installation des notes de release", () => {
    const notes = "## Installation\r\n\r\n- **Installeur** : setup.exe\r\n\r\n---\r\n\r\n### Ajouté\n- Atelier de skills\n\n---\n\n### Corrigé\n- Code";
    expect(releaseHighlights(notes)).toBe("### Ajouté\n- Atelier de skills\n\n---\n\n### Corrigé\n- Code");
    expect(releaseHighlights("### Ajouté\n- Rien d'autre")).toBe("### Ajouté\n- Rien d'autre");
    expect(releaseHighlights("Intro\n\n---\n\nSuite")).toBe("Intro\n\n---\n\nSuite");
  });

  it("formate la progression", () => {
    expect(formatMegabytes(7_115_626)).toBe("6,8 Mo");
    expect(percent(5, 10)).toBe(50);
    expect(percent(20, 10)).toBe(100);
    expect(percent(1, 0)).toBe(0);
  });
});
