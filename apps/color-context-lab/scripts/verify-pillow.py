"""Independent exact-RGBA oracle for export-fixtures.ts; optional Pillow check."""
from pathlib import Path
from PIL import Image

for size in (2, 976):
    with Image.open(f"/tmp/color-context-{size}.png") as image:
        assert image.size == (size, size)
        assert image.mode == "RGBA"
        assert image.tobytes() == Path(f"/tmp/color-context-{size}.rgba").read_bytes()
        assert image.getpixel((0, 0)) == (19, 92, 165, 0)
    print(f"Pillow: exact {size}x{size} RGBA, including invisible RGB")
