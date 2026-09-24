"""Niveau d'études, dédoublonnage et tri.

Seule Welcome to the Jungle publie le niveau d'études demandé. Pour les autres sources,
on le déduit du titre et de la description — une déduction prudente : en cas de doute,
l'offre reste « non précisé » plutôt que d'être classée de travers.
"""

from __future__ import annotations

import re
from typing import Iterable

from archimed_jobagent.model import Offer, _normalize_url

#: Échelle ARCHIMED, du moins exigeant au plus exigeant.
LEVELS: list[tuple[str, str]] = [
    ("none", "Sans diplôme requis"),
    ("cap", "CAP / BEP"),
    ("bac", "Bac"),
    ("bac2", "Bac+2 (BTS, DUT)"),
    ("bac3", "Bac+3 (licence, bachelor)"),
    ("bac5", "Bac+5 (master, ingénieur)"),
    ("phd", "Doctorat"),
]
LABELS: dict[str, str] = dict(LEVELS)
ORDER: dict[str, int] = {key: index for index, (key, _) in enumerate(LEVELS)}

#: Valeurs publiées par Welcome to the Jungle.
WTTJ_LEVELS: dict[str, str] = {
    "NO_DIPLOMA": "none",
    "CAP": "cap",
    "BEP": "cap",
    "BAC": "bac",
    "BAC_1": "bac2",
    "BAC_2": "bac2",
    "BAC_3": "bac3",
    "BAC_4": "bac3",
    "BAC_5": "bac5",
    "PHD": "phd",
}

#: Formulations rencontrées dans les annonces, du plus haut au plus bas niveau :
#: le premier motif qui correspond gagne, pour ne pas classer un « bac+5 » en « bac ».
PATTERNS: list[tuple[str, str]] = [
    ("phd", r"\b(doctorat|docteur|ph\.?\s?d|thèse\s+de\s+doctorat)\b"),
    ("bac5", r"\b(bac\s*\+\s*[56]|master|mastère|msc|m2\b|ingénieur[e]?\s+(?:dipl|de\s+formation)|école\s+d['’]ingénieur|mba)\b"),
    ("bac3", r"\b(bac\s*\+\s*[34]|licence|bachelor|l3\b|maîtrise)\b"),
    ("bac2", r"\b(bac\s*\+\s*2|bts|dut|deug|but\b)\b"),
    ("bac", r"\b(baccalauréat|niveau\s+bac\b|bac\s+général|bac\s+pro)\b"),
    ("cap", r"\b(cap\b|bep\b|c\.a\.p\.)\b"),
    ("none", r"(sans\s+diplôme|aucun\s+diplôme|diplôme\s+non\s+(?:requis|exigé)|débutant\s+accepté)"),
]


def detect(offer: Offer) -> str | None:
    """Niveau d'études exigé, `None` si l'annonce ne le dit pas."""
    if offer.education in ORDER:
        return offer.education
    haystack = " ".join(filter(None, [offer.title, offer.description or ""])).lower()
    if not haystack.strip():
        return None
    for level, pattern in PATTERNS:
        if re.search(pattern, haystack):
            return level
    return None


def apply_education(offers: Iterable[Offer]) -> list[Offer]:
    """Renseigne `education` / `education_label` sur chaque offre."""
    resolved = []
    for offer in offers:
        if offer.education in WTTJ_LEVELS:
            offer.education = WTTJ_LEVELS[offer.education]
        level = detect(offer)
        offer.education = level
        offer.education_label = LABELS.get(level or "", None)
        resolved.append(offer)
    return resolved


def keep_education(
    offers: Iterable[Offer], wanted: list[str] | None, include_unknown: bool = True
) -> list[Offer]:
    """Ne garde que les niveaux demandés (`wanted` vide = pas de filtre)."""
    if not wanted:
        return list(offers)
    allowed = {level for level in wanted if level in ORDER}
    return [
        offer
        for offer in offers
        if (offer.education in allowed) or (offer.education is None and include_unknown)
    ]


def deduplicate(offers: Iterable[Offer]) -> list[Offer]:
    """Une annonce republiée sur trois sites ne doit apparaître qu'une fois.

    Deux clés : l'URL nettoyée, puis le trio poste/entreprise/ville. La version la plus
    complète l'emporte (celle qui a une description, un salaire, une date), et garde la
    place de la première rencontre.
    """
    places: dict[str, int] = {}
    kept: list[Offer] = []
    for offer in offers:
        keys = [_normalize_url(offer.url)]
        if offer.title and offer.company:
            keys.append(
                f"{_slug(offer.title)}|{_slug(offer.company)}|{_slug(offer.city or '')}"
            )
        known = next((places[key] for key in keys if key in places), None)
        if known is None:
            for key in keys:
                places[key] = len(kept)
            kept.append(offer)
            continue
        if _richness(offer) > _richness(kept[known]):
            kept[known] = offer
        for key in keys:
            places.setdefault(key, known)
    return kept


def _richness(offer: Offer) -> int:
    return sum(
        [
            bool(offer.description),
            bool(offer.salary_min or offer.salary_max),
            bool(offer.posted),
            bool(offer.education),
            bool(offer.company),
        ]
    )


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def sort_offers(offers: list[Offer], by: str = "date") -> list[Offer]:
    """Tri d'affichage : par date (défaut), par entreprise ou par domaine."""
    if by == "company":
        return sorted(offers, key=lambda o: ((o.company or "").lower(), o.title.lower()))
    if by == "domain":
        return sorted(
            offers, key=lambda o: ((o.domain or "").lower(), o.posted or "", o.title.lower())
        )
    if by == "education":
        return sorted(offers, key=lambda o: (ORDER.get(o.education or "", 99), o.title.lower()))
    # Les plus récentes d'abord ; celles sans date passent après.
    return sorted(offers, key=lambda o: (o.posted or "0000-00-00", o.title.lower()), reverse=True)
