import { describe, expect, it } from "vitest";
import { emptyDraft, stepProblem, toRequest, withDerived } from "../components/wizard/draft";
import { ago, basename, joinPath, seconds } from "../lib/format";
import { levelOf, visibleAt } from "../lib/logs";
import {
  mainClassProblem,
  modIdProblem,
  packageProblem,
  suggestMainClass,
  suggestModId,
  suggestPackage,
} from "../lib/naming";

describe("identifiants dérivés du nom", () => {
  it("propose Mod ID, classe et package", () => {
    expect(suggestModId("Dragon Realms")).toBe("dragonrealms");
    expect(suggestModId("Épées & Boucliers")).toBe("epeesboucliers");
    expect(suggestModId("3D Blocks")).toBe("mod3dblocks");
    expect(suggestMainClass("dragon realms")).toBe("DragonRealms");
    expect(suggestPackage("Alix Seara", "dragonrealms")).toBe("com.alixseara.dragonrealms");
    expect(suggestPackage("", "dragonrealms")).toBe("com.example.dragonrealms");
  });

  it("explique pourquoi un Mod ID est refusé", () => {
    expect(modIdProblem("dragonrealms")).toBeNull();
    expect(modIdProblem("dragon realms")).toMatch(/espace/);
    expect(modIdProblem("DragonRealms")).toMatch(/Minuscules/);
    expect(modIdProblem("dragon-realms")).toMatch(/Forge/);
    expect(modIdProblem("minecraft")).toMatch(/réservé/);
    expect(modIdProblem("a")).toMatch(/2 à 64/);
    expect(modIdProblem("1abc")).toMatch(/lettre/);
  });

  it("valide package et classe", () => {
    expect(packageProblem("com.pseudo.monmod")).toBeNull();
    expect(packageProblem("monmod")).not.toBeNull();
    expect(packageProblem("com.class.monmod")).toMatch(/class/);
    expect(mainClassProblem("DragonRealms")).toBeNull();
    expect(mainClassProblem("dragon")).not.toBeNull();
    expect(mainClassProblem("ModItems")).not.toBeNull();
  });
});

describe("assistant de création", () => {
  it("suit le nom tant que les champs ne sont pas modifiés à la main", () => {
    let draft = withDerived({ ...emptyDraft, name: "Dragon Realms", author: "Alix" });
    expect(draft.modId).toBe("dragonrealms");
    expect(draft.pkg).toBe("com.alix.dragonrealms");
    draft = withDerived({ ...draft, modId: "dragons", edited: { ...draft.edited, modId: true } });
    draft = withDerived({ ...draft, name: "Autre nom" });
    expect(draft.modId).toBe("dragons");
    expect(draft.pkg).toBe("com.alix.dragons");
    expect(draft.mainClass).toBe("AutreNom");
  });

  it("bloque chaque étape tant qu'il manque quelque chose", () => {
    const draft = withDerived({ ...emptyDraft, name: "Dragon Realms" });
    expect(stepProblem(0, emptyDraft)).not.toBeNull();
    expect(stepProblem(0, draft)).toBeNull();
    expect(stepProblem(1, draft)).toBeNull();
    expect(stepProblem(2, draft)).not.toBeNull();
    expect(stepProblem(3, { ...draft, minecraft: "1.21.1", loader: "fabric", profileId: "fabric-1.21" })).toMatch(/résolues/);
    expect(stepProblem(5, draft)).not.toBeNull();
    expect(toRequest(draft)).toBeNull();
  });
});

describe("journal de build", () => {
  it("classe et filtre les lignes", () => {
    expect(levelOf("> Task :compileJava FAILED")).toBe("error");
    expect(levelOf("warning: [removal] x")).toBe("warning");
    expect(levelOf("> Task :jar")).toBe("info");
    expect(visibleAt("error", "warning")).toBe(true);
    expect(visibleAt("info", "warning")).toBe(false);
    expect(visibleAt("debug", "all")).toBe(true);
  });
});

describe("formats", () => {
  it("durées, dates et chemins", () => {
    expect(seconds(8_432)).toBe("9 s");
    expect(seconds(125_000)).toBe("2 min 05 s");
    const now = Date.parse("2026-09-24T12:00:00Z");
    expect(ago("2026-09-24T11:57:00Z", now)).toBe("il y a 3 min");
    expect(ago(null)).toBe("—");
    expect(basename("C:\\mods\\dragonrealms")).toBe("dragonrealms");
    expect(joinPath("C:\\mods\\", "a", "b.png")).toBe("C:\\mods\\a\\b.png");
    expect(joinPath("/home/x", "a")).toBe("/home/x/a");
  });
});
