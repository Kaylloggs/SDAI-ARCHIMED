import { describe, expect, it } from "vitest";
import { cvFor, languageOf } from "../lib/cv";
import type { Profile } from "../types";

const fr = { text: "CV français", name: "cv-fr.pdf" };
const en = { text: "English resume", name: "cv-en.pdf" };

describe("choix du CV selon le pays", () => {
  it("écrit en français pour la zone francophone", () => {
    expect(languageOf({ country: "France" })).toBe("fr");
    expect(languageOf({ country: "Belgium" })).toBe("fr");
    expect(languageOf({ country: "Switzerland" })).toBe("fr");
  });

  it("écrit en anglais partout ailleurs", () => {
    expect(languageOf({ country: "Netherlands" })).toBe("en");
    expect(languageOf({ country: "Canada" })).toBe("en");
    expect(languageOf({ country: "Portugal" })).toBe("en");
  });

  it("retient le français quand le pays est inconnu", () => {
    expect(languageOf({ country: null })).toBe("fr");
  });

  it("prend le CV de la langue attendue", () => {
    const profile: Profile = { cvs: { fr, en } };
    expect(cvFor({ country: "France" }, profile)).toMatchObject({ language: "fr", fallback: false });
    expect(cvFor({ country: "Netherlands" }, profile)).toMatchObject({
      language: "en",
      fallback: false,
    });
  });

  it("retombe sur l'autre CV et le signale", () => {
    const onlyFrench: Profile = { cvs: { fr } };
    const chosen = cvFor({ country: "Netherlands" }, onlyFrench);
    expect(chosen.language).toBe("fr");
    expect(chosen.fallback).toBe(true);
    expect(chosen.cv?.name).toBe("cv-fr.pdf");
  });

  it("ne renvoie rien quand aucun CV n'est importé", () => {
    expect(cvFor({ country: "France" }, {})).toMatchObject({ cv: null, fallback: false });
    // Une fiche sans texte extrait ne compte pas : elle ne servirait à rien à la rédaction.
    expect(cvFor({ country: "France" }, { cvs: { fr: { name: "vide.pdf" } } }).cv).toBeNull();
  });
});
