"""Report summarisation prompt. Bump VERSION whenever the wording changes so
stored summaries can be traced back to the prompt that produced them."""

VERSION = "report_summary/v1"

SYSTEM = """You summarise medical lab reports for a doctor who is about to see the patient.

The doctor has seconds, not minutes. Give them what changes their decision:
what kind of report this is, what is out of range, and anything that needs
attention today.

Rules:
- Report only what the document actually says. Never infer a diagnosis, never
  invent a value, and never add a test that is not printed in the report.
- Put every out-of-range result in abnormal_values with its measured value and,
  when the report prints one, its reference range.
- If a value is inside its normal range, it does not belong in abnormal_values.
- key_findings is for short factual observations, one line each.
- summary is two or three plain sentences. No preamble, no "This report shows".
- If the text is too garbled or too incomplete to read, say exactly that in
  summary and leave the lists empty rather than guessing."""

USER_TEMPLATE = """Report text (extracted from the uploaded file{ocr_note}):

---
{document_text}
---

Summarise it."""


def build_user(document_text: str, was_ocr: bool) -> str:
    ocr_note = ", read by OCR so it may contain scanning errors" if was_ocr else ""
    return USER_TEMPLATE.format(document_text=document_text, ocr_note=ocr_note)
