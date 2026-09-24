"""Envoi des candidatures par e-mail (SMTP), sans dépendance extérieure.

ARCHIMED n'envoie jamais de lui-même : c'est la personne qui lance un lot, après avoir vu
la liste des destinataires. Ce module ne fait qu'exécuter l'envoi demandé.

Les identifiants ne sont jamais écrits ici : ils arrivent dans la charge utile, déchiffrés
juste avant l'appel par le côté Rust (voir `secrets.rs`).
"""

from __future__ import annotations

import mimetypes
import smtplib
import ssl
from email.message import EmailMessage
from pathlib import Path
from typing import Any

#: Serveurs courants, pour épargner la configuration manuelle.
KNOWN_HOSTS: dict[str, dict[str, Any]] = {
    "gmail.com": {"host": "smtp.gmail.com", "port": 587, "starttls": True},
    "googlemail.com": {"host": "smtp.gmail.com", "port": 587, "starttls": True},
    "outlook.com": {"host": "smtp-mail.outlook.com", "port": 587, "starttls": True},
    "hotmail.com": {"host": "smtp-mail.outlook.com", "port": 587, "starttls": True},
    "live.fr": {"host": "smtp-mail.outlook.com", "port": 587, "starttls": True},
    "yahoo.fr": {"host": "smtp.mail.yahoo.com", "port": 587, "starttls": True},
    "yahoo.com": {"host": "smtp.mail.yahoo.com", "port": 587, "starttls": True},
    "orange.fr": {"host": "smtp.orange.fr", "port": 587, "starttls": True},
    "free.fr": {"host": "smtp.free.fr", "port": 587, "starttls": True},
    "sfr.fr": {"host": "smtp.sfr.fr", "port": 587, "starttls": True},
    "laposte.net": {"host": "smtp.laposte.net", "port": 587, "starttls": True},
    "icloud.com": {"host": "smtp.mail.me.com", "port": 587, "starttls": True},
}


def guess_host(address: str) -> dict[str, Any] | None:
    """Réglages SMTP connus pour une adresse, `None` si le domaine est inconnu."""
    domain = address.split("@")[-1].strip().lower()
    return KNOWN_HOSTS.get(domain)


def build(payload: dict) -> EmailMessage:
    """Compose le message : corps en texte, CV en pièce jointe."""
    message = EmailMessage()
    message["From"] = payload["from"]
    message["To"] = payload["to"]
    message["Subject"] = payload.get("subject") or "Candidature"
    if payload.get("reply_to"):
        message["Reply-To"] = payload["reply_to"]
    message.set_content(payload.get("body") or "")

    for path in payload.get("attachments") or []:
        file = Path(path)
        if not file.exists():
            continue
        kind, _ = mimetypes.guess_type(file.name)
        main, _, sub = (kind or "application/octet-stream").partition("/")
        message.add_attachment(
            file.read_bytes(),
            maintype=main,
            subtype=sub or "octet-stream",
            filename=file.name,
        )
    return message


def send(payload: dict) -> dict:
    """Envoie un message. Renvoie `{sent: True}` ou `{error: "…"}`, jamais d'exception."""
    smtp = payload.get("smtp") or {}
    host = smtp.get("host")
    port = int(smtp.get("port") or 587)
    if not host:
        return {"error": "serveur d'envoi non configuré"}
    if not payload.get("to"):
        return {"error": "aucune adresse de destination"}

    try:
        message = build(payload)
    except Exception as error:
        return {"error": f"message illisible : {error}"}

    context = ssl.create_default_context()
    try:
        if smtp.get("ssl"):
            server = smtplib.SMTP_SSL(host, port, timeout=45, context=context)
        else:
            server = smtplib.SMTP(host, port, timeout=45)
        with server:
            server.ehlo()
            if not smtp.get("ssl") and smtp.get("starttls", True):
                server.starttls(context=context)
                server.ehlo()
            if smtp.get("user"):
                server.login(smtp["user"], smtp.get("password") or "")
            server.send_message(message)
    except smtplib.SMTPAuthenticationError:
        return {
            "error": "identifiants refusés par le serveur. Avec Gmail ou Outlook, "
            "il faut un mot de passe d'application, pas le mot de passe du compte."
        }
    except Exception as error:
        return {"error": f"{type(error).__name__}: {error}"}

    return {"sent": True, "to": payload["to"]}
