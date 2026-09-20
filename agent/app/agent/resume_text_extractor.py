"""
Resume text extraction: the actual "read the file" step.

Uses PyMuPDF for PDFs and python-pptx for PPTX — both mature, actively
maintained libraries purpose-built for their format (PyMuPDF in
particular is a fast, robust C-library binding, not a regex-over-XML
approximation). This lives in the same service as the vision fallback
(vision.py) since both are "how do we turn this file into something the
LLM can read" concerns, and sharing one text-quality heuristic here avoids
Node and Python each guessing independently at what counts as "enough
text".
"""
import io

import pymupdf as fitz
from pptx import Presentation


def extract_text_from_pdf(file_bytes: bytes) -> str:
    with fitz.open(stream=file_bytes, filetype="pdf") as doc:
        return "\n".join(page.get_text() for page in doc)


def extract_text_from_pptx(file_bytes: bytes) -> str:
    presentation = Presentation(io.BytesIO(file_bytes))
    slide_texts = []
    for slide in presentation.slides:
        runs = [
            shape.text_frame.text
            for shape in slide.shapes
            if shape.has_text_frame and shape.text_frame.text.strip()
        ]
        slide_texts.append("\n".join(runs))
    return "\n".join(slide_texts)


def extract_resume_text(file_bytes: bytes, file_format: str) -> str:
    if file_format == "pdf":
        return extract_text_from_pdf(file_bytes)
    if file_format == "pptx":
        return extract_text_from_pptx(file_bytes)
    raise ValueError(f"Unsupported resume file format: {file_format}")
