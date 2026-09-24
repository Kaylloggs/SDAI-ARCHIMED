import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION, emptyDraft, stepProblem, toRequest, withDerived } from "../components/wizard/draft";
import { ago, basename, joinPath, megabytes, seconds } from "../lib/format";
import { levelOf, visibleAt } from "../lib/logs";
import {
  mainClassProblem,
  modIdProblem,
  packageProblem,
  registryIdProblem,
  suggestMainClass,
  suggestModId,
  suggestPackage,
  suggestRegistryId,
} from "../lib/naming";
import { defaultOptions, defaultTiling, loadProvider, modelOptions, pickModel, seamVerdict, targetKey } from "../lib/textures";
import type { ImageModel } from "@/core/ipc/bindings/ImageModel";

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

  it("part des versions recommandées", () => {
    expect(emptyDraft.selection).toEqual(EMPTY_SELECTION);
    expect(Object.values(EMPTY_SELECTION).every((v) => v === null)).toBe(true);
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
    expect(megabytes(191_000_000)).toBe("182 Mo");
    expect(megabytes(5 * 1024 * 1024)).toBe("5,0 Mo");
    expect(megabytes(0)).toBe("—");
  });
});

describe("textures", () => {
  const models: ImageModel[] = [
    { id: "a/free:free", name: "Libre", free: true, description: "", textOutput: false, imageInput: false },
    { id: "b/paid", name: "Payant", free: false, description: "", textOutput: true, imageInput: true },
  ];

  it("règle la conversion selon la cible", () => {
    expect(defaultOptions({ kind: "item", id: "ruby" })).toMatchObject({ size: 16, colors: 16, transparent: true, tiling: "none" });
    expect(defaultOptions({ kind: "block", id: "ore", face: null })).toMatchObject({ transparent: false, tiling: "both" });
    expect(defaultOptions({ kind: "icon" }).size).toBe(32);
    expect(targetKey({ kind: "block", id: "ore", face: null })).toBe("block:ore:all");
    expect(targetKey({ kind: "block", id: "log", face: "end" })).toBe("block:log:end");
    expect(targetKey({ kind: "gui", name: "forge" })).toBe("gui:forge");
    expect(targetKey({ kind: "icon" })).toBe("icon");
  });

  it("raccorde chaque face selon son rôle", () => {
    // Herbe : les côtés ne se raccordent qu'en largeur (bande du haut) ; extrémité de bûche : pas du tout.
    expect(defaultTiling("side", "bottomTop")).toBe("horizontal");
    expect(defaultTiling("side", "column")).toBe("both");
    expect(defaultTiling("top", "bottomTop")).toBe("both");
    expect(defaultTiling("end", "column")).toBe("none");
    expect(defaultTiling("north", "faces")).toBe("none");
    // Écran existant sur une toile 256 × 256 : zone d'un conteneur, toile gardée.
    const screen = defaultOptions({ kind: "gui", name: "forge" }, { width: 256, height: 256, layout: null, exists: true });
    expect(screen).toMatchObject({ width: 176, height: 166, atlas: true, transparent: false });
    const button = defaultOptions({ kind: "gui", name: "b" }, { width: 200, height: 20, layout: null, exists: true });
    expect(button).toMatchObject({ width: 200, height: 20, atlas: false });
    expect(seamVerdict(92).tone).toBe("success");
    expect(seamVerdict(40).tone).toBe("danger");
  });

  it("ne propose un modèle payant qu'avec accord", () => {
    expect(modelOptions(models, false).map((o) => [o.hint, o.disabled])).toEqual([
      ["gratuit", false],
      ["payant", true],
    ]);
    expect(modelOptions(models, true)[1]?.disabled).toBe(false);
    expect(pickModel(models, null, false)).toBe("a/free:free");
    expect(pickModel(models, "b/paid", false)).toBe("a/free:free");
    expect(pickModel(models, "b/paid", true)).toBe("b/paid");
    expect(pickModel([models[1]!], null, false)).toBeNull();
  });

  it("présente les modèles Gemini comme facturés par Google", () => {
    const gemini: ImageModel[] = [
      { id: "gemini-3.1-flash-image", name: "Nano Banana 2", free: false, description: "", textOutput: true, imageInput: true },
    ];
    expect(modelOptions(gemini, false, "gemini")).toEqual([
      { value: "gemini-3.1-flash-image", label: "Nano Banana 2", hint: "facturé par Google", disabled: true },
    ]);
    expect(pickModel(gemini, null, true)).toBe("gemini-3.1-flash-image");
    // Sans stockage (tests, navigation privée) : OpenRouter par défaut, sans erreur.
    expect(loadProvider()).toBe("openRouter");
  });

  it("dérive le nom de registre du nom en jeu", () => {
    expect(suggestRegistryId("Épée de rubis")).toBe("epee_de_rubis");
    expect(suggestRegistryId("3 Gemmes")).toBe("x_3_gemmes");
    expect(registryIdProblem("ruby_sword")).toBeNull();
    expect(registryIdProblem("Ruby")).not.toBeNull();
    expect(registryIdProblem("")).not.toBeNull();
  });
});

