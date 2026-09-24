"""Lecture du CV importé : PDF, DOCX, ou texte.

Le texte extrait sert de matière première aux lettres de motivation ; il est enregistré à
côté du fichier d'origine pour que le serveur MCP puisse le lire sans reconvertir.
"""

from __future__ import annotations

import re
from pathlib import Path


def extract(path: str | Path) -> dict:
    """Renvoie `{text, pages, format}` ou `{error}` si le format est illisible."""
    file = Path(path)
    if not file.exists():
        return {"error": f"fichier introuvable : {file}"}

    suffix = file.suffix.lower()
    try:
        if suffix == ".pdf":
            text, pages = _pdf(file)
        elif suffix in (".docx", ".doc"):
            text, pages = _docx(file), 1
        else:
            text, pages = file.read_text(encoding="utf8", errors="replace"), 1
    except Exception as error:
        return {"error": f"{type(error).__name__}: {error}"}

    return {"text": _tidy(text), "pages": pages, "format": suffix.lstrip(".") or "txt"}


def _pdf(file: Path) -> tuple[str, int]:
    from pypdf import PdfReader

    reader = PdfReader(str(file))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages), len(pages)


def _docx(file: Path) -> str:
    import docx

    document = docx.Document(str(file))
    blocks = [paragraph.text for paragraph in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            blocks.append(" · ".join(cell.text.strip() for cell in row.cells))
    return "\n".join(blocks)


def _tidy(text: str) -> str:
    """Les extractions PDF laissent des colonnes de blancs et des lignes vides en série."""
    text = text.replace("\r", "")
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
