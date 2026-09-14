"""Turn an uploaded report into plain text.

Hybrid extraction engine:
1. `pdfplumber` for digital text layer.
2. Per-page adaptive Tesseract OCR for scanned attachments, USG reports, landscape ECGs, and PFT curves.
3. Orientation auto-detection (0, 90, 180, 270 deg) for landscape diagnostic pages.
"""

from __future__ import annotations

import logging
import shutil
import re
from typing import Literal

from .config import settings

log = logging.getLogger(__name__)

ExtractionMethod = Literal["pdf_text", "ocr", "none"]


def ocr_available() -> bool:
    return shutil.which("tesseract") is not None


def _score_text_quality(text: str) -> int:
    """Score the medical information density of extracted text."""
    if not text:
        return 0
    keywords = [
        "conclusions", "impression", "findings", "ecg", "axis", "infarction",
        "ultrasound", "pft", "spirometry", "hepatomegaly", "prostatomegaly",
        "liver", "kidney", "prostate", "fev1", "fvc", "pef", "glucose", "serum",
        "reference", "result", "normal", "abnormal", "hemoglobin", "cholesterol",
        "left axis deviation", "myocardial", "pr interval", "qt/qtc"
    ]
    text_lower = text.lower()
    kw_hits = sum(1 for kw in keywords if kw in text_lower)
    return len(text.strip()) + (kw_hits * 150)


def _extract_pdf_hybrid(path: str) -> tuple[str, ExtractionMethod]:
    import pdfplumber
    import pytesseract

    has_ocr = ocr_available()
    parts: list[str] = []
    used_ocr = False

    with pdfplumber.open(path) as pdf:
        for idx, page in enumerate(pdf.pages, 1):
            digital_text = page.extract_text(layout=True) or page.extract_text() or ""
            best_page_text = digital_text.strip()

            # Check if this page needs OCR (scanned attachment, "REPORT ATTACHED", or sparse text)
            needs_ocr = (
                len(best_page_text) < 100
                or "REPORT ATTACHED" in best_page_text.upper()
                or (len(page.images) > 0 and len(best_page_text) < 500)
            )

            if needs_ocr and has_ocr:
                try:
                    img = page.to_image(resolution=200).original
                    # Test normal 0 deg
                    ocr_0 = pytesseract.image_to_string(img.convert("L"), lang=settings.ocr_languages)
                    best_ocr = ocr_0
                    best_score = _score_text_quality(ocr_0)

                    # For scanned reports / landscape diagrams (like ECGs), test rotations
                    for rot in [270, 90, 180]:
                        rot_img = img.rotate(rot, expand=True)
                        ocr_rot = pytesseract.image_to_string(rot_img.convert("L"), lang=settings.ocr_languages)
                        score = _score_text_quality(ocr_rot)
                        if score > best_score:
                            best_score = score
                            best_ocr = ocr_rot

                    if _score_text_quality(best_ocr) > _score_text_quality(digital_text):
                        used_ocr = True
                        if digital_text and len(digital_text) > 40 and "REPORT ATTACHED" not in digital_text.upper():
                            best_page_text = f"{digital_text}\n\n[Scanned Page Content]:\n{best_ocr.strip()}"
                        else:
                            best_page_text = best_ocr.strip()
                except Exception as e:
                    log.warning("Page %d OCR failed: %s", idx, e)

            if best_page_text:
                parts.append(f"--- Page {idx} ---\n{best_page_text}")

    full_text = "\n\n".join(parts).strip()
    method: ExtractionMethod = "ocr" if used_ocr else "pdf_text"
    return full_text[: settings.max_document_chars], method


def _ocr_image(path: str) -> str:
    import pytesseract
    from PIL import Image

    with Image.open(path) as image:
        img_l = image.convert("L")
        best_ocr = pytesseract.image_to_string(img_l, lang=settings.ocr_languages).strip()
        best_score = _score_text_quality(best_ocr)

        # Check rotations for landscape mobile photos
        for rot in [270, 90, 180]:
            rot_img = image.rotate(rot, expand=True).convert("L")
            rot_ocr = pytesseract.image_to_string(rot_img, lang=settings.ocr_languages).strip()
            score = _score_text_quality(rot_ocr)
            if score > best_score:
                best_score = score
                best_ocr = rot_ocr

        return best_ocr


# Claude reads images best under ~1600px on the long side, and a phone photo
# or a 300-dpi scan is several times that. Downscaling also keeps the request
# well inside the size limit without touching the file the clinic stored.
_VISION_MAX_SIDE = 1568


def image_for_vision(path: str, content_type: str) -> tuple[bytes, str] | None:
    """The report as one JPEG for a vision model, or None if it cannot be made.

    An image file is used as it is (downscaled); a PDF contributes its first
    page, rendered — imaging reports are one page, and a scanned multi-page
    document with no text on any page is not something a picture of page one
    would rescue anyway. Never raises.
    """
    import io

    from PIL import Image

    is_pdf = content_type == "application/pdf" or path.lower().endswith(".pdf")
    try:
        if is_pdf:
            import pdfplumber

            with pdfplumber.open(path) as pdf:
                if not pdf.pages:
                    return None
                image = pdf.pages[0].to_image(resolution=150).original.copy()
        else:
            with Image.open(path) as opened:
                image = opened.copy()

        image = image.convert("RGB")
        image.thumbnail((_VISION_MAX_SIDE, _VISION_MAX_SIDE))
        buf = io.BytesIO()
        image.save(buf, format="JPEG", quality=88)
        return buf.getvalue(), "image/jpeg"
    except Exception as err:
        log.warning("Could not prepare the image for the vision model: %s", err)
        return None


def extract_text(path: str, content_type: str) -> tuple[str, ExtractionMethod]:
    """Return (text, method). Never raises — an unreadable file yields ("", "none")."""
    is_pdf = content_type == "application/pdf" or path.lower().endswith(".pdf")
    is_text = content_type.startswith("text/") or path.lower().endswith((".txt", ".csv", ".tsv", ".json"))

    if is_text:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                return f.read()[: settings.max_document_chars], "pdf_text"
        except Exception:
            pass

    if is_pdf:
        try:
            return _extract_pdf_hybrid(path)
        except Exception as err:
            log.warning("PDF extraction failed: %s", err)
            return "", "none"

    if not ocr_available():
        return "", "none"
    try:
        return _ocr_image(path)[: settings.max_document_chars], "ocr"
    except Exception as err:
        log.warning("Image OCR failed: %s", err)
        return "", "none"
