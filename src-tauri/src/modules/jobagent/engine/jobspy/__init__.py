"""JobSpy — version allégée et étendue pour SDAI ARCHIMED.

Source d'origine : https://github.com/speedyapply/JobSpy (MIT, voir LICENSE.jobspy).

Différences avec l'amont :
- `scrape_jobs()` et sa dépendance à pandas/numpy sont retirées : ARCHIMED orchestre
  lui-même les recherches (multi-domaines, multi-pays, multi-villes) dans
  `archimed_jobagent.search` et renvoie du JSON.
- deux sources ajoutées : HelloWork et Welcome to the Jungle.
- `JobPost.education_level` ajouté (niveau d'études demandé par l'annonce).
"""

from jobspy.glassdoor import Glassdoor
from jobspy.google import Google
from jobspy.hellowork import HelloWork
from jobspy.indeed import Indeed
from jobspy.linkedin import LinkedIn
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
from jobspy.wttj import WelcomeToTheJungle
from jobspy.ziprecruiter import ZipRecruiter

#: Une classe de scraper par plateforme.
SCRAPERS: dict[Site, type[Scraper]] = {
    Site.LINKEDIN: LinkedIn,
    Site.INDEED: Indeed,
    Site.ZIP_RECRUITER: ZipRecruiter,
    Site.GLASSDOOR: Glassdoor,
    Site.GOOGLE: Google,
    Site.HELLOWORK: HelloWork,
    Site.WELCOME_TO_THE_JUNGLE: WelcomeToTheJungle,
}

__all__ = [
    "SCRAPERS",
    "Compensation",
    "CompensationInterval",
    "Country",
    "DescriptionFormat",
    "JobPost",
    "JobResponse",
    "JobType",
    "Location",
    "Scraper",
    "ScraperInput",
    "Site",
]
