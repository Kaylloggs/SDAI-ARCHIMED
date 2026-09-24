import { describe, expect, it } from "vitest";
import { countryLabel } from "../components/SearchForm";

describe("countryLabel", () => {
  it("traduit un indicatif ISO", () => {
    expect(countryLabel("france", "FR")).toBe("France");
    expect(countryLabel("netherlands", "NL")).toBe("Pays-Bas");
  });

  it("garde le nom d'origine quand l'indicatif est absent", () => {
    expect(countryLabel("bahrain", "")).toBe("Bahrain");
  });

  it("ne casse pas sur un indicatif approximatif", () => {
    // JobSpy range parfois un sous-domaine ici : « www » pour les États-Unis.
    // `Intl.DisplayNames.of` lève alors, ce qui faisait tomber tout le module.
    expect(countryLabel("usa", "WWW")).toBe("Usa");
    expect(countryLabel("malta", "MALTA")).toBe("Malta");
    expect(countryLabel("belgium", "fr:be")).toBe("Belgium");
  });
});
