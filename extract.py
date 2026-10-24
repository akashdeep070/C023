"""Turn an uploaded file into a list of (page_number, text)."""

import io
import os

from pypdf import PdfReader

import ai

ALLOWED = {".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/plain",
           ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
MAX_PDF_PAGES = 60  # keeps extraction cheap on a t3.micro
PAGE_CHARS = 2500


def allowed(filename):
    return os.path.splitext(filename.lower())[1] in ALLOWED


def mime_for(filename):
    return ALLOWED.get(os.path.splitext(filename.lower())[1], "application/octet-stream")


def _chunk(text):
    """Split long plain text into ~2,500 character 'pages' at paragraph breaks."""
    pages, cur = [], ""
    for para in text.split("\n\n"):
        if cur and len(cur) + len(para) > PAGE_CHARS:
            pages.append(cur)
            cur = ""
        cur += para + "\n\n"
    if cur.strip():
        pages.append(cur)
    return pages or [""]


def extract_pages(data, filename):
    """Return (pages, note). `note` explains anything the user should know."""
    ext = os.path.splitext(filename.lower())[1]
    if ext == ".pdf":
        reader = PdfReader(io.BytesIO(data))
        pages = [(i + 1, (p.extract_text() or "").strip())
                 for i, p in enumerate(reader.pages[:MAX_PDF_PAGES])]
        note = ""
        if len(reader.pages) > MAX_PDF_PAGES:
            note = f"Only the first {MAX_PDF_PAGES} pages were read."
        if not any(t for _, t in pages):
            note = "This PDF has no text layer (it is a scan). Upload the pages as photos to read them with AI."
        return pages, note
    if ext in (".txt", ".md"):
        text = data.decode("utf-8", errors="replace").replace("\r\n", "\n")
        parts = text.split("\f") if "\f" in text else _chunk(text)
        return [(i + 1, p.strip()) for i, p in enumerate(parts)], ""
    text, note = ai.read_image(data, ALLOWED[ext])
    return [(1, text)], note
