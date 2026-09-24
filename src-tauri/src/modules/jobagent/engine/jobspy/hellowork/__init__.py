"""HelloWork — première plateforme d'emploi française (ajout ARCHIMED à JobSpy).

Pas d'API publique : la page de résultats est rendue côté serveur, on lit ses cartes
(`data-cy="serpCard"`). Chaque offre garde son URL d'origine, c'est là que la
candidature se fait.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from urllib.parse import urlencode

from bs4 import BeautifulSoup
from bs4.element import Tag

from jobspy.model import (
    Compensation,
    CompensationInterval,
    Country,
    JobPost,
    JobResponse,
    JobType,
    Location,
    Scraper,
    ScraperInput,
    Site,
)
from jobspy.util import create_logger, create_session, markdown_converter

log = create_logger("HelloWork")

BASE = "https://www.hellowork.com"
SEARCH = f"{BASE}/fr-fr/emploi/recherche.html"
#: 20 offres par page côté HelloWork.
PER_PAGE = 20

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9",
}

#: Types de contrat HelloWork → vocabulaire JobSpy.
CONTRACTS = {
    "cdi": JobType.FULL_TIME,
    "cdd": JobType.CONTRACT,
    "intérim": JobType.TEMPORARY,
    "interim": JobType.TEMPORARY,
    "stage": JobType.INTERNSHIP,
    "alternance": JobType.INTERNSHIP,
    "apprentissage": JobType.INTERNSHIP,
    "freelance": JobType.CONTRACT,
    "indépendant": JobType.CONTRACT,
}

#: Filtre `c` de l'URL de recherche.
CONTRACT_FILTER = {
    JobType.FULL_TIME: "CDI",
    JobType.CONTRACT: "CDD",
    JobType.TEMPORARY: "Interim",
    JobType.INTERNSHIP: "Stage",
    JobType.PART_TIME: "CDI",
}


class HelloWork(Scraper):
    def __init__(self, proxies=None, ca_cert=None, user_agent=None):
        super().__init__(Site.HELLOWORK, proxies=proxies, ca_cert=ca_cert)
        self.session = create_session(
            proxies=proxies, ca_cert=ca_cert, is_tls=False, has_retry=True, delay=1
        )
        self.session.headers.update(HEADERS)

    def scrape(self, scraper_input: ScraperInput) -> JobResponse:
        # HelloWork ne publie que des offres situées en France.
        if scraper_input.country not in (None, Country.FRANCE):
            log.info("HelloWork ne couvre que la France, source ignorée")
            return JobResponse(jobs=[])

        jobs: list[JobPost] = []
        seen: set[str] = set()
        page = 1 + (scraper_input.offset or 0) // PER_PAGE
        while len(jobs) < scraper_input.results_wanted and page <= 30:
            found = self._page(scraper_input, page)
            if not found:
                break
            for job in found:
                if job.id in seen:
                    continue
                seen.add(job.id)
                jobs.append(job)
                if len(jobs) >= scraper_input.results_wanted:
                    break
            page += 1
        return JobResponse(jobs=jobs)

    def _page(self, scraper_input: ScraperInput, page: int) -> list[JobPost]:
        params = {"k": scraper_input.search_term or "", "p": page}
        if scraper_input.location:
            params["l"] = scraper_input.location
        if scraper_input.is_remote:
            params["t"] = "teletravail"
        contract = CONTRACT_FILTER.get(scraper_input.job_type) if scraper_input.job_type else None
        if contract:
            params["c"] = contract
        if scraper_input.hours_old:
            # `d` accepte un nombre de jours.
            params["d"] = max(1, round(scraper_input.hours_old / 24))

        url = f"{SEARCH}?{urlencode(params)}"
        try:
            response = self.session.get(url, timeout=scraper_input.request_timeout)
        except Exception as error:  # réseau, proxy, blocage temporaire
            log.warning(f"HelloWork injoignable : {error}")
            return []
        if response.status_code != 200:
            log.warning(f"HelloWork a répondu {response.status_code}")
            return []

        soup = BeautifulSoup(response.text, "html.parser")
        cards = soup.select('[data-cy="serpCard"]')
        return [job for card in cards if (job := self._card(card, scraper_input)) is not None]

    def _card(self, card: Tag, scraper_input: ScraperInput) -> JobPost | None:
        link = card.select_one('[data-cy="offerTitle"]')
        if not link or not link.get("href"):
            return None
        href = str(link["href"])
        url = href if href.startswith("http") else BASE + href
        identifier = re.search(r"/(\d+)\.html", href)

        # La carte range le poste et l'entreprise dans deux paragraphes du même lien,
        # et répète tout dans `aria-label` : « Voir offre de X à Y, chez Z, pour un CDI… ».
        label = str(link.get("aria-label") or "")
        paragraphs = [p.get_text(" ", strip=True) for p in link.find_all("p")]
        title = paragraphs[0] if paragraphs else link.get_text(" ", strip=True)
        company = paragraphs[1] if len(paragraphs) > 1 else None
        if not company:
            found = re.search(r",\s*chez\s+(.+?),\s*pour", label)
            company = found.group(1).strip() if found else None
        title = re.sub(r"\s+", " ", title).strip()

        location = self._text(card, '[data-cy="localisationCard"]')
        contract = (self._text(card, '[data-cy="contractCard"]') or "").lower()
        job_type = next(
            ([kind] for label, kind in CONTRACTS.items() if label in contract), None
        )

        description = None
        if scraper_input.linkedin_fetch_description:
            description = self._description(url, scraper_input.request_timeout)

        return JobPost(
            id=f"hw-{identifier.group(1) if identifier else abs(hash(url))}",
            title=title,
            company_name=company,
            job_url=url,
            location=self._location(location),
            description=description,
            job_type=job_type,
            compensation=self._salary(label, card),
            date_posted=self._posted(card),
            is_remote="télétravail" in card.get_text(" ", strip=True).lower(),
        )

    @staticmethod
    def _text(card: Tag, selector: str) -> str | None:
        found = card.select_one(selector)
        return found.get_text(" ", strip=True) if found else None

    @staticmethod
    def _salary(label: str, card: Tag) -> Compensation | None:
        """« 50 000 - 55 000 € / an » — espaces insécables compris."""
        text = label or card.get_text(" ", strip=True)
        found = re.search(
            r"(\d[\d\s\u202f\u00a0.,]*)\s*(?:-|à)\s*(\d[\d\s\u202f\u00a0.,]*)?\s*(?:€|EUR)\s*/?\s*(an|mois|heure|jour)?",
            text,
        )
        if not found:
            return None
        periods = {
            "an": CompensationInterval.YEARLY,
            "mois": CompensationInterval.MONTHLY,
            "heure": CompensationInterval.HOURLY,
            "jour": CompensationInterval.DAILY,
        }
        return Compensation(
            interval=periods.get(found.group(3) or "", CompensationInterval.YEARLY),
            min_amount=_amount(found.group(1)),
            max_amount=_amount(found.group(2)),
            currency="EUR",
        )

    @staticmethod
    def _location(raw: str | None) -> Location:
        if not raw:
            return Location(country=Country.FRANCE)
        # « Paris 8e - 75 » → ville + département.
        city = re.split(r"\s+-\s+", raw)[0].strip()
        return Location(city=city or None, country=Country.FRANCE)

    @staticmethod
    def _posted(card: Tag) -> date | None:
        text = card.get_text(" ", strip=True).lower()
        if "aujourd'hui" in text or "moins d'une heure" in text:
            return date.today()
        if "hier" in text:
            return date.today() - timedelta(days=1)
        match = re.search(r"il y a (\d+)\s*(heure|jour|semaine|mois)", text)
        if not match:
            return None
        amount, unit = int(match.group(1)), match.group(2)
        days = {"heure": 0, "jour": 1, "semaine": 7, "mois": 30}[unit] * amount
        return date.today() - timedelta(days=days)

    def _description(self, url: str, timeout: int) -> str | None:
        try:
            page = self.session.get(url, timeout=timeout)
            if page.status_code != 200:
                return None
            soup = BeautifulSoup(page.text, "html.parser")
            body = soup.select_one('[data-cy="offerDescription"]') or soup.select_one("main")
            return markdown_converter(str(body)) if body else None
        except Exception:
            return None


def _amount(raw: str | None) -> float | None:
    if not raw:
        return None
    cleaned = re.sub(r"[^\d.,]", "", raw).replace(",", ".")
    try:
        return float(cleaned)
    except ValueError:
        return None
