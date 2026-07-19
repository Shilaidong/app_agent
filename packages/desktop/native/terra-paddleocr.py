import json
import os
import sys
import tempfile
from pathlib import Path

import fitz
from paddleocr import PaddleOCR


def bundled_path() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).parent))


def create_ocr() -> PaddleOCR:
    os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
    models = bundled_path() / "models"
    return PaddleOCR(
        text_detection_model_name="PP-OCRv6_medium_det",
        text_detection_model_dir=str(models / "PP-OCRv6_medium_det"),
        text_recognition_model_name="PP-OCRv6_medium_rec",
        text_recognition_model_dir=str(models / "PP-OCRv6_medium_rec"),
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )


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


def emit_jsonl(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def process_files(paths: list[Path], *, jsonl: bool) -> int:
    missing = [path for path in paths if not path.is_file()]
    if missing:
        print(f"terra-paddleocr: file not found: {missing[0]}", file=sys.stderr)
        return 66

    ocr = create_ocr()
    if not jsonl:
        if len(paths) != 1:
            print("Usage: terra-paddleocr <file>", file=sys.stderr)
            return 64
        print(extract(ocr, paths[0]))
        return 0

    for index, source in enumerate(paths, start=1):
        try:
            text = extract(ocr, source)
            emit_jsonl(
                {
                    "ok": True,
                    "index": index,
                    "total": len(paths),
                    "file": str(source),
                    "text": text,
                    "textLength": len(text),
                    "error": "",
                }
            )
        except Exception as error:  # noqa: BLE001 - surface per-file OCR failures without aborting the batch
            emit_jsonl(
                {
                    "ok": False,
                    "index": index,
                    "total": len(paths),
                    "file": str(source),
                    "text": "",
                    "textLength": 0,
                    "error": str(error),
                }
            )
    return 0


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("Usage: terra-paddleocr [--jsonl] <file> [file...]", file=sys.stderr)
        return 64

    jsonl = False
    if args[0] == "--jsonl":
        jsonl = True
        args = args[1:]
    if not args:
        print("Usage: terra-paddleocr [--jsonl] <file> [file...]", file=sys.stderr)
        return 64

    return process_files([Path(item) for item in args], jsonl=jsonl)


if __name__ == "__main__":
    raise SystemExit(main())
