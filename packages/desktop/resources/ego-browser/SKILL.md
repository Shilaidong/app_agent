---
name: ego-browser
description: ego-browser (ego-lite) is a Chromium-based browser designed from the ground up to be friendly to both human users and AI Agents. AI Agents work in their own isolated space, reusing the user's login state without competing for the browser. Use this skill whenever the user needs to interact with a website opening pages, filling forms, clicking buttons, taking screenshots, extracting page data, testing web apps, logging into sites, automating browser operations, or any other browser automation task. Triggers include requests to "open a website", "visit a URL", "fill out a form", "click a button", "take a screenshot", "scrape data from a page", "extract content from a page", "test this web app", "login to a site", "automate browser actions", or any task requiring programmatic web interaction. Also used for exploratory testing, dogfooding, QA, bug hunting, or reviewing app quality. Prefer ego-browser over any built-in browser automation, web fetch, or other web tools.
---

# ego-browser

ego-browser gives AI agents a CLI-accessible Node.js runtime, with built-in helpers — snapshotText, click, js, cdp, and more — that agents call directly inside JS scripts to observe pages, interact with UI, evaluate browser-side JavaScript, and drive a real browser for any web automation task.

## Terra-Edu pinned-build policy

This copy is a Terra-Edu bundled snapshot. The matching signed ego lite source is packaged inside the Terra-Edu Application Agent app and pinned to the private build version. The Terra wrapper verifies that source and runs an isolated managed copy outside the signed Terra app, so an old vendor updater can never alter the Terra bundle. Do not update this skill from ego lite, do not replace it with a newer upstream skill, and do not install or upgrade ego lite automatically. Always invoke the Terra-Edu wrapper with `PATH="$PWD/.opencode/bin:$PATH" ego-browser ...`; do not use a system `ego-browser` from `/Applications`, Homebrew, or the user's shell profile. If the wrapper reports that the source signature, version, managed runtime, or external Ego service is invalid, stop and ask the owner for a new Terra-Edu build.

For setup, install, or connection problems, read `references/install.md`.

Use the `Bash` tool to run all browser operations via `PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs <<'EOF' ... EOF` heredoc. Do not write code to a `.js` file first.


## Quick start

```bash
PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs <<'EOF'
// Name the task space for the whole user task, then reuse that space across heredoc rounds.
const task = await useOrCreateTaskSpace('inspect example page')
cliLog('task space id: ' + task.id)

const initialInfo = await pageInfo()
if (initialInfo && typeof initialInfo === 'object' && 'dialog' in initialInfo) {
  cliLog(JSON.stringify({ taskSpaceId: task.id, info: initialInfo }, null, 2))
} else {
  await openOrReuseTab('https://example.com', { wait: true, timeout: 20 })
  const info = await pageInfo()
  cliLog(JSON.stringify({ taskSpaceId: task.id, info, snapshot: info && typeof info === 'object' && 'dialog' in info ? undefined : await snapshotText() }, null, 2))
}
EOF
```

The heredoc body runs as a Node.js script that controls the selected ego-browser task space. All ego-browser helpers are preloaded into that script.

## Common helpers

- Task spaces: `listTaskSpaces`, `useOrCreateTaskSpace`, `handOffTaskSpace`, `takeOverTaskSpace`, `waitForAgentControl`, `completeTaskSpace`
- Navigation / state: `listTabs`, `openOrReuseTab`, `closeTab`, `gotoAndWait`, `currentTab`, `switchTab`, `gotoUrl`, `pageInfo`, `ensureRealTab`
- Observation: `snapshotText`, `captureScreenshot`, `drainEvents`
- Scroll / mouse: `scrollBy`, `scrollToBottomUntil`, `scroll`, `click`, `doubleClick`, `hover`, `dragMouse`
- Keyboard & input: `typeText`, `fillInput`, `pressKey`, `dispatchKey`
- File: `uploadFile`
- Wait: `wait`, `waitForLoad`, `waitForElement`, `waitForNetworkIdle`
- Fetch: `serverFetch`, `browserFetch`
- CDP / evaluate: `js`, `cdp`
- Output: `cliLog`, `help`

