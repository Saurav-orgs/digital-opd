"""Turn an uploaded report into plain text.

Two paths, in order of preference:
  1. `pdfplumber` for PDFs that carry a real text layer — exact, instant, free.
  2. Tesseract OCR for photographed reports and image-only PDFs, which is what
     most Indian lab reports actually are.

OCR output is noisy; the summariser prompt is told when text came from OCR so it
can treat it with appropriate suspicion.
"""

from __future__ import annotations

import logging
import shutil
from typing import Literal

from .config import settings

log = logging.getLogger(__name__)

ExtractionMethod = Literal["pdf_text", "ocr", "none"]

# A PDF page with only a scanned image still yields a few stray characters, so
# require a meaningful amount of text before trusting the text layer.
_MIN_PDF_TEXT_CHARS = 120


def ocr_available() -> bool:
    return shutil.which("tesseract") is not None


def _extract_pdf_text(path: str) -> str:
    import pdfplumber

    parts: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            parts.append(page.extract_text() or "")
    return "\n".join(parts).strip()


def _ocr_pdf(path: str) -> str:
    """Rasterise each page, then OCR it."""
    import pdfplumber
    import pytesseract

    parts: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            image = page.to_image(resolution=200).original
            parts.append(pytesseract.image_to_string(image, lang=settings.ocr_languages))
    return "\n".join(parts).strip()


def _ocr_image(path: str) -> str:
    import pytesseract
    from PIL import Image

    with Image.open(path) as image:
        # Reports photographed in poor light OCR better in greyscale.
        return pytesseract.image_to_string(image.convert("L"), lang=settings.ocr_languages).strip()


def extract_text(path: str, content_type: str) -> tuple[str, ExtractionMethod]:
    """Return (text, method). Never raises — an unreadable file yields ("", "none")."""
    is_pdf = content_type == "application/pdf" or path.lower().endswith(".pdf")

    if is_pdf:
        try:
            text = _extract_pdf_text(path)
            if len(text) >= _MIN_PDF_TEXT_CHARS:
                return text[: settings.max_document_chars], "pdf_text"
        except Exception as err:
            log.warning("PDF text extraction failed, falling back to OCR: %s", err)

        if not ocr_available():
            return "", "none"
        try:
            return _ocr_pdf(path)[: settings.max_document_chars], "ocr"
        except Exception as err:
            log.warning("PDF OCR failed: %s", err)
            return "", "none"

    if not ocr_available():
        return "", "none"
    try:
        return _ocr_image(path)[: settings.max_document_chars], "ocr"
    except Exception as err:
        log.warning("Image OCR failed: %s", err)
        return "", "none"
