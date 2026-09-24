"""Trouver une adresse de contact chez l'entreprise qui recrute.

Beaucoup d'annonces ne donnent aucune adresse : on postule par un formulaire, et le
dossier part dans un ATS. Ce module cherche, sur le **site de l'entreprise**, une
adresse à qui écrire directement — idéalement celle du recrutement.

La recherche reste sobre et polie :

- le domaine vient d'abord de l'annonce (`company_url`), sinon d'une recherche web ;
- `robots.txt` est lu et respecté avant toute page ;
- quatre pages au maximum par entreprise (accueil + contact / recrutement) ;
- un seul passage par entreprise, mis en cache pour toute la recherche.

Rien n'est envoyé ici : le module ne fait que proposer une adresse, qu'ARCHIMED
montre avant le moindre message.
"""

from __future__ import annotations

import base64
import json
import re
import threading
import unicodedata
import urllib.robotparser
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Iterable
from urllib.parse import parse_qs, quote_plus, urljoin, urlsplit

from bs4 import BeautifulSoup

from jobspy.util import create_session

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
}

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]*[\w]")

#: Ce qu'on cherche dans une adresse, du plus utile au moins utile.
ROLES: list[tuple[int, tuple[str, ...]]] = [
    (
        100,
        (
            "recrutement",
            "recruitment",
            "recruiting",
            "recruteur",
            "recrute",
            "candidature",
            "candidatures",
            "emploi",
            "emplois",
            "job",
            "jobs",
            "career",
            "careers",
            "carriere",
            "carrieres",
            "hiring",
            "talent",
            "talents",
            "rh",
            "hr",
            "drh",
            "people",
            "cv",
        ),
    ),
    (60, ("contact", "hello", "bonjour", "hi", "team", "equipe", "studio", "agence")),
    (40, ("info", "infos", "information", "communication", "direction", "bureau", "office")),
    (30, ("presse", "press", "media", "medias", "partenariat", "partnership")),
]

#: Adresses qui ne mènent à personne, ou qui n'ont rien à voir avec une candidature.
BLOCKED_LOCAL = (
    "noreply",
    "no-reply",
    "nepasrepondre",
    "ne-pas-repondre",
    "donotreply",
    "newsletter",
    "unsubscribe",
    "desabonnement",
    "postmaster",
    "webmaster",
    "abuse",
    "privacy",
    "dpo",
    "rgpd",
    "gdpr",
    "legal",
    "juridique",
    "facture",
    "factures",
    "billing",
    "compta",
    "comptabilite",
    "sav",
    "sentry",
    # Données personnelles : ces boîtes sont là pour la loi, pas pour recruter.
    "informatique.libertes",
    "informatiqueetlibertes",
    "libertes",
    "cnil",
    "donneespersonnelles",
    "donnees-personnelles",
    "protectiondesdonnees",
    "confidentialite",
    "vieprivee",
)

#: Adresses d'exemple laissées dans un gabarit de site.
PLACEHOLDERS = re.compile(
    r"^(x+|y+|z+|a+|nom|prenom|votre|votrenom|vous|your|yourname|email|mail|adresse|"
    r"test|demo|exemple|example|utilisateur|user)$",
    re.IGNORECASE,
)

#: Domaines de démonstration : personne ne les relève.
FAKE_DOMAIN = (
    "exemple.com",
    "exemple.fr",
    "example.org",
    "example.net",
    "votresite.fr",
    "votredomaine.fr",
    "monsite.fr",
    "mondomaine.fr",
    "site.com",
    "test.com",
    "mail.com",
    "email.fr",
)

