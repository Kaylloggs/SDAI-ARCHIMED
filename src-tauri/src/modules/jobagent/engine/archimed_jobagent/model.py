"""Forme stable d'une offre, telle qu'ARCHIMED et les IA la manipulent.

Les scrapers renvoient des `JobPost` hétérogènes ; ici tout est aplati, daté en ISO et
nommé pareil quelle que soit la plateforme.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from typing import Any

from jobspy.model import JobPost, Site

#: Libellés lisibles des plateformes.
SOURCE_LABELS: dict[str, str] = {
    "linkedin": "LinkedIn",
    "indeed": "Indeed",
    "glassdoor": "Glassdoor",
    "zip_recruiter": "ZipRecruiter",
    "google": "Google Jobs",
    "hellowork": "HelloWork",
    "welcometothejungle": "Welcome to the Jungle",
}


@dataclass
class Offer:
    """Une annonce, prête à afficher et à transmettre à une IA."""

    id: str
    source: str
    source_label: str
    title: str
    company: str | None
    url: str
    apply_url: str | None = None
    company_url: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    location: str | None = None
    remote: bool = False
    contract: str | None = None
    salary_min: float | None = None
    salary_max: float | None = None
    salary_currency: str | None = None
    salary_period: str | None = None
    posted: str | None = None
    education: str | None = None
    education_label: str | None = None
    description: str | None = None
    emails: list[str] = field(default_factory=list)
    #: Contact trouvé chez l'entreprise quand la recherche l'a demandé.
    recruiter_email: str | None = None
    recruiter_emails: list[str] = field(default_factory=list)
    #: `annonce` (adresse déjà dans l'offre) ou `site` (trouvée sur le site).
    recruiter_source: str | None = None
    #: Position pour la carte : coordonnées et finesse (`city` ou `country`).
    latitude: float | None = None
    longitude: float | None = None
    geo: str | None = None
    #: Terme de recherche qui a ramené l'offre — sert à regrouper par domaine.
    domain: str | None = None
    found_at: str = ""

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def _iso(value: date | datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()[:10]


def stable_id(url: str, title: str, company: str | None) -> str:
    """Identifiant reproductible : une même annonce garde son id d'une recherche à l'autre."""
    seed = f"{_normalize_url(url)}|{title.lower().strip()}|{(company or '').lower().strip()}"
    return hashlib.sha1(seed.encode("utf8")).hexdigest()[:16]


def _normalize_url(url: str) -> str:
    """URL sans paramètres de suivi : deux liens identiques ne font qu'une offre."""
    url = re.sub(r"[?#].*$", "", url or "")
    return url.rstrip("/").lower()


def from_job_post(post: JobPost, site: Site, domain: str | None) -> Offer:
    location = post.location.display_location() if post.location else None
    compensation = post.compensation
    contract = None
    if post.job_type:
        contract = ", ".join(kind.value[0] for kind in post.job_type)

    return Offer(
        id=stable_id(post.job_url, post.title, post.company_name),
        source=site.value,
        source_label=SOURCE_LABELS.get(site.value, site.value),
        title=post.title,
        company=post.company_name,
        url=post.job_url,
        apply_url=post.job_url_direct,
        company_url=post.company_url,
        city=post.location.city if post.location else None,
        state=post.location.state if post.location else None,
        country=_country_name(post),
        location=location,
        remote=bool(post.is_remote),
        contract=contract,
        salary_min=compensation.min_amount if compensation else None,
        salary_max=compensation.max_amount if compensation else None,
        salary_currency=compensation.currency if compensation else None,
        salary_period=(
            compensation.interval.value
            if compensation and compensation.interval
            else None
        ),
        posted=_iso(post.date_posted),
        education=None,
        description=post.description,
        emails=post.emails or [],
        domain=domain,
        found_at=datetime.now().isoformat(timespec="seconds"),
    )


def _country_name(post: JobPost) -> str | None:
    if not post.location or not post.location.country:
        return None
    country = post.location.country
    if isinstance(country, str):
        return country.title()
    name = country.value[0].split(",")[0]
    return name.upper() if name in ("usa", "uk") else name.title()
