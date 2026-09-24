"""Vérifications du moteur, sans réseau : `python -m archimed_jobagent.selftest`.

Elles couvrent ce qui se casse en silence : la déduction du niveau d'études, le
dédoublonnage entre plateformes, et le développement d'une demande en interrogations.
"""

from __future__ import annotations

import sys

from archimed_jobagent import filters, search
from archimed_jobagent.model import Offer


def offer(**overrides) -> Offer:
    base = dict(
        id="x",
        source="hellowork",
        source_label="HelloWork",
        title="Développeur",
        company="Studio",
        url="https://exemple.test/offre/1",
    )
    base.update(overrides)
    return Offer(**base)


def check_education() -> None:
    cases = [
        ("Développeur Bac+5 confirmé", "bac5"),
        ("Assistant communication — BTS exigé", "bac2"),
        ("Chargé de projet, licence pro appréciée", "bac3"),
        ("Manutentionnaire, sans diplôme", "none"),
        ("Chercheur, doctorat en physique", "phd"),
        ("Graphiste motion", None),
    ]
    for title, expected in cases:
        found = filters.detect(offer(title=title))
        assert found == expected, f"{title!r} → {found} (attendu {expected})"

    # Un « bac+5 » ne doit pas être rangé en « bac » à cause du mot « bac ».
    assert filters.detect(offer(title="Ingénieur bac+5")) == "bac5"


def check_deduplicate() -> None:
    same_url = [
        offer(id="a", url="https://exemple.test/offre/1?utm_source=x"),
        offer(id="b", url="https://exemple.test/offre/1/"),
    ]
    assert len(filters.deduplicate(same_url)) == 1

    cross_site = [
        offer(id="a", source="indeed", city="Paris", description=None),
        offer(id="b", source="linkedin", city="Paris", description="Texte complet"),
        offer(id="c", title="Autre poste", url="https://exemple.test/offre/2"),
    ]
    kept = filters.deduplicate(cross_site)
    assert len(kept) == 2, kept
    # La version la plus complète gagne, à la place de la première.
    assert kept[0].description == "Texte complet"

    # Postes distincts : rien ne doit fusionner.
    distinct = [
        offer(id=str(index), title=f"Poste {index}", url=f"https://exemple.test/o/{index}")
        for index in range(5)
    ]
    assert len(filters.deduplicate(distinct)) == 5

    # Même poste, même entreprise, même ville, URL différentes : un seul doublon.
    republished = [
        offer(id="d", source="indeed", city="Lyon", url="https://a.test/1"),
        offer(id="e", source="linkedin", city="Lyon", url="https://b.test/2"),
    ]
    assert len(filters.deduplicate(republished)) == 1


def check_filter_levels() -> None:
    offers = [
        offer(id="a", education="bac5"),
        offer(id="b", education="bac2"),
        offer(id="c", education=None),
    ]
    assert len(filters.keep_education(offers, ["bac5"], include_unknown=False)) == 1
    assert len(filters.keep_education(offers, ["bac5"], include_unknown=True)) == 2
    assert len(filters.keep_education(offers, [], include_unknown=False)) == 3


def check_plan() -> None:
    request = search.SearchRequest.from_json(
        {
            "domains": ["design", "communication"],
            "countries": ["france", "netherlands"],
            "cities": ["Paris", "netherlands:Amsterdam"],
            "sites": ["hellowork", "welcometothejungle"],
        }
    )
    queries = search.plan(request)
    labels = {(query.site.value, query.domain, query.country.value[0], query.city) for query in queries}

    # HelloWork ne publie qu'en France : rien pour les Pays-Bas.
    assert not any(site == "hellowork" and country == "netherlands" for site, _, country, _ in labels)
    # Une ville préfixée ne part que vers son pays.
    assert ("welcometothejungle", "design", "netherlands", "Amsterdam") in labels
    assert ("welcometothejungle", "design", "netherlands", "Paris") in labels
    assert ("welcometothejungle", "design", "france", "Amsterdam") not in labels


def check_contracts() -> None:
    """Plusieurs types de contrat = plusieurs interrogations : les plateformes n'en
    acceptent qu'un à la fois."""
    request = search.SearchRequest.from_json(
        {
            "domains": ["design"],
            "countries": ["france"],
            "cities": ["Paris"],
            "sites": ["hellowork"],
            "contracts": ["fulltime", "internship"],
        }
    )
    queries = search.plan(request)
    assert len(queries) == 2, queries
    assert {query.contract for query in queries} == {"fulltime", "internship"}

    # Aucun contrat : une seule interrogation, sans filtre.
    request.contracts = []
    assert len(search.plan(request)) == 1

    # Ancien format (un seul contrat) toujours accepté.
    legacy = search.SearchRequest.from_json(
        {"domains": ["design"], "sites": ["hellowork"], "contract": "internship"}
    )
    assert legacy.contracts == ["internship"], legacy.contracts

    # Valeur inconnue : ignorée plutôt que transmise telle quelle.
    unknown = search.SearchRequest.from_json(
        {"domains": ["design"], "sites": ["hellowork"], "contracts": ["cdi-cadre"]}
    )
    assert unknown.contracts == [], unknown.contracts


