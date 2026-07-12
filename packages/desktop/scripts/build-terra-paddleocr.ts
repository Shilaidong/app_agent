import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"

const cache = path.resolve(".cache/terra-paddleocr")
const python = path.join(cache, "venv/bin/python")
const models = path.join(cache, "models")
const target = path.resolve("resources/vendor/terra-paddleocr")
const source = path.resolve("native/terra-paddleocr.py")
const uv = Bun.which("uv")

if (process.platform !== "darwin") throw new Error("The bundled PaddleOCR tool is built for macOS customer packages.")
if (!uv) throw new Error("Building bundled PaddleOCR requires uv. Install it from https://docs.astral.sh/uv/.")

async function run(command: string[], env = process.env) {
  const child = Bun.spawn(command, { cwd: path.resolve("."), env, stdout: "inherit", stderr: "inherit" })
  if ((await child.exited) !== 0) throw new Error(`Command failed: ${command.join(" ")}`)
}

await mkdir(cache, { recursive: true })
if (!existsSync(python)) await run([uv, "venv", "--python", "3.11", path.join(cache, "venv")])

await run([
  uv,
  "pip",
  "install",
  "--python",
  python,
  "paddlepaddle==3.2.1",
  "paddleocr==3.7.0",
  "paddlex[ocr-core]==3.7.2",
  "PyMuPDF==1.26.7",
  "pyinstaller==6.21.0",
])

const paddleEnv = {
  ...process.env,
  PADDLE_PDX_CACHE_HOME: models,
  PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True",
}

await run(
  [
    python,
    "-c",
    [
      "from paddleocr import PaddleOCR",
      "PaddleOCR(text_detection_model_name='PP-OCRv6_medium_det', text_recognition_model_name='PP-OCRv6_medium_rec', use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False)",
    ].join("; "),
  ],
  paddleEnv,
)

const detector = path.join(models, "official_models/PP-OCRv6_medium_det")
const recognizer = path.join(models, "official_models/PP-OCRv6_medium_rec")
if (!existsSync(detector) || !existsSync(recognizer)) throw new Error("PaddleOCR model prefetch did not produce the required local models.")

await rm(target, { recursive: true, force: true })
await mkdir(path.dirname(target), { recursive: true })
await run([
  path.join(cache, "venv/bin/pyinstaller"),
  "--noconfirm",
  "--clean",
  "--onedir",
  "--name",
  "terra-paddleocr",
  "--distpath",
  path.dirname(target),
  "--workpath",
  path.join(cache, "work"),
  "--specpath",
  path.join(cache, "spec"),
  "--collect-all",
  "paddleocr",
  "--collect-all",
  "paddlex",
  "--copy-metadata",
  "imagesize",
  "--copy-metadata",
  "opencv-contrib-python",
  "--copy-metadata",
  "pyclipper",
  "--copy-metadata",
  "pypdfium2",
  "--copy-metadata",
  "python-bidi",
  "--copy-metadata",
  "shapely",
  "--add-data",
  `${detector}:models/PP-OCRv6_medium_det`,
  "--add-data",
  `${recognizer}:models/PP-OCRv6_medium_rec`,
  source,
])

if (!existsSync(path.join(target, "terra-paddleocr"))) throw new Error("PaddleOCR package build did not produce an executable.")
