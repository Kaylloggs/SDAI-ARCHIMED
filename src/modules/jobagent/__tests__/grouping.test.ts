import { describe, expect, it } from "vitest";
import { bucketOf, groupKey, sortGroups } from "../components/OfferList";
import type { Offer } from "../types";

function offer(patch: Partial<Offer> = {}): Offer {
  return {
    id: "x",
    source: "hellowork",
    source_label: "HelloWork",
    title: "Graphiste",
    company: "Studio",
    url: "https://exemple.test/1",
    apply_url: null,
    company_url: null,
    city: "Paris",
    state: null,
    country: "France",
    location: "Paris, France",
    remote: false,
    contract: "fulltime",
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    posted: null,
    education: null,
    education_label: null,
    description: null,
    emails: [],
    latitude: null,
    longitude: null,
    geo: null,
    domain: "design",
    found_at: "",
    ...patch,
  };
}

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

describe("regroupement des annonces", () => {
  it("range par fraîcheur", () => {
    expect(bucketOf(offer({ posted: daysAgo(0) }))).toBe("Aujourd'hui");
    expect(bucketOf(offer({ posted: daysAgo(3) }))).toBe("Cette semaine");
    expect(bucketOf(offer({ posted: daysAgo(20) }))).toBe("Ce mois-ci");
    expect(bucketOf(offer({ posted: daysAgo(90) }))).toBe("Plus ancien");
    expect(bucketOf(offer({ posted: null }))).toBe("Date inconnue");
  });

  it("nomme chaque section selon le critère", () => {
    expect(groupKey(offer(), "domain")).toBe("design");
    expect(groupKey(offer(), "company")).toBe("Studio");
    expect(groupKey(offer(), "source")).toBe("HelloWork");
    expect(groupKey(offer(), "contract")).toBe("CDI / temps plein");
    expect(groupKey(offer({ city: null, country: "France" }), "city")).toBe("France");
    expect(groupKey(offer({ domain: null }), "domain")).toBe("Autres");
  });

  it("classe les sections de fraîcheur dans l'ordre du temps", () => {
    const entries: Array<[string, Offer[]]> = [
      ["Plus ancien", [offer()]],
      ["Aujourd'hui", [offer(), offer()]],
      ["Cette semaine", [offer()]],
    ];
    expect(sortGroups(entries, "freshness").map(([key]) => key)).toEqual([
      "Aujourd'hui",
      "Cette semaine",
      "Plus ancien",
    ]);
  });

  it("classe les autres sections par taille décroissante", () => {
    const entries: Array<[string, Offer[]]> = [
      ["Petite", [offer()]],
      ["Grosse", [offer(), offer(), offer()]],
      ["Moyenne", [offer(), offer()]],
    ];
    expect(sortGroups(entries, "company").map(([key]) => key)).toEqual([
      "Grosse",
      "Moyenne",
      "Petite",
    ]);
  });
});
