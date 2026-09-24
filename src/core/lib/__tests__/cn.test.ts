import { describe, expect, it } from "vitest";
import { cn } from "../cn";

describe("cn", () => {
  it("garde la taille de texte du design system à côté d'une couleur", () => {
    expect(cn("text-caption", "text-danger")).toBe("text-caption text-danger");
    expect(cn("text-footnote text-text-subtle")).toBe("text-footnote text-text-subtle");
    // Deux tailles : la dernière l'emporte, comme deux couleurs.
    expect(cn("text-caption", "text-body")).toBe("text-body");
    expect(cn("text-danger", "text-success")).toBe("text-success");
  });
});