#: Domaines qui ne sont pas l'entreprise : plateformes, ATS, outils du site.
BLOCKED_DOMAIN = (
    "indeed.com",
    "linkedin.com",
    "glassdoor.com",
    "ziprecruiter.com",
    "hellowork.com",
    "welcometothejungle.com",
    "apec.fr",
    "monster.fr",
    "pole-emploi.fr",
    "francetravail.fr",
    "workday.com",
    "greenhouse.io",
    "lever.co",
    "recruitee.com",
    "teamtailor.com",
    "smartrecruiters.com",
    "talentsoft.com",
    "softgarden.de",
    "taleez.com",
    "flatchr.io",
    "sentry.io",
    "wixpress.com",
    "example.com",
    "domain.com",
    "email.com",
    "google.com",
    "googlemail.com",
)

#: Annuaires, réseaux sociaux et encyclopédies : ils parlent de l'entreprise, ils ne
#: sont pas l'entreprise. Un domaine trouvé ici n'est jamais retenu comme son site.
DIRECTORIES = (
    "pappers.fr",
    "societe.com",
    "verif.com",
    "infogreffe.fr",
    "manageo.fr",
    "bodacc.fr",
    "kompass.com",
    "crunchbase.com",
    "bloomberg.com",
    "wikipedia.org",
    "wikidata.org",
    "wikiwand.com",
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "youtube.com",
    "tiktok.com",
    "bing.com",
    "duckduckgo.com",
    "yelp.com",
    "trustpilot.com",
    "figaro.fr",
    "lesechos.fr",
    "usinenouvelle.com",
    "journaldunet.com",
    "1jeune1solution.gouv.fr",
    "service-public.fr",
    "cci.fr",
)

#: Formes juridiques : elles ne disent rien du nom d'un domaine.
LEGAL_FORMS = {
    "sas",
    "sasu",
    "sarl",
    "eurl",
    "sa",
    "sca",
    "scop",
    "sci",
    "inc",
    "llc",
    "ltd",
    "limited",
    "plc",
    "gmbh",
    "bv",
    "nv",
    "ag",
    "spa",
    "srl",
    "corp",
    "corporation",
    "company",
    "group",
    "groupe",
    "holding",
    "france",
    "international",
}

#: Boîtes personnelles : acceptables (beaucoup de petites structures n'ont que ça),
#: mais une adresse au nom de l'entreprise passe devant.
FREE_MAIL = (
    "gmail.com",
    "outlook.com",
    "outlook.fr",
    "hotmail.com",
    "hotmail.fr",
    "yahoo.com",
    "yahoo.fr",
    "free.fr",
    "orange.fr",
    "laposte.net",
    "wanadoo.fr",
    "sfr.fr",
    "icloud.com",
)

#: Pages où une adresse se trouve, dans l'ordre où on les essaie.
PAGE_HINTS = (
    "recrutement",
    "nous-rejoindre",
    "rejoignez",
    "carriere",
    "carrieres",
    "career",
    "careers",
    "jobs",
    "emploi",
    "contact",
    "nous-contacter",
    "contactez",
    "mentions-legales",
    "legal",
    "impressum",
    "about",
    "a-propos",
    "equipe",
    "team",
)

#: Adresses souvent écrites « nom (at) domaine (dot) fr » pour tromper les robots.
OBFUSCATED = re.compile(
    r"([\w.+-]+)\s*(?:\(|\[|\s)\s*(?:at|arobase|@)\s*(?:\)|\]|\s)\s*"
    r"([\w-]+)\s*(?:\(|\[|\s)\s*(?:dot|point|\.)\s*(?:\)|\]|\s)\s*(\w{2,})",
    re.IGNORECASE,
)

#: Essayés quand l'accueil ne donne aucun lien exploitable (site tout en JavaScript).
KNOWN_PATHS = (
    "/recrutement",
    "/nous-rejoindre",
    "/contact",
    "/mentions-legales",
)

#: Extensions de fichiers qu'une expression d'e-mail attrape parfois au vol.
FILE_ENDINGS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js")

_cache: dict[str, dict] = {}
_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
_cache_lock = threading.Lock()


def normalize(email: str) -> str:
    return email.strip().strip(".,;:()<>[]\"'").lower()


def local_part(email: str) -> str:
    return email.split("@", 1)[0]


def domain_of(email: str) -> str:
    return email.split("@", 1)[-1]


