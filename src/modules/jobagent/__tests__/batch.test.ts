import { describe, expect, it } from "vitest";
import { buildBatch, directEmail, offerEmail } from "../lib/batch";
import type { Application, Offer } from "../types";

function offer(patch: Partial<Offer> = {}): Offer {
  return {
    id: "1",
    source: "hellowork",
    source_label: "HelloWork",
    title: "Graphiste",
    company: "Studio Kite",
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
    domain: null,
    found_at: "2026-09-23T10:00:00",
    ...patch,
  };
}

const sent: Application = {
  offerId: "1",
  title: "Graphiste",
  company: "Studio Kite",
  url: "https://exemple.test/1",
  status: "sent",
  updatedAt: "2026-09-20T10:00:00",
};

describe("composition d'un lot de candidatures", () => {
  it("prépare la candidature puis le message direct, dans cet ordre", () => {
    const batch = buildBatch(
      [
        offer({
          emails: ["jobs@studiokite.fr"],
          recruiter_email: "rh@studiokite.fr",
          recruiter_source: "site",
        }),
      ],
      [],
    );
    expect(batch.map((item) => item.channel)).toEqual(["offer", "direct"]);
    expect(batch[0]).toMatchObject({ to: "jobs@studiokite.fr", status: "pending" });
    expect(batch[1]).toMatchObject({ to: "rh@studiokite.fr", status: "pending" });
    expect(batch[0]?.key).not.toBe(batch[1]?.key);
  });

  it("ne double pas le message quand le contact vient déjà de l'annonce", () => {
    const batch = buildBatch(
      [
        offer({
          emails: ["rh@studiokite.fr"],
          recruiter_email: "rh@studiokite.fr",
          recruiter_source: "annonce",
        }),
      ],
      [],
    );
    expect(batch).toHaveLength(1);
    expect(batch[0]?.channel).toBe("offer");
  });

  it("écarte l'annonce sans adresse, mais garde le contact trouvé sur le site", () => {
    const batch = buildBatch(
      [offer({ recruiter_email: "rh@studiokite.fr", recruiter_source: "site" })],
      [],
    );
    expect(batch[0]).toMatchObject({
      channel: "offer",
      status: "skipped",
      error: "pas d'adresse dans l'annonce",
    });
    expect(batch[1]).toMatchObject({ channel: "direct", status: "pending" });
  });

  it("ne repostule pas, mais laisse partir le message direct", () => {
    const batch = buildBatch(
      [
        offer({
          emails: ["jobs@studiokite.fr"],
          recruiter_email: "rh@studiokite.fr",
          recruiter_source: "site",
        }),
      ],
      [sent],
    );
    expect(batch[0]).toMatchObject({ status: "skipped", error: "déjà envoyée" });
    expect(batch[1]).toMatchObject({ status: "pending" });
  });

  it("ne prévient le contact direct qu'une seule fois", () => {
    const batch = buildBatch(
      [offer({ recruiter_email: "rh@studiokite.fr", recruiter_source: "site" })],
      [{ ...sent, directSentAt: "2026-09-21T09:00:00" }],
    );
    expect(batch[1]).toMatchObject({ status: "skipped", error: "contact déjà prévenu" });
  });

  it("lit les adresses d'une offre sans contact trouvé", () => {
    const plain = offer({ emails: ["jobs@studiokite.fr"] });
    expect(offerEmail(plain)).toBe("jobs@studiokite.fr");
    expect(directEmail(plain)).toBeNull();
    expect(offerEmail(offer())).toBeNull();
  });
});
