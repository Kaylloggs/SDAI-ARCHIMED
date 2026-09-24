"""Placement des annonces sur la carte, sans appeler le moindre service.

Deux tables embarquées suffisent : les villes de plus de 40 000 habitants (GeoNames) et
un point par pays (Natural Earth) quand la ville est introuvable. Voir `data/NOTICE.md`.
"""

from __future__ import annotations

import unicodedata
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).parent / "data"

#: Mentions collées aux noms de villes par les plateformes d'emploi.
NOISE = (
    " cedex",
    " arrondissement",
    " centre ville",
)


def fold(text: str) -> str:
    """« Saint-Étienne » → « saint etienne » : minuscules, sans accents ni ponctuation."""
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return " ".join("".join(c if c.isalnum() else " " for c in text).split())


@lru_cache(maxsize=1)
def _cities() -> dict[tuple[str, str], tuple[float, float]]:
    table: dict[tuple[str, str], tuple[float, float]] = {}
    path = DATA / "cities.tsv"
    if not path.exists():
        return table
    for line in path.read_text(encoding="utf8").splitlines():
        parts = line.split("\t")
        if len(parts) != 4:
            continue
        name, country, latitude, longitude = parts
        try:
            table[(name, country)] = (float(latitude), float(longitude))
        except ValueError:
            continue
    return table


@lru_cache(maxsize=1)
def _countries() -> dict[str, tuple[float, float]]:
    table: dict[str, tuple[float, float]] = {}
    path = DATA / "countries.tsv"
    if not path.exists():
        return table
    for line in path.read_text(encoding="utf8").splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        try:
            table[parts[0]] = (float(parts[1]), float(parts[2]))
        except ValueError:
            continue
    return table


def _candidates(city: str) -> list[str]:
    """Variantes à essayer : « Paris 15e » et « Amsterdam-Zuidoost » visent « paris » et
    « amsterdam »."""
    folded = fold(city)
    for noise in NOISE:
        folded = folded.replace(noise, " ")
    folded = " ".join(folded.split())
    if not folded:
        return []

    tries = [folded]
    # Numéro d'arrondissement ou de département accolé : « paris 15e », « lyon 3 ».
    words = folded.split()
    while words and (words[-1].isdigit() or words[-1][:-1].isdigit() or len(words[-1]) <= 2):
        words = words[:-1]
        candidate = " ".join(words)
        if candidate and candidate not in tries:
            tries.append(candidate)
    # Quartier accolé au nom de la ville : « amsterdam zuidoost ».
    if len(words) > 1 and words[0] not in tries:
        tries.append(words[0])
    return tries


def locate(city: str | None, country_code: str | None) -> tuple[float, float, str] | None:
    """Coordonnées d'une annonce : `(latitude, longitude, précision)`.

    `précision` vaut `city` quand la ville a été reconnue, `country` quand on retombe sur
    le point du pays. `None` si même le pays est inconnu.
    """
    code = (country_code or "").upper()
    if city and code:
        cities = _cities()
        for candidate in _candidates(city):
            found = cities.get((candidate, code))
            if found:
                return found[0], found[1], "city"

    # Ville inconnue (ou absente) : le pays suffit à montrer où chercher.
    point = _countries().get(code)
    if point:
        return point[0], point[1], "country"
    return None