def acceptable(email: str) -> bool:
    """Écarte ce qui n'est pas une adresse à qui parler."""
    if email.count("@") != 1 or "." not in domain_of(email):
        return False
    if email.endswith(FILE_ENDINGS):
        return False
    local = local_part(email)
    if any(word in local for word in BLOCKED_LOCAL) or PLACEHOLDERS.match(local):
        return False
    host = domain_of(email)
    for blocked in BLOCKED_DOMAIN + FAKE_DOMAIN:
        if host == blocked or host.endswith("." + blocked):
            return False
    return True


def score(email: str, site_domain: str | None = None) -> int:
    """Note une adresse : le recrutement d'abord, l'accueil ensuite."""
    local = local_part(email)
    points = 20
    for value, words in ROLES:
        if any(re.search(rf"(^|[._-]){word}([._-]|$)", local) for word in words):
            points = value
            break
        if any(word in local for word in words):
            points = max(points, value - 10)
    host = domain_of(email)
    if site_domain:
        if host == site_domain or host.endswith("." + site_domain):
            points += 15
        elif host not in FREE_MAIL:
            # Adresse citée sur le site mais logée ailleurs : souvent l'agence qui a
            # fait le site, parfois la maison mère. Elle ne passe qu'en dernier recours.
            points -= 40
    if host in FREE_MAIL:
        points -= 10
    return points


def rank(emails: Iterable[str], site_domain: str | None = None) -> list[str]:
    """Adresses gardées, de la plus utile à la moins utile, sans doublon."""
    seen: dict[str, int] = {}
    for raw in emails:
        email = normalize(raw)
        if not acceptable(email):
            continue
        seen[email] = max(seen.get(email, 0), score(email, site_domain))
    return sorted(seen, key=lambda email: (-seen[email], email))


def site_domain(url: str | None) -> str | None:
    """Domaine d'un site d'entreprise, sans `www`, ni plateforme, ni annuaire."""
    if not url:
        return None
    host = urlsplit(url if "//" in url else f"https://{url}").netloc.lower()
    host = host.split(":")[0]
    if host.startswith("www."):
        host = host[4:]
    if not host or "." not in host:
        return None
    for blocked in BLOCKED_DOMAIN + DIRECTORIES:
        if host == blocked or host.endswith("." + blocked):
            return None
    return host


def tokens(name: str | None) -> set[str]:
    """Mots significatifs d'un nom d'entreprise, sans accent ni forme juridique."""
    plain = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    words = re.split(r"[^a-zA-Z0-9]+", plain.lower())
    return {word for word in words if len(word) > 2 and word not in LEGAL_FORMS}


def belongs_to(company: str | None, domain: str, page: str = "") -> bool:
    """L'entreprise et le domaine vont-ils ensemble ?

    Une adresse trouvée sur le mauvais site enverrait une candidature à des inconnus :
    on exige que le nom se retrouve dans le domaine, ou sur la page d'accueil.
    """
    words = tokens(company)
    if not words:
        return False
    label = re.sub(r"[^a-z0-9]", "", domain.split(".")[0])
    if any(word in label or label in word for word in words):
        return True
    if not page:
        return False
    text = unicodedata.normalize("NFKD", page).encode("ascii", "ignore").decode().lower()
    return all(word in text for word in sorted(words, key=len, reverse=True)[:2])


def _session():
    session = create_session(is_tls=False, has_retry=False, delay=0)
    session.headers.update(HEADERS)
    return session


def _robots_for(domain: str, session) -> urllib.robotparser.RobotFileParser | None:
    """`robots.txt` du domaine, lu une seule fois.

    La lecture passe par notre session : `RobotFileParser.read()` utilise `urllib`,
    que beaucoup de sites renvoient en 403 — et un 403 lui fait tout interdire, ce qui
    reviendrait à ne jamais chercher de contact nulle part.
    """
    with _cache_lock:
        if domain in _robots:
            return _robots[domain]
    parser: urllib.robotparser.RobotFileParser | None = None
    try:
        response = session.get(f"https://{domain}/robots.txt", timeout=8)
        if response.status_code == 200 and len(response.text) < 500_000:
            parser = urllib.robotparser.RobotFileParser()
            parser.parse(response.text.splitlines())
    except Exception:
        parser = None
    with _cache_lock:
        _robots[domain] = parser
    return parser


