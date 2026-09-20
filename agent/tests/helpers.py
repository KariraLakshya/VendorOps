"""Shared test helpers. Tests exercise the real extraction pipeline now
(no more pre-extracted-text shortcut), so several of them need a real,
tiny PDF to hand the agent."""
import base64

import pymupdf as fitz


def make_pdf_b64(text: str = "", num_pages: int = 1) -> str:
    doc = fitz.open()
    for _ in range(num_pages):
        page = doc.new_page()
        if text:
            page.insert_text((72, 72), text)
    data = doc.tobytes()
    doc.close()
    return base64.b64encode(data).decode("ascii")
