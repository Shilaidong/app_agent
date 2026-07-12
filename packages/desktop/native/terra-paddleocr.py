import os
import sys
import tempfile
from pathlib import Path

import fitz
from paddleocr import PaddleOCR


def bundled_path() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).parent))


def recognize(ocr: PaddleOCR, image: str) -> str:
    return "\n".join(
        text.strip()
        for result in ocr.predict(image)
        for text in result.get("rec_texts", [])
        if text and text.strip()
    )


def extract(ocr: PaddleOCR, source: Path) -> str:
    if source.suffix.lower() != ".pdf":
        return recognize(ocr, str(source))

    document = fitz.open(source)
    try:
        with tempfile.TemporaryDirectory(prefix="terra-paddleocr-") as directory:
            pages = []
            for index, page in enumerate(document):
                image = Path(directory, f"page-{index + 1}.png")
                page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(image)
                text = recognize(ocr, str(image))
                if text:
                    pages.append(f"--- Page {index + 1} ---\n{text}")
            return "\n\n".join(pages)
    finally:
        document.close()


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: terra-paddleocr <file>", file=sys.stderr)
        return 64

    source = Path(sys.argv[1])
    if not source.is_file():
        print(f"terra-paddleocr: file not found: {source}", file=sys.stderr)
        return 66

    os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
    models = bundled_path() / "models"
    ocr = PaddleOCR(
        text_detection_model_name="PP-OCRv6_medium_det",
        text_detection_model_dir=str(models / "PP-OCRv6_medium_det"),
        text_recognition_model_name="PP-OCRv6_medium_rec",
        text_recognition_model_dir=str(models / "PP-OCRv6_medium_rec"),
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    print(extract(ocr, source))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