def _allowed(domain: str, session, path: str = "/") -> bool:
    """Respecte `robots.txt` ; sans fichier lisible, on considère que c'est permis."""
    parser = _robots_for(domain, session)
    if parser is None:
        return True
    try:
        return parser.can_fetch("*", f"https://{domain}{path}")
    except Exception:
        return True


def _unwrap(href: str) -> str:
    """Bing enveloppe ses liens : l'adresse réelle est en base64 dans le paramètre `u`."""
    if "bing.com/ck/a" not in href:
        return href
    raw = parse_qs(urlsplit(href).query).get("u", [""])[0]
    if raw.startswith("a1"):
        raw = raw[2:]
    try:
        return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode("utf8", "replace")
    except Exception:
        return ""


def find_domain(company: str, session, timeout: int = 10) -> str | None:
    """Cherche le site d'une entreprise quand l'annonce ne le donne pas.

    Deux sources gratuites, dans l'ordre : les résultats de Bing, puis la fiche
    « site officiel » de DuckDuckGo. Un domaine qui ne ressemble pas au nom de
    l'entreprise est ignoré ici et revérifié sur la page d'accueil.
    """
    try:
        response = session.get(
            f"https://www.bing.com/search?q={quote_plus(company)}&setlang=fr", timeout=timeout
        )
    except Exception:
        response = None
    if response is not None and response.status_code == 200:
        soup = BeautifulSoup(response.text, "html.parser")
        fallback = None
        for link in soup.select("li.b_algo h2 a[href], .b_algo h2 a[href]"):
            domain = site_domain(_unwrap(link["href"]))
            if not domain:
                continue
            if belongs_to(company, domain):
                return domain
            fallback = fallback or domain
        if fallback:
            return fallback

    # Repli : l'encart « site officiel » de DuckDuckGo, quand l'entreprise a une fiche.
    try:
        answer = session.get(
            f"https://api.duckduckgo.com/?format=json&no_html=1&q={quote_plus(company)}",
            timeout=timeout,
        )
        data = json.loads(answer.text)
    except Exception:
        return None
    candidates = [result.get("FirstURL", "") for result in data.get("Results", [])]
    candidates.append(data.get("AbstractURL", ""))
    for candidate in candidates:
        domain = site_domain(candidate)
        if domain:
            return domain
    return None


def _same_site(url: str, domain: str) -> bool:
    """Le site de l'entreprise, sous-domaines compris (`aide.exemple.fr`)."""
    host = site_domain(url)
    return bool(host) and (host == domain or host.endswith("." + domain))


def _targets(html: str, home: str, domain: str) -> list[str]:
    """Pages à visiter, du recrutement vers les mentions légales."""
    soup = BeautifulSoup(html, "html.parser")
    ranked: list[tuple[int, str]] = []
    for link in soup.select("a[href]"):
        href = link["href"]
        label = f"{href} {link.get_text(' ', strip=True)}".lower()
        hit = next((index for index, hint in enumerate(PAGE_HINTS) if hint in label), None)
        if hit is None:
            continue
        url = urljoin(home, href).split("#")[0]
        if not _same_site(url, domain) or any(url == seen for _, seen in ranked):
            continue
        ranked.append((hit, url))
    ranked.sort(key=lambda item: item[0])
    return [url for _, url in ranked[:3]]


