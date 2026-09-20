"""
Vision fallback for scanned / image-based resumes.

When a PDF or PPTX has little-to-no extractable text layer (a scan, or a
resume pasted in as a picture), classic text extraction returns near-empty
content and the LLM would otherwise be asked to extract fields from
nothing. Instead of adding a separate OCR engine + binary dependency
(Tesseract, poppler, etc.), this renders the document to images and hands
them directly to a Groq vision-capable model, which performs extraction
straight from pixels in one step.
"""
import io
import zipfile
from dataclasses import dataclass

import pymupdf as fitz  # PyMuPDF; "fitz" is the deprecated import alias

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp")


@dataclass
class RenderedImage:
    data: bytes
    mime_type: str


def render_pdf_pages_to_images(file_bytes: bytes, max_pages: int) -> list[RenderedImage]:
    """Rasterizes up to `max_pages` pages of a PDF to PNG images."""
    images: list[RenderedImage] = []
    with fitz.open(stream=file_bytes, filetype="pdf") as doc:
        for page_index in range(min(len(doc), max_pages)):
            page = doc.load_page(page_index)
            # 2x zoom for a legible resolution without needlessly bloating payload size.
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2))
            images.append(RenderedImage(data=pixmap.tobytes("png"), mime_type="image/png"))
    return images


def extract_pptx_embedded_images(file_bytes: bytes, max_images: int) -> list[RenderedImage]:
    """Pulls raster images embedded in a .pptx's media parts (covers the
    common case of a resume pasted into a slide as a picture). This does
    NOT render full slide layouts — just the embedded pictures."""
    images: list[RenderedImage] = []
    with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
        media_names = sorted(
            name
            for name in zf.namelist()
            if name.startswith("ppt/media/") and name.lower().endswith(IMAGE_EXTENSIONS)
        )
        for name in media_names[:max_images]:
            ext = name.rsplit(".", 1)[-1].lower()
            mime_type = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
            images.append(RenderedImage(data=zf.read(name), mime_type=mime_type))
    return images


def render_resume_to_images(
    file_bytes: bytes, file_format: str, max_images: int
) -> list[RenderedImage]:
    if file_format == "pdf":
        return render_pdf_pages_to_images(file_bytes, max_images)
    if file_format == "pptx":
        return extract_pptx_embedded_images(file_bytes, max_images)
    raise ValueError(f"Unsupported file format for vision fallback: {file_format}")
