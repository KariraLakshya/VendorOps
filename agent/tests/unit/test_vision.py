import io
import zipfile

import pymupdf as fitz
import pytest

from app.agent.vision import (
    extract_pptx_embedded_images,
    render_pdf_pages_to_images,
    render_resume_to_images,
)


def make_test_pdf(num_pages: int = 2) -> bytes:
    doc = fitz.open()
    for _ in range(num_pages):
        page = doc.new_page()
        page.insert_text((72, 72), "Hello resume")
    data = doc.tobytes()
    doc.close()
    return data


def make_test_pptx_with_images(image_count: int = 2) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("ppt/slides/slide1.xml", "<p:sld/>")
        for i in range(image_count):
            zf.writestr(f"ppt/media/image{i + 1}.png", b"\x89PNG\r\n\x1a\nfake-png-bytes")
        zf.writestr("ppt/media/notes1.xml", "<not-an-image/>")
    return buffer.getvalue()


class TestRenderPdfPagesToImages:
    def test_renders_one_image_per_page(self):
        pdf_bytes = make_test_pdf(num_pages=3)
        images = render_pdf_pages_to_images(pdf_bytes, max_pages=10)
        assert len(images) == 3
        for image in images:
            assert image.mime_type == "image/png"
            assert image.data.startswith(b"\x89PNG")

    def test_respects_max_pages_cap(self):
        pdf_bytes = make_test_pdf(num_pages=5)
        images = render_pdf_pages_to_images(pdf_bytes, max_pages=2)
        assert len(images) == 2


class TestExtractPptxEmbeddedImages:
    def test_extracts_only_image_media_entries(self):
        pptx_bytes = make_test_pptx_with_images(image_count=3)
        images = extract_pptx_embedded_images(pptx_bytes, max_images=10)
        assert len(images) == 3
        assert all(image.mime_type == "image/png" for image in images)

    def test_respects_max_images_cap(self):
        pptx_bytes = make_test_pptx_with_images(image_count=5)
        images = extract_pptx_embedded_images(pptx_bytes, max_images=2)
        assert len(images) == 2

    def test_returns_empty_list_when_no_embedded_images(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as zf:
            zf.writestr("ppt/slides/slide1.xml", "<p:sld/>")
        images = extract_pptx_embedded_images(buffer.getvalue(), max_images=10)
        assert images == []


class TestRenderResumeToImages:
    def test_dispatches_pdf_to_page_rendering(self):
        pdf_bytes = make_test_pdf(num_pages=1)
        images = render_resume_to_images(pdf_bytes, "pdf", max_images=5)
        assert len(images) == 1

    def test_dispatches_pptx_to_media_extraction(self):
        pptx_bytes = make_test_pptx_with_images(image_count=1)
        images = render_resume_to_images(pptx_bytes, "pptx", max_images=5)
        assert len(images) == 1

    def test_rejects_unsupported_format(self):
        with pytest.raises(ValueError):
            render_resume_to_images(b"data", "docx", max_images=5)
