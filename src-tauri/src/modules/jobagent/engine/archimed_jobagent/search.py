"""Recherche multi-domaines, multi-pays, multi-villes, multi-plateformes.

Une recherche ARCHIMED = le produit de ce qu'on demande : chaque domaine (« designer
graphique », « chargé de communication »…) est cherché dans chaque ville de chaque pays,
sur chaque plateforme retenue. Les requêtes partent en parallèle, les résultats sont
fusionnés, dédoublonnés, filtrés par niveau d'études, puis triés.
"""

from __future__ import annotations

import itertools
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Callable, Iterable

from jobspy import SCRAPERS
from jobspy.model import Country, DescriptionFormat, JobType, ScraperInput, Site

from archimed_jobagent import filters, recruiter
from archimed_jobagent.geo import locate
from archimed_jobagent.model import SOURCE_LABELS, Offer, from_job_post

#: Sources interrogées quand la recherche n'en impose aucune.
DEFAULT_SITES = ["hellowork", "welcometothejungle", "indeed", "linkedin", "google"]

#: Plateformes limitées à un pays : inutile de les interroger ailleurs.
COUNTRY_LOCKED: dict[str, set[str]] = {
    "hellowork": {"france"},
    # ZipRecruiter ne publie qu'aux États-Unis et au Canada.
    "zip_recruiter": {"usa", "canada"},
}

#: Plateformes qui ne connaissent pas de notion de pays : sans ville, il faut leur
#: donner le pays en toutes lettres comme lieu, sinon elles répondent monde entier.
COUNTRY_AS_LOCATION = {
    Site.LINKEDIN,
    Site.GLASSDOOR,
    Site.GOOGLE,
    Site.ZIP_RECRUITER,
}

#: Types de contrat exposés par ARCHIMED.
CONTRACTS: dict[str, JobType] = {
    "fulltime": JobType.FULL_TIME,
    "parttime": JobType.PART_TIME,
    "contract": JobType.CONTRACT,
    "temporary": JobType.TEMPORARY,
    "internship": JobType.INTERNSHIP,
}

#: Libellés courts, pour l'avancement affiché pendant la recherche.
CONTRACT_LABELS: dict[str, str] = {
    "fulltime": "CDI",
    "parttime": "temps partiel",
    "contract": "CDD",
    "temporary": "intérim",
    "internship": "stage",
}


@dataclass
class SearchRequest:
    """Ce que l'utilisateur (ou l'IA) demande."""

    domains: list[str] = field(default_factory=list)
    countries: list[str] = field(default_factory=lambda: ["france"])
    cities: list[str] = field(default_factory=list)
    sites: list[str] = field(default_factory=lambda: list(DEFAULT_SITES))
    education: list[str] = field(default_factory=list)
    include_unknown_education: bool = True
    contracts: list[str] = field(default_factory=list)
    remote: bool = False
    hours_old: int | None = None
    results_per_query: int = 20
    fetch_description: bool = False
    #: Chercher, chez chaque entreprise, une adresse à qui écrire en direct.
    find_recruiter: bool = False
    sort: str = "date"
    proxies: list[str] | None = None

    @classmethod
    def from_json(cls, raw: dict) -> "SearchRequest":
        known = {key: raw[key] for key in raw if key in cls.__dataclass_fields__}
        request = cls(**known)
        request.domains = [d.strip() for d in request.domains if d and d.strip()]
        request.countries = [c.strip().lower() for c in request.countries if c and c.strip()] or [
            "france"
        ]
        request.cities = [c.strip() for c in request.cities if c and c.strip()]
        request.sites = [s.strip().lower() for s in request.sites if s and s.strip()] or list(
            DEFAULT_SITES
        )
        # Ancien format : un seul contrat par recherche.
        legacy = raw.get("contract")
        if legacy and not request.contracts:
            request.contracts = [legacy]
        request.contracts = [c for c in request.contracts if c in CONTRACTS]
        return request


@dataclass
class Query:
    """Une interrogation élémentaire : un domaine, une ville, une plateforme, un contrat.

    Les plateformes ne filtrent que sur un type de contrat à la fois : demander « CDI ou
    alternance » se traduit donc par deux interrogations, fusionnées à l'arrivée.
    """

    site: Site
    domain: str
    country: Country
    city: str | None
    contract: str | None = None

    @property
    def label(self) -> str:
        country = country_name(self.country)
        where = f"{self.city} ({country})" if self.city else country
        what = f"{self.domain} ({CONTRACT_LABELS[self.contract]})" if self.contract else self.domain
        return f"{SOURCE_LABELS.get(self.site.value, self.site.value)} · {what} · {where}"


def plan(request: SearchRequest) -> list[Query]:
    """Développe la demande en interrogations élémentaires."""
    queries: list[Query] = []
    for site_name, domain, country_name in itertools.product(
        request.sites, request.domains or [""], request.countries
    ):
        site = _site(site_name)
        country = _country(country_name)
        if site is None or country is None:
            continue
        locked = COUNTRY_LOCKED.get(site.value)
        if locked and country.value[0].split(",")[0] not in locked:
            continue
        cities = _cities_of(request, country_name) or [None]
        contracts: list[str | None] = list(request.contracts) or [None]
        for city in cities:
            for contract in contracts:
                queries.append(
                    Query(site=site, domain=domain, country=country, city=city, contract=contract)
                )
    return queries


