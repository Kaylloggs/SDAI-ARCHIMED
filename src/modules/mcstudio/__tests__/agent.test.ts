import { describe, expect, it } from "vitest";
import type { VersionCatalog } from "@/core/ipc/bindings/VersionCatalog";
import { suggestRegistryName } from "../lib/naming";
import { pickTarget } from "../lib/target";

const catalog = {
  versions: [
    {
      minecraft: "1.21.4",
      loaders: [
        { loader: "fabric", available: true, profileId: "fabric-1.21", reason: null },
        { loader: "forge", available: true, profileId: null, reason: "Pas encore de profil Forge pour 1.21.4." },
      ],
    },
    {
      minecraft: "1.20.1",
      loaders: [
        { loader: "fabric", available: true, profileId: "fabric-1.20", reason: null },
        { loader: "forge", available: true, profileId: "forge-1.20", reason: null },
      ],
    },
  ],
  profiles: [
    { id: "fabric-1.21", verified: false },
    { id: "fabric-1.20", verified: true },
    { id: "forge-1.20", verified: true },
  ],
  offline: false,
  errors: [],
} as unknown as VersionCatalog;

describe("projet créé par un agent", () => {
  it("prend la version la plus récente déjà compilée avec ce loader", () => {
    expect(pickTarget(catalog, "fabric", null)).toEqual({ minecraft: "1.20.1", loader: "fabric", profileId: "fabric-1.20" });
    const unverified = { ...catalog, profiles: [] } as VersionCatalog;
    expect(pickTarget(unverified, "fabric", null)).toEqual({ minecraft: "1.21.4", loader: "fabric", profileId: "fabric-1.21" });
    expect(pickTarget(catalog, "forge", null)).toEqual({ minecraft: "1.20.1", loader: "forge", profileId: "forge-1.20" });
  });

  it("respecte la version demandée, ou explique pourquoi c'est impossible", () => {
    expect(pickTarget(catalog, "forge", "1.20.1")).toMatchObject({ profileId: "forge-1.20" });
    expect(pickTarget(catalog, "forge", "1.21.4")).toBe("Pas encore de profil Forge pour 1.21.4.");
    expect(pickTarget(catalog, "fabric", "1.8.9")).toBe("Minecraft 1.8.9 est inconnu des loaders.");
    expect(pickTarget(catalog, "neoforge", null)).toBe("Aucune version de Minecraft prise en charge avec neoforge.");
  });

  it("déduit un nom de registre valide", () => {
    expect(suggestRegistryName("Ruby Sword")).toBe("ruby_sword");
    expect(suggestRegistryName("Épée en rubis")).toBe("epee_en_rubis");
    expect(suggestRegistryName("3 Ingots")).toBe("item_3_ingots");
  });
});
