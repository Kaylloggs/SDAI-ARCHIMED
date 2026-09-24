import { describe, expect, it } from "vitest";
import { inScope, nextAfter, rangeBetween, withoutSent, type ScopeContext } from "../lib/triage";
import type { Application, Offer } from "../types";

const offer = (id: string) => ({ id }) as Offer;

function context(patch: Partial<Record<keyof ScopeContext, string[]>> = {}): ScopeContext {
  return {
    starred: new Set(patch.starred ?? []),
    sent: new Set(patch.sent ?? []),
    tracked: new Set(patch.tracked ?? []),
    reviewed: new Set(patch.reviewed ?? []),
  };
}

const application = (offerId: string, status: Application["status"]): Application => ({
  offerId,
  title: "Graphiste",
  company: "Studio",
  url: "https://exemple.test",
  status,
  updatedAt: "2026-09-24T10:00:00",
});

describe("une annonce ne vit que dans un onglet", () => {
  it("en favori, elle quitte « Toutes » et « À voir »", () => {
    const ctx = context({ starred: ["a"] });
    expect(inScope(offer("a"), "all", ctx)).toBe(false);
    expect(inScope(offer("a"), "unseen", ctx)).toBe(false);
    expect(inScope(offer("a"), "starred", ctx)).toBe(true);
  });

  it("candidature partie, elle quitte les favoris et ne revient pas dans « Toutes »", () => {
    const ctx = context({ starred: ["a"], sent: ["a"], tracked: ["a"] });
    expect(inScope(offer("a"), "starred", ctx)).toBe(false);
    expect(inScope(offer("a"), "all", ctx)).toBe(false);
    expect(inScope(offer("a"), "applied", ctx)).toBe(true);
  });

  it("un simple brouillon laisse l'annonce où elle était", () => {
    const ctx = context({ tracked: ["a"] });
    expect(inScope(offer("a"), "all", ctx)).toBe(true);
    expect(inScope(offer("a"), "applied", ctx)).toBe(true);
  });

  it("« À voir » écarte ce qui a déjà été ouvert", () => {
    const ctx = context({ reviewed: ["a"] });
    expect(inScope(offer("a"), "unseen", ctx)).toBe(false);
    expect(inScope(offer("a"), "all", ctx)).toBe(true);
  });
});

describe("favoris et candidatures", () => {
  it("retire des favoris les candidatures envoyées ou déjà répondues", () => {
    const apps = [application("a", "sent"), application("b", "answered"), application("c", "draft")];
    expect(withoutSent(["a", "b", "c", "d"], apps)).toEqual(["c", "d"]);
  });
});

describe("sélection et revue au clavier", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("coche une plage dans les deux sens", () => {
    expect(rangeBetween(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeBetween(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeBetween(order, "zz", "c")).toEqual(["c"]);
  });

  it("passe à l'annonce suivante encore présente, sinon à la précédente", () => {
    expect(nextAfter(order, new Set(["c"]), "c")).toBe("d");
    expect(nextAfter(order, new Set(["c", "d"]), "c")).toBe("e");
    expect(nextAfter(order, new Set(["d", "e"]), "e")).toBe("c");
    expect(nextAfter(order, new Set(order), "a")).toBeNull();
    expect(nextAfter(order, new Set(["a"]), null)).toBeNull();
  });
});