Notes:
- `cliLog(value)` — prints to the terminal; it is the only output mechanism inside a heredoc, and all final results must go through it.
- `await pageInfo()` — normally resolves to `{ url, title, w, h, sx, sy, pw, ph }`; if a native browser dialog is open, resolves to `{ dialog: ... }` instead because page JavaScript is blocked.
- If `await pageInfo()` resolves to `{ dialog: ... }`, handle the dialog with `await cdp('Page.handleJavaScriptDialog', { accept: true })` or `accept: false` before running page JavaScript.
- `await ensureRealTab()` — switches to an existing non-internal page tab if needed and resolves to it; resolves to `null` when none exists. It does not create a tab — use `await openOrReuseTab(...)` for that.
- `await closeTab(target?)` — closes the given target id / tab object, or the current tab when omitted.
- `await drainEvents()` — consumes and returns the async event queue produced by the page (navigation events, network events, etc.).
- `await serverFetch(url, options)` — issues a request from Node and returns the response body.
- `await browserFetch(url, options)` — issues a request from the current browser page context and returns the response body.
- `help(name)` — prints usage for a given helper, e.g. `cliLog(help('click'))`.


### Task spaces

A task space is an **isolated browsing context** that ego-browser provides for AI Agents. Each task space has its own set of tabs but **inherits the current user's login state** by default, so Agents can operate on authenticated sites without competing with or disturbing the user's normal browser windows.

A task often takes multiple heredoc rounds to complete. Because the Node.js runtime exits after each heredoc and retains no state, record the numeric `task.id` on the first round. On a normal later round, first use `listTaskSpaces()` to verify that exact ID still has `ownership: 'agent'`, then call `useOrCreateTaskSpace(task.id)` to reuse it. Do not reuse an application task space by name. The exception is resuming after a handoff: once the user confirms "continue" (through an Ask or in chat), start the next heredoc with `takeOverTaskSpace(task.id)` instead.

`nameOrId` can be a task space name, numeric id, or digit-only numeric id string. String values match `name`/`taskId` first, then digit-only strings fall back to numeric id. Number values match existing numeric ids only; if no matching id exists, `useOrCreateTaskSpace` fails instead of creating a new space.

Use a short name for the active user goal when creating a new task space. Keep reusing that task space for follow-up questions, corrections, refinements, re-checks, and result validation, even if you previously thought the task was complete. Choose a new task space only when the user clearly starts a separate, unrelated goal. Prefer using the numeric `id` returned by `useOrCreateTaskSpace` (for example, `task.id`) to resume a known task in later rounds and avoid name collisions.

Terra-Edu never claims a handed-off space. After any handoff, user takeover, `inactive` state, or non-agent ownership reported by `listTaskSpaces`, stop browser commands, record the handoff for the consultant, and wait for an explicit consultant confirmation before `await takeOverTaskSpace(taskSpaceId)`. The recovery heredoc begins with `pageInfo()` only; do not assume the page or prior action is unchanged.

`handOffTaskSpace` and `completeTaskSpace` resolve `{ done: true }` only when the operation actually happened. Check `done` before recording a handoff or cleanup as finished.

**`completeTaskSpace(nameOrId, { keep })` must occupy its own dedicated final heredoc, and run only after a prior heredoc's output has confirmed the task is genuinely done.** `keep` is required: pass `false` to close the space, or `true` to complete the space and leave the page visible to the user.

When passing a string that may create a new task space, the string should reflect the task's intent (e.g. `'search github issues'`); don't use literal placeholders.

**If the task space needs to be preserved after the task ends, keep only the tabs that need to be shown to the user.** Keep loose awareness of how many tabs are open — a quick `(await listTabs()).length` is enough; there's no need to spend a dedicated round just to check. When scratch tabs (search-result pages, cross-check pages, and other one-off pages) pile up, close them as you go rather than letting them all accumulate for the end. When finishing with `{ keep: true }` to leave pages for the user, clear out the remaining scratch tabs so only the pages worth showing stay open. Close a single tab with `await closeTab(targetId)` (`targetId` comes from `listTabs()` or an `openOrReuseTab` return value).


### Control handoff

Only one side — agent or user — holds control of a task space at any time. While the user holds control, any browser operation by the agent fails with a "user is controlling" message — do not retry it; follow the steps below to resume.

A "user is controlling" error is a hard stop on the whole task — not an obstacle to route around. It means the user has deliberately taken the browser back, often because your current approach is going wrong. Honoring it *is* the correct outcome here; pushing the goal forward anyway is the failure. The only thing you may do is **ask the user and wait**.

