"""Interface en ligne de commande : c'est par là qu'ARCHIMED parle au moteur.

Tout sort en NDJSON sur la sortie standard, une ligne par événement, pour que
l'interface affiche l'avancement pendant que les plateformes répondent :

    {"event": "progress", "done": 3, "total": 12, "message": "Indeed · design · Paris — 20 offre(s)"}
    {"event": "done", "offers": [ … ]}
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from archimed_jobagent import recruiter, search
from archimed_jobagent.detail import fetch_detail
from archimed_jobagent.mailer import guess_host, send
from archimed_jobagent.resume import extract


def _utf8_output() -> None:
    """Windows écrit en cp1252 par défaut : un emoji dans une annonce cassait la sortie."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="replace")


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def command_search(args: argparse.Namespace) -> int:
    raw = json.loads(_read(args.request))
    request = search.SearchRequest.from_json(raw)
    if not request.domains:
        emit({"event": "error", "message": "aucun domaine de recherche"})
        return 2

    emit({"event": "started", "queries": len(search.plan(request))})
    offers = search.run(
        request,
        progress=lambda done, total, message: emit(
            {"event": "progress", "done": done, "total": total, "message": message}
        ),
    )
    emit({"event": "done", "offers": search.iter_offers(offers)})
    return 0


def command_sources(_: argparse.Namespace) -> int:
    emit(
        {
            "event": "done",
            "sites": search.available_sites(),
            "countries": search.available_countries(),
            "education": search.available_education(),
            "contracts": sorted(search.CONTRACTS),
        }
    )
    return 0


def command_detail(args: argparse.Namespace) -> int:
    emit({"event": "done", "offer": fetch_detail(args.url)})
    return 0


def command_contacts(args: argparse.Namespace) -> int:
    """Adresse de contact d'une entreprise, cherchée sur son site."""
    emit(
        {
            "event": "done",
            **recruiter.find(args.company, args.url, args.known or []),
        }
    )
    return 0


def command_cv(args: argparse.Namespace) -> int:
    """Texte d'un CV importé (PDF, DOCX, texte)."""
    result = extract(args.file)
    emit({"event": "done", **result})
    return 0 if "error" not in result else 1


def command_send(args: argparse.Namespace) -> int:
    """Envoie une candidature. La charge utile arrive par l'entrée standard, jamais par
    la ligne de commande : elle contient un mot de passe."""
    payload = json.loads(_read(args.payload))
    result = send(payload)
    emit({"event": "done", **result})
    return 0 if result.get("sent") else 1


def command_smtp(args: argparse.Namespace) -> int:
    """Réglages d'envoi connus pour une adresse."""
    emit({"event": "done", "smtp": guess_host(args.address)})
    return 0


def command_doctor(_: argparse.Namespace) -> int:
    """Vérifie que les dépendances sont là : l'interface le dit avant toute recherche."""
    missing = []
    for package in ["requests", "bs4", "pydantic", "tls_client", "markdownify", "regex"]:
        try:
            __import__(package)
        except ImportError:
            missing.append(package)
    try:
        import fastmcp  # noqa: F401

        mcp_ready = True
    except ImportError:
        mcp_ready = False
    emit(
        {
            "event": "done",
            "python": sys.version.split()[0],
            "missing": missing,
            "mcp": mcp_ready,
            "ready": not missing,
        }
    )
    return 0 if not missing else 1


def _read(path: str | None) -> str:
    if path in (None, "-"):
        return sys.stdin.read()
    with open(path, encoding="utf8") as handle:
        return handle.read()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="archimed-jobagent")
    sub = parser.add_subparsers(dest="command", required=True)

    search_parser = sub.add_parser("search", help="chercher des annonces")
    search_parser.add_argument("--request", help="fichier JSON de la demande (« - » = stdin)")
    search_parser.set_defaults(run=command_search)

    sub.add_parser("sources", help="plateformes, pays et niveaux disponibles").set_defaults(
        run=command_sources
    )

    detail_parser = sub.add_parser("detail", help="texte complet d'une annonce")
    detail_parser.add_argument("--url", required=True)
    detail_parser.set_defaults(run=command_detail)

    contacts_parser = sub.add_parser("contacts", help="contact d'une entreprise")
    contacts_parser.add_argument("--company", required=True)
    contacts_parser.add_argument("--url", help="site de l'entreprise, s'il est connu")
    contacts_parser.add_argument(
        "--known", action="append", help="adresse déjà connue (répétable)"
    )
    contacts_parser.set_defaults(run=command_contacts)

    cv_parser = sub.add_parser("cv", help="lire un CV")
    cv_parser.add_argument("--file", required=True)
    cv_parser.set_defaults(run=command_cv)

    send_parser = sub.add_parser("send", help="envoyer une candidature")
    send_parser.add_argument("--payload", help="fichier JSON (« - » = stdin)")
    send_parser.set_defaults(run=command_send)

    smtp_parser = sub.add_parser("smtp", help="réglages d'envoi connus pour une adresse")
    smtp_parser.add_argument("--address", required=True)
    smtp_parser.set_defaults(run=command_smtp)

    sub.add_parser("doctor", help="vérifier l'installation").set_defaults(run=command_doctor)

    _utf8_output()
    args = parser.parse_args(argv)
    try:
        return args.run(args)
    except Exception as error:  # l'interface doit toujours recevoir une ligne exploitable
        emit({"event": "error", "message": f"{type(error).__name__}: {error}"})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