def run(
    request: SearchRequest,
    progress: Callable[[int, int, str], None] | None = None,
    workers: int = 4,
) -> list[Offer]:
    """Exécute la recherche complète et renvoie les offres prêtes à afficher."""
    queries = plan(request)
    collected: list[Offer] = []
    done = 0

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(_scrape, query, request): query for query in queries}
        for future in as_completed(futures):
            query = futures[future]
            done += 1
            try:
                found = future.result()
            except Exception as error:  # une plateforme en panne n'arrête pas les autres
                found = []
                if progress:
                    progress(done, len(queries), f"{query.label} — échec : {error}")
            else:
                if progress:
                    progress(done, len(queries), f"{query.label} — {len(found)} offre(s)")
            collected.extend(found)

    offers = filters.apply_education(collected)
    offers = filters.deduplicate(offers)
    offers = filters.keep_education(
        offers, request.education, request.include_unknown_education
    )
    offers = filters.sort_offers(offers, request.sort)

    # Deuxième temps, facultatif : une adresse de contact par entreprise. Il vient
    # après le tri pour ne visiter qu'une fois chaque site, et jamais pour une annonce
    # écartée entre-temps.
    if request.find_recruiter:
        recruiter.enrich(offers, progress=progress, workers=max(1, workers))
    return offers


def _scrape(query: Query, request: SearchRequest) -> list[Offer]:
    scraper_class = SCRAPERS.get(query.site)
    if scraper_class is None:
        return []
    scraper = scraper_class(proxies=request.proxies)

    location = query.city
    if not location and query.site in COUNTRY_AS_LOCATION:
        location = country_name(query.country)
    scraper_input = ScraperInput(
        site_type=[query.site],
        search_term=query.domain or None,
        google_search_term=_google_term(query),
        location=location,
        country=query.country,
        distance=50,
        is_remote=request.remote,
        job_type=CONTRACTS.get(query.contract or ""),
        results_wanted=request.results_per_query,
        hours_old=request.hours_old,
        description_format=DescriptionFormat.MARKDOWN,
        linkedin_fetch_description=request.fetch_description,
    )
    response = scraper.scrape(scraper_input)
    offers = [from_job_post(post, query.site, query.domain or None) for post in response.jobs]
    return [place(offer, query.country) for offer in offers]


def place(offer: Offer, country: Country) -> Offer:
    """Pose l'annonce sur la carte : la ville quand on la connaît, le pays sinon."""
    code = country_iso(country)
    found = locate(offer.city, code)
    if found:
        offer.latitude, offer.longitude, offer.geo = found
    return offer


def country_iso(country: Country) -> str:
    """Indicatif ISO du pays, celui-là même que l'interface utilise."""
    name = country.value[0].split(",")[0]
    code = COUNTRY_CODES.get(name)
    if code:
        return code
    raw = country.value[1].split(":")[0].upper() if len(country.value) > 1 else ""
    return raw if len(raw) == 2 and raw.isalpha() else ""


def country_name(country: Country) -> str:
    """Nom lisible d'un pays (« France », « Netherlands »)."""
    name = country.value[0].split(",")[0]
    return name.upper() if name in ("usa", "uk") else name.title()


def _google_term(query: Query) -> str | None:
    """Google Jobs veut une phrase, pas des mots-clés."""
    if query.site is not Site.GOOGLE:
        return None
    where = query.city or query.country.value[0].split(",")[0]
    return f"{query.domain} jobs near {where}".strip()


def _cities_of(request: SearchRequest, country: str) -> list[str]:
    """Les villes peuvent être globales (`Paris`) ou rattachées (`france:Paris`)."""
    chosen: list[str] = []
    for city in request.cities:
        if ":" in city:
            prefix, name = city.split(":", 1)
            if prefix.strip().lower() == country:
                chosen.append(name.strip())
        else:
            chosen.append(city)
    return chosen


def _site(name: str) -> Site | None:
    for site in Site:
        if site.value == name:
            return site
    return None


def _country(name: str) -> Country | None:
    for country in Country:
        if name in [part.strip() for part in country.value[0].split(",")]:
            return country
    return None


def available_sites() -> list[dict]:
    """Plateformes disponibles, pour l'interface et pour les IA."""
    return [
        {
            "id": site.value,
            "label": SOURCE_LABELS.get(site.value, site.value),
            "countries": sorted(COUNTRY_LOCKED.get(site.value, [])) or "all",
        }
        for site in SCRAPERS
    ]


#: JobSpy range un sous-domaine là où on attend un indicatif de pays : « usa » vaut
#: « www », le Royaume-Uni « uk ». Ces cas sont corrigés ici, les autres sont vérifiés.
COUNTRY_CODES: dict[str, str] = {
    "usa": "US",
    "uk": "GB",
    "malaysia": "MY",
    "malta": "MT",
    "south korea": "KR",
    "hong kong": "HK",
    "new zealand": "NZ",
    "south africa": "ZA",
    "saudi arabia": "SA",
    "united arab emirates": "AE",
    "czech republic": "CZ",
}


def available_countries() -> list[dict]:
    """Pays acceptés.

    `id` est le nom anglais attendu par les plateformes ; `code` est l'indicatif ISO à
    deux lettres, avec lequel l'interface affiche le pays dans la langue de la personne.
    Un indicatif non conforme est renvoyé vide plutôt qu'approximatif : l'interface
    retombe alors sur le nom anglais.
    """
    countries = []
    for country in Country:
        if country.name in ("US_CANADA", "WORLDWIDE"):
            continue
        parts = country.value
        name = parts[0].split(",")[0]
        countries.append({"id": name, "code": country_iso(country)})
    return sorted(countries, key=lambda item: item["id"])


def available_education() -> list[dict]:
    return [{"id": key, "label": label} for key, label in filters.LEVELS]


def iter_offers(offers: Iterable[Offer]) -> list[dict]:
    return [offer.to_json() for offer in offers]
