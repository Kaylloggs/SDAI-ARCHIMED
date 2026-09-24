"""Welcome to the Jungle — via son index de recherche public (ajout ARCHIMED à JobSpy).

Le site est une application cliente : la recherche passe par Algolia, avec les
identifiants publics que le site sert lui-même à ses visiteurs
(`https://www.welcometothejungle.com/api/env`).

On interroge donc Algolia directement, avec ces identifiants en constante. Ils ne sont
relus sur le site que si Algolia les refuse (rotation de clé), et le résultat est mis en
cache : le site public n'est sollicité qu'exceptionnellement.

C'est la seule source qui publie le niveau d'études demandé (`education_level`).
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, urlencode

from jobspy.model import (
    Compensation,
    CompensationInterval,
    Country,
    DescriptionFormat,
    JobPost,
    JobResponse,
    JobType,
    Location,
    Scraper,
    ScraperInput,
    Site,
)
from jobspy.util import create_logger, create_session, markdown_converter

log = create_logger("WelcomeToTheJungle")

SITE = "https://www.welcometothejungle.com"
ENV = f"{SITE}/api/env"
INDEX = "wk_cms_jobs_production"
#: Identifiants publics de recherche (ceux du site, servis à tout visiteur).
DEFAULT_APP_ID = "CSEKHVMS53"
DEFAULT_API_KEY = "4bd8f6215d0cc52b26430765769e65a0"
#: Algolia plafonne à 100 résultats par requête.
PER_PAGE = 50

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Origin": SITE,
    "Referer": f"{SITE}/",
}

#: Contrats WTTJ → vocabulaire JobSpy.
CONTRACTS = {
    "FULL_TIME": JobType.FULL_TIME,
    "PART_TIME": JobType.PART_TIME,
    "TEMPORARY": JobType.TEMPORARY,
    "INTERNSHIP": JobType.INTERNSHIP,
    "APPRENTICESHIP": JobType.INTERNSHIP,
    "VIE": JobType.CONTRACT,
    "FREELANCE": JobType.CONTRACT,
    "OTHER": JobType.OTHER,
}

#: Filtre `contract_type` d'Algolia.
CONTRACT_FILTER = {
    JobType.FULL_TIME: "FULL_TIME",
    JobType.PART_TIME: "PART_TIME",
    JobType.TEMPORARY: "TEMPORARY",
    JobType.INTERNSHIP: "INTERNSHIP",
    JobType.CONTRACT: "FREELANCE",
}

#: Périodes de salaire WTTJ → intervalles JobSpy.
PERIODS = {
    "yearly": CompensationInterval.YEARLY,
    "monthly": CompensationInterval.MONTHLY,
    "weekly": CompensationInterval.WEEKLY,
    "daily": CompensationInterval.DAILY,
    "hourly": CompensationInterval.HOURLY,
}


class WelcomeToTheJungle(Scraper):
    def __init__(self, proxies=None, ca_cert=None, user_agent=None):
        super().__init__(Site.WELCOME_TO_THE_JUNGLE, proxies=proxies, ca_cert=ca_cert)
        self.session = create_session(
            proxies=proxies, ca_cert=ca_cert, is_tls=False, has_retry=True, delay=1
        )
        self.session.headers.update(HEADERS)
        self._credentials: tuple[str, str] | None = None

    def scrape(self, scraper_input: ScraperInput) -> JobResponse:
        credentials = self._algolia()
        if credentials is None:
            return JobResponse(jobs=[])
        app_id, api_key = credentials

        jobs: list[JobPost] = []
        page = (scraper_input.offset or 0) // PER_PAGE
        while len(jobs) < scraper_input.results_wanted and page < 20:
            hits = self._query(app_id, api_key, scraper_input, page)
            if not hits:
                break
            for hit in hits:
                job = self._job(hit, scraper_input)
                if job is not None and self._fresh(job, scraper_input):
                    jobs.append(job)
                if len(jobs) >= scraper_input.results_wanted:
                    break
            if len(hits) < PER_PAGE:
                break
            page += 1
        return JobResponse(jobs=jobs)

    @staticmethod
    def _office(hit: dict, scraper_input: ScraperInput) -> dict:
        """Bureau à retenir : celui du pays cherché quand l'entreprise en a plusieurs.

        Une annonce publiée pour trois bureaux remonte sur chacun des pays ; sans ce tri,
        une recherche aux Pays-Bas affichait l'adresse belge de l'entreprise.
        """
        offices = hit.get("offices") or []
        if scraper_input.country and scraper_input.country != Country.WORLDWIDE:
            wanted = scraper_input.country.value[0].split(",")[0].lower()
            for office in offices:
                if str(office.get("country") or "").lower() == wanted:
                    return office
        return hit.get("office") or (offices[0] if offices else {})

    @staticmethod
    def _fresh(job: JobPost, scraper_input: ScraperInput) -> bool:
        """Annonce assez récente ? Une offre sans date reste affichée."""
        if not scraper_input.hours_old or not job.date_posted:
            return True
        age = (datetime.now().date() - job.date_posted).days * 24
        return age <= scraper_input.hours_old

    def _algolia(self) -> tuple[str, str] | None:
        """Identifiants de recherche : cache local, sinon valeurs publiques connues."""
        if self._credentials:
            return self._credentials
        cache = _cache_file()
        if cache.exists():
            try:
                saved = json.loads(cache.read_text(encoding="utf8"))
                self._credentials = (saved["app_id"], saved["api_key"])
                return self._credentials
            except Exception:
                pass
        self._credentials = (DEFAULT_APP_ID, DEFAULT_API_KEY)
        return self._credentials

    def _refresh(self) -> tuple[str, str] | None:
        """Relit les identifiants sur le site — uniquement si Algolia a refusé les nôtres."""
        try:
            raw = self.session.get(ENV, timeout=30).text
            # La réponse est un fragment JavaScript : `window.env = { … };`
            start, end = raw.index("{"), raw.rindex("}") + 1
            env = json.loads(raw[start:end])
            self._credentials = (
                env["PUBLIC_ALGOLIA_APPLICATION_ID"],
                env["PUBLIC_ALGOLIA_API_KEY_CLIENT"],
            )
            cache = _cache_file()
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(
                json.dumps({"app_id": self._credentials[0], "api_key": self._credentials[1]}),
                encoding="utf8",
            )
            return self._credentials
        except Exception as error:
            log.warning(f"identifiants de recherche WTTJ illisibles : {error}")
            return None

    def _query(
        self, app_id: str, api_key: str, scraper_input: ScraperInput, page: int
    ) -> list[dict]:
        filters = []
        if scraper_input.country and scraper_input.country != Country.WORLDWIDE:
            country = scraper_input.country.value[0].split(",")[0].title()
            filters.append(f'offices.country:"{country}"')
        if scraper_input.location:
            # La ville est un attribut à facettes : correspondance exacte.
            filters.append(f'offices.city:"{scraper_input.location.split(",")[0].strip()}"')
        if scraper_input.job_type and scraper_input.job_type in CONTRACT_FILTER:
            filters.append(f'contract_type:"{CONTRACT_FILTER[scraper_input.job_type]}"')
        if scraper_input.is_remote:
            filters.append('(remote:"fulltime" OR remote:"total")')
        # Pas de filtre de date côté Algolia : l'index ne porte que `published_at`, en
        # texte, qui ne se compare pas. La fraîcheur est appliquée à la réception.

        params = {
            "query": scraper_input.search_term or "",
            "hitsPerPage": PER_PAGE,
            "page": page,
        }
        if filters:
            params["filters"] = " AND ".join(filters)

        body = json.dumps(
            {"requests": [{"indexName": INDEX, "params": urlencode(params, quote_via=quote)}]}
        )
        try:
            response = self._post(app_id, api_key, body, scraper_input.request_timeout)
            # Clé changée côté WTTJ : on la relit une fois, puis on réessaie.
            if response.status_code in (401, 403):
                renewed = self._refresh()
                if renewed and renewed != (app_id, api_key):
                    response = self._post(*renewed, body, scraper_input.request_timeout)
            if response.status_code != 200:
                log.warning(f"WTTJ a répondu {response.status_code}")
                return []
            return response.json()["results"][0].get("hits", [])
        except Exception as error:
            log.warning(f"recherche WTTJ impossible : {error}")
            return []

    def _post(self, app_id: str, api_key: str, body: str, timeout: int):
        return self.session.post(
            f"https://{app_id}-dsn.algolia.net/1/indexes/*/queries",
            data=body,
            headers={
                "X-Algolia-API-Key": api_key,
                "X-Algolia-Application-Id": app_id,
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

    def _job(self, hit: dict, scraper_input: ScraperInput) -> JobPost | None:
        organization = hit.get("organization") or {}
        company = organization.get("name")
        slug, company_slug = hit.get("slug"), organization.get("slug")
        if not slug or not company_slug:
            return None
        url = f"{SITE}/fr/companies/{company_slug}/jobs/{slug}"

        office = self._office(hit, scraper_input)
        contract = CONTRACTS.get(str(hit.get("contract_type") or ""), None)

        description = hit.get("profile") or hit.get("description")
        if description and scraper_input.description_format == DescriptionFormat.MARKDOWN:
            description = markdown_converter(description)

        return JobPost(
            id=f"wttj-{hit.get('objectID')}",
            title=hit.get("name") or "",
            company_name=company,
            company_url=f"{SITE}/fr/companies/{company_slug}",
            job_url=url,
            location=Location(
                city=office.get("city"),
                state=office.get("state"),
                country=office.get("country") or Country.FRANCE,
            ),
            description=description,
            job_type=[contract] if contract else None,
            compensation=self._salary(hit),
            date_posted=self._posted(hit.get("published_at")),
            is_remote=str(hit.get("remote") or "") in ("fulltime", "total"),
            education_level=hit.get("education_level"),
            company_industry=self._industry(hit),
        )

    @staticmethod
    def _industry(hit: dict) -> str | None:
        """Le secteur arrive en listes imbriquées, traduites langue par langue."""
        sectors = hit.get("sectors_name") or hit.get("sectors")
        if isinstance(sectors, dict):
            sectors = sectors.get("fr") or next(iter(sectors.values()), None)
        while isinstance(sectors, list) and sectors:
            sectors = sectors[0]
        if isinstance(sectors, dict):
            sectors = next(iter(sectors.values()), None)
        return str(sectors) if isinstance(sectors, (str, int)) else None

    @staticmethod
    def _salary(hit: dict) -> Compensation | None:
        low, high = hit.get("salary_minimum"), hit.get("salary_maximum")
        if not low and not high:
            return None
        return Compensation(
            interval=PERIODS.get(str(hit.get("salary_period") or "").lower()),
            min_amount=low,
            max_amount=high,
            currency=hit.get("salary_currency") or "EUR",
        )

    @staticmethod
    def _posted(raw: str | None):
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw).date()
        except ValueError:
            return None


def _cache_file() -> Path:
    """Identifiants mémorisés, dans le dossier de données du module."""
    home = os.environ.get("ARCHIMED_JOBAGENT_HOME")
    base = Path(home) if home else Path.home() / ".archimed" / "jobagent"
    return base / "wttj-search.json"