describe("chemins du projet", () => {
  it("renomme, rattache et protège", async () => {
    const { isBuildScript, isUnder, newPathProblem, parentOf, renamed } = await import("../lib/paths");
    expect(parentOf("src/main/A.java")).toBe("src/main");
    expect(parentOf("build.gradle")).toBe("");
    expect(isUnder("src/main/A.java", "src")).toBe(true);
    expect(isUnder("srcx/A.java", "src")).toBe(false);
    expect(renamed("src/main/A.java", "src/main", "src/client")).toBe("src/client/A.java");
    expect(renamed("README.md", "src", "x")).toBe("README.md");
    expect(isBuildScript("build.gradle")).toBe(true);
    expect(isBuildScript("gradle/wrapper/gradle-wrapper.properties")).toBe(true);
    expect(isBuildScript("src/build.gradle.txt")).toBe(false);
    expect(newPathProblem("src/main/x.json")).toBeNull();
    for (const bad of ["", "../x", "/abs", "C:\\x", "a//b", ".mcstudio/x", ".git"]) {
      expect(newPathProblem(bad)).not.toBeNull();
    }
  });
});

describe("assistant IA", () => {
  it("prépare la demande de correction à partir d'un build en échec", async () => {
    const { fixRequest, defaultSelection, MAX_FIX_ROUNDS } = await import("../lib/assistant");
    const message = fixRequest({
      id: "b1",
      task: "build",
      status: "failed",
      startedAt: "2026-09-24T10:00:00Z",
      durationMs: 1000,
      exitCode: 1,
      command: "gradlew build",
      jar: null,
      dist: null,
      summary: "Gradle n'a pas réussi à compiler le projet.",
      issues: [
        {
          kind: "mapping",
          title: "Classe, méthode ou variable inconnue",
          file: "src/main/java/A.java",
          line: 14,
          column: null,
          message: "cannot find symbol\n  symbol: method maxCount(int)",
          hint: "Vérifiez l'orthographe et l'import.",
        },
      ],
    });
    expect(message).toContain("code de sortie 1");
    expect(message).toContain("- src/main/java/A.java:14 — Classe, méthode ou variable inconnue : cannot find symbol (piste : Vérifiez l'orthographe et l'import.)");
    expect(message).toContain("relance la compilation");
    expect(MAX_FIX_ROUNDS).toBe(3);

    const change = (path: string, conflict: boolean) => ({
      path,
      kind: "modified" as const,
      conflict,
      binary: false,
      before: "a",
      after: "b",
      workPath: path,
    });
    expect([...defaultSelection([change("a", false), change("b", true)])]).toEqual(["a"]);
  });
});
