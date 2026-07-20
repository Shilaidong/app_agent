// Offline regression harness for the ego-browser nodejs capability blacklist.
//
// Phase 2 step C of the 1.1.3 release: run this against the real heredoc corpus
// captured from an on-device fill session to confirm the wrapper's exit-85
// blacklist produces ZERO hits on legitimate browser automation scripts.
//
// Main check feeds each corpus file to the REAL generated wrapper (the same
// writeOpenCodeConfig output that ships) with a stub helper so it never launches
// Ego Lite. exit 85 fires during the grep stage, before any Ego readiness check,
// so a stub helper is sufficient and no real browser opens.
//
// Pattern extraction is DIAGNOSTIC ONLY: it runs only when a corpus file already
// hit exit 85, to tell the human which of the 6 patterns matched. The count of
// patterns is asserted up front so a wrapper format change cannot silently weaken
// the harness into "zero hits" by extracting fewer patterns.
//
// Usage:
//   bun run scripts/verify-ego-nodejs-blacklist-corpus.ts <corpus-dir>
//
// Corpus format: one file per real heredoc round, file body = exact heredoc
// text the agent submitted (the bash tool input, NOT the wrapper output).

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, chmod } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeOpenCodeConfig } from "../src/main/application-agent-opencode"

// The wrapper must ship exactly this many exit-85 capability grep patterns.
// If the wrapper grows or shrinks the blacklist, update this constant deliberately.
// A silent drop from 6 to 3 patterns would make "zero hits" meaningless.
const EXPECTED_PATTERN_COUNT = 6
const DENIED_MARKER = "TERRA_EGO_NODE_CAPABILITY_DENIED"

