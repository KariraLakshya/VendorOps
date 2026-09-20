import base64


def image_to_data_url(data: bytes, mime_type: str) -> str:
    """Encodes raw image bytes as a `data:` URL suitable for a vision
    model's `image_url` content part."""
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"