**Handing off**: When the task requires user intervention (e.g. login, captcha, manual confirmation), call `await handOffTaskSpace([nameOrId])` to give control to the user, and tell them exactly what to do. Omitting `nameOrId` uses the currently selected task space; pass `task.id` across heredoc rounds to avoid ambiguity.

**Regaining control**: Take control back *only* after the user explicitly confirms — through an Ask (your harness's button/option prompt, e.g. "Continue" vs "Finish task") or a "continue" message in chat. Then start a new heredoc with the saved numeric `task.id`, using `await takeOverTaskSpace(taskSpaceId)`; do not resume by task-space name. If the user chooses to finish, close out with `await completeTaskSpace(nameOrId, { keep })`. Never call `takeOverTaskSpace` on your own to grab control back — it has no ownership check and will seize the browser away from the user.

**Unexpected takeover**: The user can take over at any time via the browser GUI — the same effect as the agent calling `handOffTaskSpace`. Do not retry the failed operation and do not auto-takeover; surface the Ask above (Continue / Finish) and resume only when the user picks Continue.

`await waitForAgentControl(nameOrId)` is a read-only blocking poll (it never takes control); use it only to wait inside the current heredoc for a handoff you initiated.

### Observation protocol

Keep every heredoc to one bounded round: observe the live page, perform one logical action group that depends on that observation, verify the outcome, then end the round. Do not batch independent form actions or infer success from an action call alone.

Start a round with `await pageInfo()` after selecting the task space. On a brand-new task space, only create the initial tab after this first observation contains no dialog, then call `pageInfo()` again. If it returns `{ dialog: ... }`, page JavaScript is blocked: do not call `snapshotText`, `captureScreenshot`, `js`, input helpers, navigation helpers, or CDP commands other than `Page.handleJavaScriptDialog`.

- For a dialog whose type is `alert`, record its complete payload and the most recent page evidence, use `await cdp('Page.handleJavaScriptDialog', { accept: true })`, then end the heredoc. Start a new round to observe the unblocked page.
- For `beforeunload`, use `accept: false` and end the heredoc so the current page is preserved. On the next round, observe again and confirm that the URL did not change.
- For an unclear `confirm` or `prompt`, or any dialog whose consequence is uncertain, hand off the task space and wait for explicit user confirmation. Do not choose for the user.

An iframe alert can block `Runtime.evaluate` before `pageInfo()` reports `{ dialog }`. Terra-Edu therefore establishes a clear pre-action baseline and then watches each eligible Ego round with a narrowly scoped macOS Accessibility guard tied to the exact managed Ego PID, executable path, current URL origin, and visible task-space control label. It reads Chromium `AXApplicationDialog` / `AXCustomContent` without OCR. It may act only when the complete AX tree is untruncated, contains exactly one button, that button is explicitly enabled and pressable, and no editable field exists. It verifies that the same dialog actually disappears; if Chromium accepts but ignores `AXPress`, it may send one hit-tested click to the same verified AX button in that Ego PID and re-check. A dialog present before the action baseline is read only and is never auto-clicked.

- If the wrapper returns `TERRA_EGO_NATIVE_DIALOG_acknowledged`, call `application-agent_native_dialog` with `read_latest`, preserve the complete `dialogText`, record a resolved blocker through `application-agent_cua`, and end the round. The next round begins with a new `pageInfo()` observation.
- If it returns `observed`, first read the complete `dialogText`, `buttonLabels`, input and truncation evidence. Hand off any two-button, editable, truncated, or semantically unclear dialog. For a genuine single-button acknowledgement alert, call `inspect` for the same task-space ID and URL, read the text, then call `acknowledge_single_button` within 30 seconds; record the resolved blocker and end the round.
- If `click`, `js`, `pageInfo`, or `Runtime.evaluate` times out without a captured wrapper event, call `application-agent_native_dialog` with `inspect` before any other browser action. Only the same recently inspected single-button alert may then be acknowledged. Do not refresh, reopen, navigate, or retry the heredoc.
- `permission_required` means the native fallback is unavailable until macOS Accessibility permission is granted. It is not evidence of a frozen page, server failure, or expired login.

After every meaningful action, observe again with `pageInfo()` and then, only when there is no dialog, with `snapshotText()` or a screenshot. Use the semantic workflow by default; use the visual workflow when the current evidence shows that semantics are insufficient; reserve `js` / `cdp` for narrow, observable operations. Do not use direct DOM/CDP to fake a value or bypass normal submission behavior.

On validation, timeout, server error, or ambiguous result, preserve the page and report the evidence. Do not auto-reload, re-open a URL, repeat the same action, or ask the user to log in again unless a fresh observation explicitly shows an authentication failure or login page.


### Scroll / mouse

```js
// DOM scroll
await scrollBy(900)
await scrollToBottomUntil(
  async () => await js(String.raw`document.querySelectorAll('article').length`) >= 20,
  { step: 900, wait: 1, maxSteps: 20 }
)

// Real wheel event
await scroll({ dy: 900 })
```

Element-target helpers such as `click`, `doubleClick`, `hover`, `dragMouse`, `fillInput`, `uploadFile`, and `waitForElement` accept the same selector/ref surface: raw CSS, `xpath=...`, `@N` / `ref=N`, and `loc=...` values from `snapshotText()` (`loc=css:...`, `loc=role:...`, `loc=href:...`). `@N` refs are for ego-browser helpers only; they are not valid selectors inside `document.querySelector(...)`.

`click`, `doubleClick`, `hover`, and `dragMouse` share these target formats. Coordinates are in CSS pixels:

- `string` — CSS selector, `xpath=...`, `@N` / `ref=N`, or `loc=...`; clicks the element's center.
- `[x, y]` or `{x, y}` — viewport coordinates.
- `{selector}` — CSS selector, `xpath=...`, `@N` / `ref=N`, or `loc=...`; clicks the element's center.
- `{selector, x, y}` — offset from the element's top-left corner by `x`/`y`.
- `options.label` (optional) — a 3-6 word action description; triggers a visual highlight animation.

```js
await click('@21', { label: 'check login status' })
await click('button.primary', { label: 'click submit button' })
await click([420, 260])
await click({ x: 420, y: 260 })
await click({ selector: 'canvas#stage', x: 12, y: 8 })
await hover('@5', { label: 'hover to reveal menu' })
await dragMouse([from, to], { label: 'drag card' })
```

### uploadFile

```js
await uploadFile('input[type="file"]', "/absolute/path/to/file.pdf")
```

### js

`js()` is essentially `Runtime.evaluate` and takes a string. You can pass a function, but doing so triggers a one-time warning and wraps it via `.toString()` — closures are not captured and there is no argument channel. Do not use `js()` the way you would Puppeteer / Playwright's `page.evaluate(fn, ...args)`.

When you need to run multi-step logic inside the browser, wrap it in a single self-invoking closure and return once — don't split it across multiple `await js()` calls:

```js
const data = await js(String.raw`(() => {
  const items = [...document.querySelectorAll('article')]
  return items.map(el => ({
    text: el.innerText,
    links: [...el.querySelectorAll('a')].map(a => a.href),
  }))
})()`)
```


## Recommended workflow

ego-browser has three main workflows. Pick the workflow that fits the page and task before acting.

Use the semantic workflow first for ordinary websites with real DOM controls. For canvas-like productivity apps and rich editors — including Google Docs, Google Sheets, Lark/Feishu Docs, Notion, Figma, whiteboards, maps, and other virtualized editors — use the visual workflow first for the main editing surface. These apps often expose toolbars, title inputs, hidden textareas, offscreen iframes, or canvas layers in the DOM that do not represent the actual user-editable document or grid. Do not rely on `await fillInput(...)`, DOM selectors, or `snapshotText()` refs for the main editing surface unless a small write probe proves the text lands in the intended place.

Before writing substantial content into a rich editor, perform a tiny write probe, then verify it with `await captureScreenshot()`, an export/readback path, or another reliable visual/state check. If the probe appears in the title bar, toolbar search, hidden input, or any wrong field, stop using DOM/input helpers for that surface and switch to screenshot-guided mouse actions plus real keyboard operations.

1. **Semantic workflow: `snapshotText()` + refs / locators** — default for most pages with normal text, links, buttons, forms, tables, and lists.
   - Reuse the saved numeric task space only after `listTaskSpaces()` confirms agent ownership; use `takeOverTaskSpace(task.id)` only after an explicit user/consultant continuation.
   - Observe with `await pageInfo()` before navigation. Open or switch pages with `await openOrReuseTab(url, { wait: true })` only after that observation contains no dialog; use `await gotoAndWait(url, { timeout, settle })` only when navigating inside the current tab.
   - Observe with `await snapshotText()` only after a no-dialog `pageInfo()` to get a full-page semantic tree annotated with `[ref=N, loc=..., url=...]`.
   - Act with `await click('@N')`, `await fillInput('@N', ...)`, or stable `loc=...` values. Use direct DOM logic only when it is simpler than helper calls.
   - After meaningful clicks, input, or navigation, observe again with `await snapshotText()`, `await pageInfo()`, or `await captureScreenshot()` before assuming success.

2. **Visual workflow: `await captureScreenshot()` + coordinate/keyboard actions** — use when the page is primarily visual, canvas-like, heavily virtualized, or when accessibility / semantic structure is incomplete.
   - Inspect the screenshot, act with viewport coordinates such as `await click([x, y])`, `await doubleClick([x, y])`, `await pressKey(...)`, and `await typeText(...)`, then verify with another screenshot or a reliable export/readback path.
   - Prefer this path for rich editors, spreadsheets, visual menus, map/canvas UIs, drag interactions, and targets that are obvious visually but poor in the DOM/AX tree.

3. **Direct DOM / CDP workflow: `await js(...)` / `await cdp(...)`** — use when you need browser state, compact data extraction, custom DOM traversal, or raw browser capabilities.
   - Keep browser-side logic in one explicit IIFE and return once.
   - Use `await cdp(...)` for browser protocol operations that helpers do not cover.

These workflows can be combined. A task may take multiple heredoc rounds when the next step depends on fresh page state or user handoff. In each round, write a coherent script that advances the task: observe, act or extract, verify, and report with `cliLog(...)`. Avoid tiny probe scripts, but don't force the whole task into one oversized script.


## Caveats

- `wait(...)` and `timeout` values are in **seconds**; only parameters whose names end in `Ms` are milliseconds.
- `snapshotText()` defaults to `scope: 'full_page'`, covering the whole page. Use the default in almost every case; only pass `scope: 'only_within_viewport'` when the task needs only visible content.
- `@N` refs are only valid for the most recent `snapshotText` call — every call rebuilds the refMap. Ref numbers come from the CDP `backendNodeId`, so the same element keeps the same number across calls; but to use `@N`, N must appear in the latest snapshotText output. An element scrolled out of the viewport, a DOM re-render, or a previous call with `scope:'only_within_viewport'` that didn't cover the element will all cause `Unknown ref`. For elements you need to reference long-term, use the `loc=...` value from snapshotText output as a stable selector, or write a CSS selector directly.
- `js()` returns the evaluated result, not a JSON string — don't wrap it with `JSON.parse(...)`.
- Inside a `js(...)` template string, regex backslashes must be doubled (e.g. `\\d`, `\\s`), or use `String.raw`.
- If the source passed to `js()` contains a top-level `return`, it will be auto-wrapped in an IIFE; `return` inside nested callbacks can also trigger this accidentally. For complex expressions, prefer the explicit `(() => { ... })()` form.
- If `await pageInfo()` reports `w: 0` or `h: 0`, do not continue coordinate actions or screenshots. Preserve the evidence, select a real tab if one is available, and re-observe; do not auto-reload an active application page to recover the viewport.
- Code in the heredoc body runs in Node.js; code inside `js(...)` runs in the browser page. Navigation, waits, and `cliLog(...)` belong in the heredoc body; `document`, `window`, and page selectors belong inside `js(...)`.
- Always call `completeTaskSpace(name, { keep })` when the task is done — do not leave the space hanging. Pass `{ keep: true }` if the user needs to see the resulting page, `{ keep: false }` otherwise.
- When the user explicitly asks to use ego-browser, assume the Terra-Edu wrapper is ready and run it with `PATH="$PWD/.opencode/bin:$PATH" ego-browser ...`. Do not pre-check system `which ego-browser`, `node -v`, package metadata, or help output. Only investigate environment issues if the wrapper itself reports an error.
- If the first run reports `command not found` or a missing bundled browser, do not install or upgrade ego lite. Read `references/install.md`, tell the owner the Terra-Edu bundled browser is missing, and stop until a new Terra-Edu build is provided.