async function main() {
  const corpusDir = process.argv[2]
  if (!corpusDir) {
    console.error("Usage: bun run scripts/verify-ego-nodejs-blacklist-corpus.ts <corpus-dir>")
    process.exit(64)
  }

  const files = (await readdir(corpusDir)).sort()
  if (files.length === 0) {
    console.error(`Corpus directory is empty: ${corpusDir}`)
    console.error("Drop one file per real heredoc round into it and rerun.")
    process.exit(64)
  }

  // Generate the real wrapper into a temp workspace, with a stub helper so the
  // wrapper never tries to launch Ego Lite. exit 85 fires before the readiness
  // loop, so the stub is never reached on a blacklisted script and simply
  // returns STUB_OK on a clean script.
  const workspace = await mkdtemp(join(tmpdir(), "ego-blacklist-corpus-"))
  try {
    await mkdir(join(workspace, "03_state"), { recursive: true })
    const helper = join(workspace, "ego-browser-helper-stub")
    await writeFile(
      helper,
      `#!/bin/sh
set -eu
if [ "\${1:-}" = "taskspace" ] && [ "\${2:-}" = "list" ]; then
  printf '%s\\n' '[]'
  exit 0
fi
[ "\${1:-}" = "nodejs" ] || exit 64
printf '%s\\n' 'STUB_OK'
exit 0
`,
      "utf8",
    )
    await chmod(helper, 0o755)
    await writeOpenCodeConfig(workspace, {
      egoBrowserTestHelperPath: helper,
      egoBrowserReadinessAttempts: 2,
    })
    const wrapperPath = join(workspace, ".opencode", "bin", "ego-browser")

    // Up-front count assertion: fail loudly if the wrapper does not carry the
    // expected exit-85 blacklist. This guards against a format change silently
    // extracting fewer patterns and reporting a false "zero hits".
    const wrapperText = await readFile(wrapperPath, "utf8")
    const patternLines = extractBlacklistPatterns(wrapperText)
    if (patternLines.length !== EXPECTED_PATTERN_COUNT) {
      console.error(
        `Expected ${EXPECTED_PATTERN_COUNT} exit-85 blacklist grep patterns in generated wrapper, found ${patternLines.length}.`,
      )
      console.error("Update EXPECTED_PATTERN_COUNT only after a deliberate blacklist change.")
      console.error("Patterns extracted:")
      for (const raw of patternLines) console.error("  " + raw)
      if (patternLines.length === 0) console.error(`Checked wrapper: ${wrapperPath}`)
      process.exit(70)
    }
    console.log(`Asserted ${EXPECTED_PATTERN_COUNT} exit-85 blacklist grep patterns present in generated wrapper.`)
    console.log("")

    const wrapper = wrapperPath
    let checked = 0
    let hits = 0
    const failures: Array<{ file: string; status: number | null; stderr: string; preview: string; matchedPatterns: string[] }> = []

    for (const name of files) {
      const body = await readFile(join(corpusDir, name), "utf8")
      checked += 1
      const result = spawnSync(wrapper, ["nodejs"], {
        cwd: workspace,
        input: body + "\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${join(workspace, ".opencode/bin")}:${process.env.PATH || ""}`,
        },
      })
      const status = result.status
      const stderr = result.stderr || ""
      if (status === 85 || stderr.includes(DENIED_MARKER)) {
        hits += 1
        // Diagnostic only: identify which patterns matched this file so the
        // human can decide whether the blacklist or the corpus is wrong.
        const matchedPatterns = patternLines
          .map((raw) => ({ raw, pattern: extractPattern(raw) }))
          .filter((entry) => entry.pattern !== null)
          .filter((entry) => {
            const r = spawnSync("/usr/bin/grep", ["-Eiq", entry.pattern as string], {
              input: body.replace(/\r|\n|\t/g, " "),
              encoding: "utf8",
            })
            return r.status === 0
          })
          .map((entry) => entry.raw)
        failures.push({
          file: name,
          status,
          stderr: stderr.slice(0, 400),
          preview: body.slice(0, 200).replace(/\n/g, " ⏎ "),
          matchedPatterns,
        })
      }
    }

    console.log(`Checked ${checked} corpus files via the real generated wrapper.`)
    console.log(`Hits (exit 85 or ${DENIED_MARKER}): ${hits}`)

    if (hits > 0) {
      console.error("")
      console.error("FALSE POSITIVES DETECTED — blacklist would block legitimate heredocs on-device.")
      console.error("Do NOT ship 1.1.3. Report these to halt the release:")
      console.error("")
      for (const failure of failures) {
        console.error(`  file: ${failure.file}`)
        console.error(`  status: ${failure.status}`)
        console.error(`  stderr: ${failure.stderr.replace(/\n/g, " ⏎ ")}`)
        console.error(`  preview: ${failure.preview}`)
        if (failure.matchedPatterns.length > 0) {
          console.error(`  matched patterns:`)
          for (const raw of failure.matchedPatterns) console.error(`    ${raw}`)
        }
        console.error("")
      }
      process.exit(1)
    }

    console.log("")
    console.log("PASS: zero blacklist hits on real heredoc corpus.")
    console.log("These scripts are safe to ship as a permanent regression baseline.")
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

// Extract the exit-85 blacklist grep lines from the generated wrapper. A line
// qualifies when it is a `grep -Eiq` line AND its immediately-following line
// carries TERRA_EGO_NODE_CAPABILITY_DENIED. Other grep lines in the wrapper
// guard exit 81/84/etc. and must be excluded, or every fillInput/pageInfo call
// would look like a hit.
function extractBlacklistPatterns(wrapperText: string): string[] {
  const lines = wrapperText.split("\n")
  const out: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (!/\/usr\/bin\/grep -Eiq/.test(lines[i])) continue
    if (i + 1 >= lines.length || !lines[i + 1].includes(DENIED_MARKER)) continue
    out.push(lines[i].trim())
  }
  return out
}

// Extract the -Eiq argument from a wrapper grep line, mirroring POSIX
// double-quote expansion so the diagnostic pattern matches what the on-device
// wrapper sends to /usr/bin/grep. Diagnostic only — the main check runs the
// real wrapper, so a bug here only affects which pattern is named in a report.
function extractPattern(line: string): string | null {
  const marker = "-Eiq "
  const idx = line.indexOf(marker)
  if (idx === -1) return null
  const rest = line.slice(idx + marker.length)
  const quote = rest[0]
  if (quote !== '"' && quote !== "'") return null
  let out = ""
  for (let i = 1; i < rest.length; i += 1) {
    const ch = rest[i]
    if (ch === "\\" && quote === '"' && i + 1 < rest.length) {
      const next = rest[i + 1]
      if (next === '"' || next === "\\" || next === "$" || next === "`" || next === "\n") {
        out += next
        i += 1
        continue
      }
      out += ch
      continue
    }
    if (ch === quote) return out
    out += ch
  }
  return null
}

main().catch((error) => {
  console.error(error)
  process.exit(70)
})