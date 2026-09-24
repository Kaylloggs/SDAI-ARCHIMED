"""Texte complet d'une annonce, à partir de son URL.

Sert à deux moments : quand on ouvre une offre dans ARCHIMED, et quand une IA prépare
une candidature et a besoin du texte réel plutôt que du résumé de la liste.
"""

from __future__ import annotations

import json
import re

from bs4 import BeautifulSoup

from jobspy.util import create_session, markdown_converter

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
}

#: Là où se trouve la description selon le site, du plus précis au plus général.
CONTENT_SELECTORS = [
    '[data-cy="offerDescription"]',
    "#jobDescriptionText",
    ".description__text",
    '[data-testid="jobDescriptionText"]',
    "article",
    "main",
]


def fetch_detail(url: str, timeout: int = 30) -> dict:
    """Description en Markdown, e-mails de contact et éventuel lien de candidature."""
    session = create_session(is_tls=False, has_retry=True, delay=1)
    session.headers.update(HEADERS)
    try:
        response = session.get(url, timeout=timeout)
    except Exception as error:
        return {"url": url, "error": f"page injoignable : {error}"}
    if response.status_code != 200:
        return {"url": url, "error": f"la page a répondu {response.status_code}"}

    soup = BeautifulSoup(response.text, "html.parser")
    posting = _json_ld(soup)
    body = next(
        (soup.select_one(selector) for selector in CONTENT_SELECTORS if soup.select_one(selector)),
        None,
    )
    description = None
    if posting and posting.get("description"):
        description = markdown_converter(posting["description"])
    elif body is not None:
        description = markdown_converter(str(body))

    text = soup.get_text(" ", strip=True)
    return {
        "url": url,
        "title": (posting or {}).get("title") or (soup.title.string if soup.title else None),
        "company": ((posting or {}).get("hiringOrganization") or {}).get("name"),
        "description": description,
        "emails": sorted(set(re.findall(r"[\w.+-]+@[\w-]+\.[\w.-]+", text)))[:5],
        "apply_url": _apply_link(soup, url),
    }


def _json_ld(soup: BeautifulSoup) -> dict | None:
    """La plupart des sites d'emploi publient un bloc `JobPosting` normalisé."""
    for script in soup.find_all("script", {"type": "application/ld+json"}):
        try:
            data = json.loads(script.string or "{}")
        except (json.JSONDecodeError, TypeError):
            continue
        candidates = data if isinstance(data, list) else [data]
        for entry in candidates:
            if isinstance(entry, dict) and entry.get("@type") == "JobPosting":
                return entry
    return None


def _apply_link(soup: BeautifulSoup, url: str) -> str | None:
    for link in soup.find_all("a", href=True):
        label = link.get_text(" ", strip=True).lower()
        if any(word in label for word in ("postuler", "apply", "candidater")):
            href = link["href"]
            return href if href.startswith("http") else None
    return url