def _pages(domain: str, session, timeout: int) -> list[str]:
    """Accueil, puis les pages qui parlent de contact ou de recrutement."""
    home = f"https://{domain}/"
    texts: list[str] = []
    try:
        response = session.get(home, timeout=timeout)
    except Exception:
        return texts
    if response.status_code != 200:
        return texts
    texts.append(response.text)

    targets = _targets(response.text, home, domain)
    # Site rendu en JavaScript : l'accueil n'expose aucun lien, on tente les chemins
    # habituels plutôt que d'abandonner.
    if not targets:
        targets = [urljoin(home, path) for path in KNOWN_PATHS[:2]]

    for url in targets:
        path = urlsplit(url).path or "/"
        if not _allowed(site_domain(url) or domain, session, path):
            continue
        try:
            page = session.get(url, timeout=timeout)
        except Exception:
            continue
        if page.status_code == 200:
            texts.append(page.text)
    return texts


def _emails_in(html: str) -> list[str]:
    """Adresses de la page : les liens `mailto:` d'abord, puis le texte."""
    soup = BeautifulSoup(html, "html.parser")
    found = [
        link["href"][7:].split("?")[0]
        for link in soup.select("a[href^='mailto:']")
        if len(link["href"]) > 7
    ]
    text = soup.get_text(" ", strip=True)
    found += EMAIL.findall(text)
    # « prenom (at) exemple (dot) fr » : écrit ainsi pour les robots, lisible pour nous.
    found += [f"{local}@{host}.{suffix}" for local, host, suffix in OBFUSCATED.findall(text)]
    return found


def find(
    company: str | None,
    company_url: str | None = None,
    known: Iterable[str] = (),
    timeout: int = 10,
) -> dict:
    """Adresse de contact d'une entreprise.

    Renvoie `{"emails": [...], "best": str|None, "domain": str|None, "source": ...}` :
    `annonce` quand l'adresse était déjà dans l'offre, `site` quand elle vient du site
    de l'entreprise.
    """
    from_offer = rank(known)
    if from_offer:
        return {
            "company": company,
            "domain": site_domain(company_url),
            "emails": from_offer,
            "best": from_offer[0],
            "source": "annonce",
        }

    if not company:
        return {"company": company, "domain": None, "emails": [], "best": None, "source": None}

    key = (company or "").strip().lower()
    with _cache_lock:
        cached = _cache.get(key)
    if cached is not None:
        return cached

    session = _session()
    given = site_domain(company_url)
    domain = given or find_domain(company, session, timeout)
    emails: list[str] = []
    if domain and _allowed(domain, session):
        pages = _pages(domain, session, timeout)
        # Le domaine vient d'une recherche : on vérifie qu'il s'agit bien de cette
        # entreprise avant de proposer d'écrire à qui que ce soit.
        if pages and (given or belongs_to(company, domain, pages[0])):
            for html in pages:
                emails.extend(_emails_in(html))
        elif pages:
            domain = None

    ordered = rank(emails, domain)
    result = {
        "company": company,
        "domain": domain,
        "emails": ordered[:5],
        "best": ordered[0] if ordered else None,
        "source": "site" if ordered else None,
    }
    with _cache_lock:
        _cache[key] = result
    return result


def enrich(
    offers: list,
    progress: Callable[[int, int, str], None] | None = None,
    workers: int = 4,
    timeout: int = 10,
) -> list:
    """Pose une adresse de contact sur chaque offre, une entreprise à la fois."""
    companies: dict[str, list] = {}
    for offer in offers:
        key = (offer.company or "").strip().lower()
        if key:
            companies.setdefault(key, []).append(offer)

    total = len(companies)
    if not total:
        return offers
    done = 0

    def work(group: list) -> tuple[list, dict]:
        first = group[0]
        return group, find(first.company, first.company_url, first.emails, timeout)

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for group, contact in pool.map(work, companies.values()):
            done += 1
            for offer in group:
                offer.recruiter_email = contact["best"]
                offer.recruiter_emails = contact["emails"]
                offer.recruiter_source = contact["source"]
            if progress:
                found = contact["best"] or "rien trouvé"
                progress(done, total, f"Contact · {group[0].company} — {found}")
    return offers