def check_country_codes() -> None:
    """Un indicatif approximatif faisait planter l'affichage des pays côté interface."""
    import re

    countries = search.available_countries()
    assert len(countries) > 50, countries

    for country in countries:
        code = country["code"]
        assert code == "" or re.fullmatch(r"[A-Z]{2}", code), country

    by_id = {country["id"]: country["code"] for country in countries}
    # Cas que JobSpy renseigne avec un sous-domaine plutôt qu'un indicatif.
    assert by_id["usa"] == "US", by_id["usa"]
    assert by_id["uk"] == "GB", by_id["uk"]
    assert by_id["malta"] == "MT", by_id["malta"]
    assert by_id["france"] == "FR", by_id["france"]


def check_geo() -> None:
    """Les annonces doivent tomber au bon endroit sur la carte, sans réseau."""
    from archimed_jobagent.geo import locate

    paris = locate("Paris 15e", "FR")
    assert paris and paris[2] == "city", paris
    assert 48 < paris[0] < 49 and 2 < paris[1] < 3, paris

    # Quartier accolé, ville composée, casse et accents.
    assert locate("Amsterdam-Zuidoost", "NL")[2] == "city"
    assert locate("SAINT-ÉTIENNE", "FR")[2] == "city"

    # Ville inconnue : on retombe sur le pays plutôt que de perdre l'annonce.
    fallback = locate("Bourg-Perdu", "PT")
    assert fallback and fallback[2] == "country", fallback

    # Pays inconnu : rien, et surtout pas de coordonnées inventées.
    assert locate("Lisbonne", "ZZ") is None


def check_sort() -> None:
    offers = [
        offer(id="a", posted="2026-01-10", title="B"),
        offer(id="b", posted="2026-03-01", title="A"),
        offer(id="c", posted=None, title="C"),
    ]
    order = [item.id for item in filters.sort_offers(offers, "date")]
    assert order[0] == "b", order
    assert order[-1] == "c", order


def check_recruiter() -> None:
    """Le choix d'une adresse de contact, sans toucher au réseau."""
    from archimed_jobagent import recruiter

    # Le recrutement passe devant l'accueil, qui passe devant le tout-venant.
    ordered = recruiter.rank(
        ["Info@studio.fr", "contact@studio.fr", "recrutement@studio.fr", "j.durand@studio.fr"],
        "studio.fr",
    )
    assert ordered[0] == "recrutement@studio.fr", ordered
    assert ordered[1] == "contact@studio.fr", ordered

    # Adresses sans interlocuteur, plateformes et faux positifs : écartés.
    for bad in (
        "no-reply@studio.fr",
        "dpo@studio.fr",
        "informatique.libertes@studio.fr",
        "candidature@indeed.com",
        "sprite@2x.png",
        "rh@welcometothejungle.com",
        "xxxxx@exemple.com",
        "nom@monsite.fr",
    ):
        assert not recruiter.acceptable(bad), bad

    # Une adresse au nom de l'entreprise passe devant une boîte personnelle.
    assert recruiter.score("contact@studio.fr", "studio.fr") > recruiter.score(
        "contact@gmail.com", "studio.fr"
    )

    # L'agence qui a fait le site traîne souvent dans le pied de page : elle ne passe
    # qu'à défaut de mieux.
    ordered = recruiter.rank(["contact@agenceweb.fr", "info@studio.fr"], "studio.fr")
    assert ordered[0] == "info@studio.fr", ordered

    # Le nom de l'entreprise doit se retrouver dans le domaine, ou sur sa page.
    assert recruiter.belongs_to("Studio Kite SAS", "studiokite.fr")
    assert not recruiter.belongs_to("Studio Kite", "assurances-durand.fr")
    assert recruiter.belongs_to("Studio Kite", "sk-group.com", "Bienvenue chez Studio Kite")

    # Lien enveloppé par Bing : l'adresse réelle est en base64.
    wrapped = "https://www.bing.com/ck/a?!&&u=a1aHR0cHM6Ly9uYW1zYS5jb20v&ntb=1"
    assert recruiter._unwrap(wrapped) == "https://namsa.com/", recruiter._unwrap(wrapped)

    # Adresse écrite « contact (at) studio (dot) fr » pour tromper les robots.
    html = "<p>Ecrivez a contact (at) studio (dot) fr</p>"
    assert "contact@studio.fr" in recruiter._emails_in(html)

    # Domaine d'un site : sans `www`, et jamais celui d'une plateforme d'annonces.
    assert recruiter.site_domain("https://www.studio.fr/jobs?x=1") == "studio.fr"
    assert recruiter.site_domain("https://fr.linkedin.com/company/studio") is None
    assert recruiter.site_domain(None) is None

    # L'adresse donnée par l'annonce suffit : aucun site n'est visité.
    from_offer = recruiter.find("Studio", None, ["Recrutement@Studio.fr"])
    assert from_offer["source"] == "annonce", from_offer
    assert from_offer["best"] == "recrutement@studio.fr", from_offer


def main() -> int:
    checks = [
        check_education,
        check_deduplicate,
        check_filter_levels,
        check_plan,
        check_contracts,
        check_country_codes,
        check_geo,
        check_recruiter,
        check_sort,
    ]
    for check in checks:
        try:
            check()
        except AssertionError as error:
            print(f"ÉCHEC {check.__name__} : {error}")
            return 1
        print(f"ok   {check.__name__}")
    print(f"{len(checks)} vérifications passées.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
