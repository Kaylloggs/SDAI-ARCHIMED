"""Serveur MCP du module JobAgent — ce que le CLI Claude peut faire tout seul.

Lancé par le CLI en stdio (voir `.mcp.json` écrit par ARCHIMED) :

    python -m archimed_jobagent.server

Les outils exposés couvrent la recherche d'annonces, le détail d'une offre, et la
lecture du dossier de candidature local (CV, profil, offres retenues). Rien n'est
envoyé nulle part : tout reste sur la machine, et aucune candidature n'est déposée
par ce serveur — c'est ARCHIMED qui demande confirmation avant le moindre envoi.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Annotated, Any

from fastmcp import FastMCP
from pydantic import Field

from archimed_jobagent import recruiter, search
from archimed_jobagent.detail import fetch_detail

mcp = FastMCP(
    name="archimed-jobagent",
    instructions=(
        "Recherche d'offres d'emploi multi-plateformes (HelloWork, Welcome to the Jungle, "
        "Indeed, LinkedIn, Glassdoor, ZipRecruiter, Google Jobs) pour SDAI ARCHIMED. "
        "Utilise `search_jobs` pour lister, `job_details` pour lire une annonce en entier, "
        "`company_contacts` pour trouver à qui écrire dans une entreprise, "
        "`read_profile` pour connaître le CV et les préférences de la personne. "
        "Ne dépose jamais de candidature : prépare les documents, ARCHIMED fait valider."
    ),
)


def home() -> Path:
    """Dossier de données du module, fourni par ARCHIMED."""
    return Path(os.environ.get("ARCHIMED_JOBAGENT_HOME", Path.home() / ".archimed" / "jobagent"))


@mcp.tool
def search_jobs(
    domains: Annotated[list[str], Field(description="Métiers ou mots-clés cherchés, un par domaine")],
    countries: Annotated[list[str], Field(description="Pays en anglais : france, netherlands…")] = ["france"],
    cities: Annotated[list[str], Field(description="Villes ; « france:Paris » pour lier une ville à un pays")] = [],
    sites: Annotated[list[str], Field(description="Plateformes ; vide = les principales")] = [],
    education: Annotated[list[str], Field(description="Niveaux voulus : none, cap, bac, bac2, bac3, bac5, phd")] = [],
    contract: Annotated[str | None, Field(description="fulltime, parttime, contract, temporary, internship")] = None,
    remote: Annotated[bool, Field(description="Ne garder que le télétravail")] = False,
    hours_old: Annotated[int | None, Field(description="Annonces publiées depuis N heures")] = None,
    results_per_query: Annotated[int, Field(description="Résultats par plateforme et par ville", ge=1, le=100)] = 20,
    fetch_description: Annotated[bool, Field(description="Récupérer le texte complet (plus lent)")] = False,
    find_recruiter: Annotated[
        bool, Field(description="Chercher une adresse de contact chez chaque entreprise")
    ] = False,
    limit: Annotated[int, Field(description="Nombre d'offres renvoyées au maximum", ge=1, le=300)] = 60,
) -> dict[str, Any]:
    """Cherche des annonces sur plusieurs plateformes, pays et villes à la fois."""
    request = search.SearchRequest.from_json(
        {
            "domains": domains,
            "countries": countries,
            "cities": cities,
            "sites": sites or list(search.DEFAULT_SITES),
            "education": education,
            "contract": contract,
            "remote": remote,
            "hours_old": hours_old,
            "results_per_query": results_per_query,
            "fetch_description": fetch_description,
            "find_recruiter": find_recruiter,
        }
    )
    offers = search.run(request)
    return {
        "count": len(offers),
        "offers": search.iter_offers(offers[:limit]),
    }


@mcp.tool
def job_details(url: Annotated[str, Field(description="Adresse de l'annonce")]) -> dict[str, Any]:
    """Lit une annonce en entier : description, contacts, lien de candidature."""
    return fetch_detail(url)


@mcp.tool
def company_contacts(
    company: Annotated[str, Field(description="Nom de l'entreprise")],
    company_url: Annotated[str | None, Field(description="Son site, s'il est connu")] = None,
) -> dict[str, Any]:
    """Cherche une adresse à qui écrire chez une entreprise (recrutement de préférence).

    L'adresse vient du site de l'entreprise, jamais d'un annuaire acheté. Écris-lui
    seulement si la personne te le demande : ARCHIMED fait confirmer chaque envoi.
    """
    return recruiter.find(company, company_url)


@mcp.tool
def list_sources() -> dict[str, Any]:
    """Plateformes, pays et niveaux d'études acceptés par la recherche."""
    return {
        "sites": search.available_sites(),
        "countries": search.available_countries(),
        "education": search.available_education(),
        "contracts": sorted(search.CONTRACTS),
    }


@mcp.tool
def read_profile() -> dict[str, Any]:
    """CV et préférences enregistrés dans ARCHIMED.

    Deux CV peuvent coexister : `fr` et `en`. Prends l'anglais pour une annonce hors
    zone francophone, le français sinon.
    """
    profile_file = home() / "profile.json"
    profile = {}
    if profile_file.exists():
        profile = json.loads(profile_file.read_text(encoding="utf8"))
    cvs = profile.setdefault("cvs", {})
    for language in ("fr", "en"):
        text_file = home() / f"cv-{language}.txt"
        if text_file.exists():
            cvs.setdefault(language, {})["text"] = text_file.read_text(encoding="utf8")
    # Profil écrit avant l'arrivée du CV anglais.
    legacy = home() / "cv.txt"
    if legacy.exists() and "fr" not in cvs:
        cvs["fr"] = {"text": legacy.read_text(encoding="utf8")}
    if not profile:
        return {"found": False, "hint": "Aucun CV importé dans le module JobAgent."}
    profile["found"] = True
    return profile


@mcp.tool
def shortlisted_offers() -> dict[str, Any]:
    """Offres que la personne a retenues ou pour lesquelles elle a déjà postulé."""
    state = home() / "state.json"
    if not state.exists():
        return {"offers": [], "applications": []}
    data = json.loads(state.read_text(encoding="utf8"))
    return {
        "offers": [offer for offer in data.get("offers", []) if offer.get("starred")],
        "applications": data.get("applications", []),
    }


if __name__ == "__main__":
    mcp.run()
