import { existsSync, readFileSync } from "node:fs"
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { APPLICATION_AGENT_MODEL, APPLICATION_AGENT_MODEL_ID } from "./application-agent-model"
import type { ApplicationTask } from "./application-agent"

const root = dirname(fileURLToPath(import.meta.url))
const EGO_BROWSER_SKILL_PIN = "terra-pinned-2026-07-17"
const EGO_LITE_VENDOR_VERSION = "0.4.4.15"
const EGO_BROWSER_PROTOCOL = `## ego-browser 通用观察协议

- 每个 heredoc 只完成一个短回合：先观察、执行一个逻辑动作组、再验证并结束本回合。普通连续文本可作为短批次；选择、添加/删除、自动完成、上传、保存和导航必须各自单独复查，不要把它们和下一项页面动作串在同一批次。
- 首次使用 task space 时记录返回的数值 task.id，并把它作为唯一可恢复的 taskSpaceId（调用 application-agent_cua 时传该 ID 的字符串形式）。已有保存 ID 的正常连续回合先用 listTaskSpaces 确认该空间仍为 agent ownership，再以该数值 ID 调用 useOrCreateTaskSpace(taskSpaceId)；不得再按名称匹配。已经交给顾问、listTaskSpaces 显示 user/inactive、或收到“user is controlling / inactive”后，立即停止浏览器命令，并以真实 taskSpaceId、URL、标题和证据调用 handoff_to_consultant。只有顾问明确回复继续后，才可用保存的 taskSpaceId 调用 takeOverTaskSpace(taskSpaceId) 恢复，绝不自动抢回控制。
- 选定 task space 后，每个回合先调用 pageInfo()。首次新建且没有可用页面时，只有 pageInfo 已明确没有 dialog 后才可用 openOrReuseTab 建立申请页，并立刻再次 pageInfo；其他回合不得在首次 pageInfo 前导航。只有 pageInfo() 没有 dialog 时，才可调用 snapshotText、captureScreenshot、js、click、fillInput、导航或其他页面操作。普通表单优先用 snapshotText 的语义 workflow；语义信息不足时由你根据现场截图改用 visual workflow；DOM/CDP 仅用于有明确观察证据的窄范围操作，不得用它伪造填写结果或直接绕过正常提交。
- 如果 pageInfo() 返回 dialog，先记录完整 dialog 信息和最近一次页面证据；此时不得调用 snapshotText、captureScreenshot、js、点击/输入/上传/导航等任何页面操作，或任何 CDP 命令，唯一例外是 Page.handleJavaScriptDialog。type 为 alert 时使用 accept:true 关闭、调用 application-agent_cua record_blocker（blockerDisposition: resolved）后立刻结束本 heredoc；type 为 beforeunload 时一律 accept:false、记录 resolved 后结束本 heredoc，下一回合先确认 URL 未变化；无法确定影响的 confirm 或 prompt 必须 handOffTaskSpace，确认返回 done:true 后以真实 taskSpaceId、URL、标题和证据记录 blockerDisposition: handoff 并等待顾问。
- iframe 原生 alert 可能让 Ego 的 Runtime.evaluate/pageInfo 超时，但这不代表网页冻结。Terra 包装器先建立“当前没有弹窗”的只读基线，再监视本轮动作；它只绑定 Terra 管理的 Ego PID、可执行路径、URL origin 和正在控制的 task-space 标签。若本轮新出现 AXApplicationDialog，保存 AXCustomContent 全文，并只处理“AXCustomContent 存在且完整解码、总按钮数恰好为 1、唯一按钮明确可按、没有任何输入框、AX 树未截断”的 alert。点击前必须再次核对包含 PID、可执行路径、完整 URL、task-space 标签和弹窗内容的同一指纹。先尝试 AXPress；若 Ego 吞掉成功返回且同一弹窗和按钮仍在，才对同一 AX 按钮中心向该 Ego PID 发送一次点击，并再次确认弹窗消失。回合开始前已存在的弹窗只读取、绝不自动点击。
- 包装器返回 TERRA_EGO_NATIVE_DIALOG_acknowledged 时，立即调用 application-agent_native_dialog read_latest 读取全文，再调用 application-agent_cua record_blocker（blockerDisposition: resolved），结束当前回合。若返回 observed，先读完整 dialogText 与 buttonLabels；两按钮、输入框、树截断或语义不清必须 handoff。若它确实只是单按钮提示，可调用 application-agent_native_dialog inspect 重新读取同一 task space 和 URL，再在 30 秒内调用 acknowledge_single_button；已关闭后记录 resolved 并结束回合。任何情况都不得刷新、重开标签或把它误判成登录失效。
- 若 click、js、pageInfo 或 Runtime.evaluate 超时且包装器没有返回已捕获事件，下一步只能调用 application-agent_native_dialog inspect；必须先读出完整文字，只有同一任务、同一 URL、30 秒内未变化的单按钮 alert 才可调用 acknowledge_single_button。该工具不接管网页操作。permission_required 时停止浏览器重试并明确报告需一次性开启 macOS 辅助功能权限。
- 任何选择、添加/删除、自动完成、切换或导航都可能改变可见内容。动作后用新的 pageInfo 加 snapshotText 或截图复查页面差异；DOM required 扫描只是辅助证据。每次改变页面后都必须重新进行带 taskSpaceId、URL、标题和证据的动态表单验证，才能保存。
- 遇到校验、超时、服务端错误或结果不明确时，保留当前页面和观察证据，记录失败或交接；不得自动刷新、重开链接、重复同一动作或要求重新登录。只有新观察明确显示认证失败或登录页时，才可请求顾问重新登录。
- 若 Terra 包装器返回 TERRA_EGO_BROWSER_VERSION_CONFLICT、TERRA_EGO_BROWSER_EXTERNAL_SERVICE_ACTIVE、TERRA_EGO_BROWSER_SERVICE_UNAVAILABLE 或 TERRA_EGO_NATIVE_DIALOG_PERMISSION_REQUIRED，立即停止，不得重试、调用系统 ego-browser、关闭其他 Ego Lite 或猜测 task space。用 application-agent_cua record_failure 原样记录标识；浏览器服务问题按提示处理，辅助功能权限问题需先完成系统授权，之后从新回合观察恢复。
- 保存前后都必须有新观察证据。保存动作后先调用 record_observation 写入晚于动态表单复查的页面证据；只有页面明确显示已保存、已回显或状态已改变，才能调用 record_save_verified。`

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8")
}

async function writeGeneratedFile(path: string, contents: string, mode?: number) {
  await mkdir(dirname(path), { recursive: true })
  const staged = join(dirname(path), "." + basename(path) + ".staged-" + process.pid + "-" + Date.now())
  try {
    await writeFile(staged, contents, "utf8")
    if (mode) await chmod(staged, mode)
    await rename(staged, path)
  } finally {
    await rm(staged, { force: true })
  }
}

async function writeGeneratedJson(path: string, value: unknown) {
  await writeGeneratedFile(path, JSON.stringify(value, null, 2) + "\n")
}

function readBundledEgoBrowserResource(relativePath: string) {
  const candidates = [
    join(root, "../../resources/ego-browser", relativePath),
    join(process.resourcesPath ?? "", "ego-browser", relativePath),
  ]
  for (const candidate of candidates) {
    try {
      if (!candidate || !existsSync(candidate)) continue
      return readFileSync(candidate, "utf8")
    } catch {}
  }
  throw new Error("Missing bundled ego-browser resource: " + relativePath)
}

function bundledEgoLiteAppPath() {
  const candidates = [
    join(root, "../../resources/vendor/ego-lite/ego lite.app"),
    join(process.resourcesPath ?? "", "vendor/ego-lite/ego lite.app"),
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, "Contents/Info.plist"))) return candidate
  }
  return candidates[0]
}

function bundledTerraPaddleOcrPath() {
  const candidates = [
    join(root, "../../resources/vendor/terra-paddleocr/terra-paddleocr"),
    join(process.resourcesPath ?? "", "vendor/terra-paddleocr/terra-paddleocr"),
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return candidates[0]
}

function bundledTerraDialogGuardPath() {
  const candidates = [
    join(root, "../../resources/vendor/terra-dialog-guard/terra-dialog-guard"),
    join(process.resourcesPath ?? "", "vendor/terra-dialog-guard/terra-dialog-guard"),
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return candidates[0]
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export type OpenCodeResourceOverrides = {
  egoLiteAppPath?: string
  dialogGuardPath?: string
  egoRuntimeRoot?: string
}

function renderEgoBrowserWrapper(overrides?: OpenCodeResourceOverrides) {
  const appPath = overrides?.egoLiteAppPath || bundledEgoLiteAppPath()
  const dialogGuardPath = overrides?.dialogGuardPath || bundledTerraDialogGuardPath()
  const runtimeRoot = overrides?.egoRuntimeRoot ? shellQuote(overrides.egoRuntimeRoot) : '"$HOME/Library/Application Support/edu.terra.application-agent/ego-lite-runtime"'
  return `#!/bin/sh
set -eu

APP_PATH=${shellQuote(appPath)}
DIALOG_GUARD=${shellQuote(dialogGuardPath)}
EXPECTED_VERSION=${shellQuote(EGO_LITE_VENDOR_VERSION)}
EXPECTED_BUNDLE_ID='com.citrolabs.ego.lite'
EXPECTED_TEAM_ID='JGQLC6YQYJ'
INFO_PLIST="$APP_PATH/Contents/Info.plist"
RUNTIME_ROOT=${runtimeRoot}
RUNTIME_APP="$RUNTIME_ROOT/ego lite.app"
RUNTIME_INFO_PLIST="$RUNTIME_APP/Contents/Info.plist"

die() {
  printf '%s\\n' "$*" >&2
  exit 127
}

unavailable() {
  printf '%s\\n' "TERRA_EGO_BROWSER_SERVICE_UNAVAILABLE: $*" >&2
  exit 76
}

ego_identity_valid() {
  identity=$(/usr/bin/codesign -dv --verbose=4 "$1" 2>&1 || true)
  printf '%s\\n' "$identity" | /usr/bin/grep -Fxq "Identifier=$EXPECTED_BUNDLE_ID" &&
    printf '%s\\n' "$identity" | /usr/bin/grep -Fxq "TeamIdentifier=$EXPECTED_TEAM_ID" &&
    printf '%s\\n' "$identity" | /usr/bin/grep -Fq 'Authority=Developer ID Application: CITRO LABS PTE. LIMITED (JGQLC6YQYJ)'
}

enabled_updater() {
  find "$1/Contents" -type f \\( -path '*/EgoUpdater.app/*' -o -path '*/EgoSoftwareUpdate.bundle/*' -o -path '*/com.citrolabs.ego.UpdaterPrivilegedHelper' \\) -exec sh -c 'for candidate do [ ! -x "$candidate" ] || printf "%s\\n" "$candidate"; done' sh {} + 2>/dev/null | head -n 1 || true
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
WORKSPACE=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
if [ -f "$WORKSPACE/03_state/task_control.json" ] && /usr/bin/grep -Eq '"paused"[[:space:]]*:[[:space:]]*true' "$WORKSPACE/03_state/task_control.json"; then
  printf '%s\\n' 'TERRA_EGO_TASK_PAUSED' >&2
  exit 75
fi
if [ -f "$WORKSPACE/03_state/material_review.json" ] && /usr/bin/grep -Eq '"status"[[:space:]]*:[[:space:]]*"pending"' "$WORKSPACE/03_state/material_review.json"; then
  die "Terra-Edu material review is pending. Ask the advisor to confirm materials in the desktop app before starting ego-browser."
fi

[ -d "$APP_PATH" ] || die "Terra-Edu bundled ego lite is missing: $APP_PATH"
[ -f "$INFO_PLIST" ] || die "Terra-Edu bundled ego lite Info.plist is missing: $INFO_PLIST"

VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST" 2>/dev/null || true)
[ "$VERSION" = "$EXPECTED_VERSION" ] || die "Terra-Edu bundled ego lite version mismatch: expected $EXPECTED_VERSION, got \${VERSION:-unknown}"

if ! /usr/bin/codesign --verify --deep --strict "$APP_PATH" >/dev/null 2>&1 || ! ego_identity_valid "$APP_PATH"; then
  unavailable "Terra-Edu 内置 Ego Lite 母版的官方签名已失效；为保护登录态和页面，没有启动浏览器。请重新安装 Terra-Edu 后再继续。"
fi
UPDATER_EXECUTABLE=$(enabled_updater "$APP_PATH")
if [ -n "$UPDATER_EXECUTABLE" ]; then
  unavailable "内置 Ego Lite 母版包含意外启用的更新器组件；没有执行浏览器操作。"
fi

prepare_runtime() {
  if [ -f "$RUNTIME_INFO_PLIST" ]; then
    RUNTIME_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$RUNTIME_INFO_PLIST" 2>/dev/null || true)
    RUNTIME_UPDATER_EXECUTABLE=$(enabled_updater "$RUNTIME_APP")
    if [ "$RUNTIME_VERSION" = "$EXPECTED_VERSION" ] &&
      /usr/bin/codesign --verify --deep --strict "$RUNTIME_APP" >/dev/null 2>&1 &&
      ego_identity_valid "$RUNTIME_APP" &&
      [ -z "$RUNTIME_UPDATER_EXECUTABLE" ]; then
      return
    fi
  fi

  if ! /bin/mkdir -p "$RUNTIME_ROOT"; then
    unavailable "无法创建 Ego Lite 运行目录；没有执行浏览器操作。"
  fi
  STAGED_APP="$RUNTIME_ROOT/.ego-lite.staged-$$"
  /bin/rm -rf "$STAGED_APP"
  if ! /usr/bin/ditto "$APP_PATH" "$STAGED_APP"; then
    /bin/rm -rf "$STAGED_APP"
    unavailable "无法准备已验证的 Ego Lite 运行副本；没有执行浏览器操作。"
  fi
  if ! /usr/bin/codesign --verify --deep --strict "$STAGED_APP" >/dev/null 2>&1 ||
    ! ego_identity_valid "$STAGED_APP" ||
    [ -n "$(enabled_updater "$STAGED_APP")" ]; then
    /bin/rm -rf "$STAGED_APP"
    unavailable "Ego Lite 运行副本的官方签名验证失败；没有执行浏览器操作。"
  fi
  if [ -e "$RUNTIME_APP" ] && ! /bin/rm -rf "$RUNTIME_APP"; then
    /bin/rm -rf "$STAGED_APP"
    unavailable "无法刷新已由 Terra-Edu 管理的 Ego Lite 运行副本；没有执行浏览器操作。"
  fi
  if ! /bin/mv "$STAGED_APP" "$RUNTIME_APP"; then
    /bin/rm -rf "$STAGED_APP"
    unavailable "无法启用已验证的 Ego Lite 运行副本；没有执行浏览器操作。"
  fi
}

# Do not ever launch the immutable source app inside Terra. Its updater payload
# is disabled, and any legacy vendor updater can only alter the managed runtime
# copy — never the signed Terra application itself.
if ! /usr/bin/pgrep -f "$RUNTIME_APP/Contents/MacOS/" >/dev/null 2>&1; then
  USER_ID=$(/usr/bin/id -u)
  if /usr/bin/pgrep -f 'ego lite.app/Contents/' >/dev/null 2>&1 || /bin/launchctl print "gui/$USER_ID" 2>/dev/null | /usr/bin/grep -Fq 'com.citrolabs.ego.lite.ego-browser'; then
    printf '%s\\n' 'TERRA_EGO_BROWSER_EXTERNAL_SERVICE_ACTIVE: 检测到另一 Ego Lite 浏览器服务正在运行。为保护其登录态和页面，Terra-Edu 未使用、关闭或启动竞争浏览器；请关闭另一 Ego Lite 后点击“继续任务”。' >&2
    exit 76
  fi
  prepare_runtime
  open -n -gj "$RUNTIME_APP" --args --no-default-browser-check --no-first-run >/dev/null 2>&1 || true
  attempt=1
  started=0
  while [ "$attempt" -le 15 ]; do
    if /usr/bin/pgrep -f "$RUNTIME_APP/Contents/MacOS/" >/dev/null 2>&1; then
      started=1
      break
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  if [ "$started" -ne 1 ]; then
    printf '%s\\n' 'TERRA_EGO_BROWSER_SERVICE_UNAVAILABLE: 随包 Ego Lite 未在 15 秒内启动；没有执行浏览器操作。请由顾问确认后再继续。' >&2
    exit 76
  fi
fi
RUNTIME_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$RUNTIME_INFO_PLIST" 2>/dev/null || true)
if [ "$RUNTIME_VERSION" != "$EXPECTED_VERSION" ] ||
  ! /usr/bin/codesign --verify --deep --strict "$RUNTIME_APP" >/dev/null 2>&1 ||
  ! ego_identity_valid "$RUNTIME_APP" ||
  [ -n "$(enabled_updater "$RUNTIME_APP")" ]; then
  printf '%s\\n' 'TERRA_EGO_BROWSER_VERSION_CONFLICT: Terra-Edu 管理的 Ego Lite 运行副本已在当前浏览器会话中改变。为保护登录态和页面，没有调用它；请关闭该 Ego Lite 后点击“继续任务”。' >&2
  exit 76
fi
HELPER="$RUNTIME_APP/Contents/Frameworks/ego Framework.framework/Versions/$EXPECTED_VERSION/Helpers/ego-browser"
[ -x "$HELPER" ] || unavailable "已验证的 Ego Lite 运行副本缺少匹配版本的 ego-browser helper；没有执行浏览器操作。"

export TERRA_EGO_LITE_APP="$RUNTIME_APP"
export TERRA_EGO_BROWSER_HELPER="$HELPER"
# Wait only for our pinned helper to answer a read-only task-space query; never
# fall back to a system helper.
attempt=1
ready=0
while [ "$attempt" -le 15 ]; do
  set +e
  "$HELPER" taskspace list >/dev/null 2>&1
  readiness_status=$?
  set -e
  if [ "$readiness_status" -eq 0 ]; then
    ready=1
    break
  fi
  if [ "$readiness_status" -eq 255 ]; then
    printf '%s\\n' 'TERRA_EGO_BROWSER_VERSION_CONFLICT: 检测到另一版本 Ego Lite 浏览器服务正在运行。为保护其登录态和页面，Terra-Edu 未使用或关闭它；请关闭另一版本 Ego Lite 后点击“继续任务”。' >&2
    exit 76
  fi
  if [ "$readiness_status" -ne 252 ]; then
    printf '%s\\n' "TERRA_EGO_BROWSER_SERVICE_UNAVAILABLE: 随包 Ego Lite 服务启动失败（taskspace list 退出码 $readiness_status）；没有执行浏览器操作。请由顾问确认后再继续。" >&2
    exit 76
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  printf '%s\\n' 'TERRA_EGO_BROWSER_SERVICE_UNAVAILABLE: 随包 Ego Lite 未在 15 秒内就绪；没有执行浏览器操作。请由顾问确认后再继续。' >&2
  exit 76
fi

DIALOG_WATCH_PID=""
DIALOG_EVENT_FILE=""
DIALOG_PERMISSION_FILE=""
DIALOG_READY_FILE=""
DIALOG_WATCH_STATUS=""
DIALOG_WATCH_NATURAL_EXIT=0

stop_dialog_watch() {
  terminated_by_wrapper=0
  if [ -n "$DIALOG_WATCH_PID" ] && /bin/kill -0 "$DIALOG_WATCH_PID" >/dev/null 2>&1; then
    if /bin/kill -TERM "$DIALOG_WATCH_PID" >/dev/null 2>&1; then
      terminated_by_wrapper=1
    fi
  fi
  if [ -n "$DIALOG_WATCH_PID" ]; then
    set +e
    wait "$DIALOG_WATCH_PID" >/dev/null 2>&1
    dialog_wait_status=$?
    set -e
    if [ "$terminated_by_wrapper" -eq 0 ]; then
      DIALOG_WATCH_STATUS="$dialog_wait_status"
      DIALOG_WATCH_NATURAL_EXIT=1
    fi
  fi
  DIALOG_WATCH_PID=""
  if [ -n "$DIALOG_READY_FILE" ]; then
    /bin/rm -f "$DIALOG_READY_FILE"
  fi
  DIALOG_READY_FILE=""
}

persist_dialog_event() {
  source_file="$1"
  [ -s "$source_file" ] || return 0
  events_dir="$WORKSPACE/03_state/native_dialog_events"
  /bin/mkdir -p "$events_dir"
  event_id=$(/usr/bin/uuidgen | /usr/bin/tr '[:upper:]' '[:lower:]')
  recorded_at=$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')
  enriched_file="$events_dir/.native-dialog-event-$$.json"
  /bin/cp "$source_file" "$enriched_file"
  /usr/bin/plutil -insert schemaVersion -integer 1 "$enriched_file" >/dev/null 2>&1 || /usr/bin/plutil -replace schemaVersion -integer 1 "$enriched_file"
  /usr/bin/plutil -insert eventId -string "$event_id" "$enriched_file" >/dev/null 2>&1 || /usr/bin/plutil -replace eventId -string "$event_id" "$enriched_file"
  /usr/bin/plutil -insert source -string wrapper "$enriched_file" >/dev/null 2>&1 || /usr/bin/plutil -replace source -string wrapper "$enriched_file"
  /usr/bin/plutil -insert taskSpaceId -string "$TASK_SPACE_ID" "$enriched_file" >/dev/null 2>&1 || /usr/bin/plutil -replace taskSpaceId -string "$TASK_SPACE_ID" "$enriched_file"
  /usr/bin/plutil -insert taskSpaceName -string "$EXPECTED_WINDOW" "$enriched_file" >/dev/null 2>&1 || /usr/bin/plutil -replace taskSpaceName -string "$EXPECTED_WINDOW" "$enriched_file"
  /usr/bin/plutil -insert currentUrl -string "$EXPECTED_URL" "$enriched_file" >/dev/null 2>&1 || /usr/bin/plutil -replace currentUrl -string "$EXPECTED_URL" "$enriched_file"
  /usr/bin/plutil -insert recordedAt -string "$recorded_at" "$enriched_file" >/dev/null 2>&1 || /usr/bin/plutil -replace recordedAt -string "$recorded_at" "$enriched_file"
  /bin/cp "$enriched_file" "$events_dir/$event_id.json"
  /bin/cp "$enriched_file" "$WORKSPACE/03_state/.native_dialog_last.json.$$"
  /bin/mv "$WORKSPACE/03_state/.native_dialog_last.json.$$" "$WORKSPACE/03_state/native_dialog_last.json"
  /bin/rm -f "$enriched_file"
}

dialog_status() {
  /usr/bin/plutil -extract status raw "$1" 2>/dev/null || true
}

settle_dialog_watch() {
  [ -n "$DIALOG_WATCH_PID" ] || return 0
  attempt=1
  while [ "$attempt" -le 3 ] && /bin/kill -0 "$DIALOG_WATCH_PID" >/dev/null 2>&1 && { [ -z "$DIALOG_EVENT_FILE" ] || [ ! -s "$DIALOG_EVENT_FILE" ]; }; do
    sleep 0.1
    attempt=$((attempt + 1))
  done
  if [ -n "$DIALOG_EVENT_FILE" ] && [ -s "$DIALOG_EVENT_FILE" ]; then
    attempt=1
    while [ "$attempt" -le 60 ] && /bin/kill -0 "$DIALOG_WATCH_PID" >/dev/null 2>&1; do
      sleep 0.1
      attempt=$((attempt + 1))
    done
  fi
}

trap 'stop_dialog_watch' EXIT
trap 'stop_dialog_watch; exit 129' HUP
trap 'stop_dialog_watch; exit 130' INT
trap 'stop_dialog_watch; exit 143' TERM

if [ "$#" -gt 0 ] && [ "$1" = "nodejs" ] && [ -x "$DIALOG_GUARD" ]; then
  EGO_PID_LIST=$(/usr/bin/pgrep -f "$RUNTIME_APP/Contents/MacOS/ego lite" 2>/dev/null || true)
  EGO_PID_COUNT=$(printf '%s\n' "$EGO_PID_LIST" | /usr/bin/awk 'NF { count++ } END { print count + 0 }')
  if [ "$EGO_PID_COUNT" -gt 1 ]; then
    printf '%s\n' 'TERRA_EGO_NATIVE_DIALOG_TARGET_AMBIGUOUS: 检测到多个 Terra 管理的 Ego Lite 主进程。为避免读取或点击错误窗口，本回合未执行。请关闭多余进程后再继续。' >&2
    exit 76
  fi
  EGO_PID=$(printf '%s\n' "$EGO_PID_LIST" | /usr/bin/head -n 1)
  PROGRESS_FILE="$WORKSPACE/03_state/application_progress.json"
  EXPECTED_URL=""
  EXPECTED_WINDOW=""
  TASK_SPACE_ID=""
  if [ -f "$PROGRESS_FILE" ]; then
    EXPECTED_URL=$(/usr/bin/plutil -extract currentUrl raw "$PROGRESS_FILE" 2>/dev/null || true)
    EXPECTED_WINDOW=$(/usr/bin/plutil -extract egoBrowser.taskSpaceName raw "$PROGRESS_FILE" 2>/dev/null || true)
    TASK_SPACE_ID=$(/usr/bin/plutil -extract egoBrowser.taskSpaceId raw "$PROGRESS_FILE" 2>/dev/null || true)
  fi
  case "$TASK_SPACE_ID" in
    ''|*[!0-9]*) TASK_SPACE_ID="" ;;
  esac
  if [ -n "$EGO_PID" ] && [ -n "$TASK_SPACE_ID" ] && [ -n "$EXPECTED_URL" ] && [ -n "$EXPECTED_WINDOW" ]; then
    PREFLIGHT_FILE=$(/usr/bin/mktemp "$WORKSPACE/03_state/.native-dialog-preflight.XXXXXX")
    set +e
    "$DIALOG_GUARD" inspect \
      --bundle-id com.citrolabs.ego.lite \
      --pid "$EGO_PID" \
      --executable-path-prefix "$RUNTIME_APP" \
      --window-title "$EXPECTED_WINDOW" \
      --expected-url "$EXPECTED_URL" \
      --prompt-accessibility \
      --output "$PREFLIGHT_FILE" >/dev/null 2>&1
    preflight_status=$?
    set -e
    preflight_dialog_status=$(dialog_status "$PREFLIGHT_FILE")
    if [ "$preflight_dialog_status" = "acknowledged" ] || [ "$preflight_dialog_status" = "ambiguous" ] || [ "$preflight_dialog_status" = "observed" ]; then
      persist_dialog_event "$PREFLIGHT_FILE"
      printf '%s\\n' "TERRA_EGO_NATIVE_DIALOG_$preflight_dialog_status: 浏览器回合开始前已存在原生弹窗；为避免处理其他 task space，本次预检只读取、没有点击。已保留完整 AX 文本，不得刷新或继续本回合。" >&2
      /bin/cat "$PREFLIGHT_FILE" >&2
      /bin/rm -f "$PREFLIGHT_FILE"
      exit 74
    fi
    if [ "$preflight_dialog_status" = "permission_required" ]; then
      persist_dialog_event "$PREFLIGHT_FILE"
      printf '%s\\n' 'TERRA_EGO_NATIVE_DIALOG_PERMISSION_REQUIRED: macOS 尚未允许 Terra-Edu 读取和关闭原生弹窗；本轮 Ego 动作没有执行。请完成一次性辅助功能授权后再继续。' >&2
      /bin/cat "$PREFLIGHT_FILE" >&2
      /bin/rm -f "$PREFLIGHT_FILE"
      exit 77
    fi
    if [ "$preflight_dialog_status" != "none" ]; then
      if [ -s "$PREFLIGHT_FILE" ]; then
        persist_dialog_event "$PREFLIGHT_FILE"
      fi
      printf '%s\\n' "TERRA_EGO_NATIVE_DIALOG_GUARD_UNAVAILABLE: 原生弹窗预检未得到完整的无弹窗结果（status=\${preflight_dialog_status:-missing}）；本轮 Ego 动作没有执行。" >&2
      /bin/cat "$PREFLIGHT_FILE" >&2 || true
      /bin/rm -f "$PREFLIGHT_FILE"
      exit 78
    fi
    /bin/rm -f "$PREFLIGHT_FILE"

    DIALOG_EVENT_FILE=$(/usr/bin/mktemp "$WORKSPACE/03_state/.native-dialog-watch.XXXXXX")
    DIALOG_READY_FILE=$(/usr/bin/mktemp "$WORKSPACE/03_state/.native-dialog-ready.XXXXXX")
    /bin/rm -f "$DIALOG_READY_FILE"
    "$DIALOG_GUARD" watch-and-acknowledge \
      --bundle-id com.citrolabs.ego.lite \
      --pid "$EGO_PID" \
      --executable-path-prefix "$RUNTIME_APP" \
      --window-title "$EXPECTED_WINDOW" \
      --expected-url "$EXPECTED_URL" \
      --require-task-space-context \
      --ready-output "$DIALOG_READY_FILE" \
      --timeout-ms 120000 \
      --output "$DIALOG_EVENT_FILE" >/dev/null 2>&1 &
    DIALOG_WATCH_PID=$!
    attempt=1
    while [ "$attempt" -le 30 ] && /bin/kill -0 "$DIALOG_WATCH_PID" >/dev/null 2>&1 && [ ! -s "$DIALOG_READY_FILE" ]; do
      sleep 0.1
      attempt=$((attempt + 1))
    done
    if [ ! -s "$DIALOG_READY_FILE" ]; then
      baseline_dialog_status=$(dialog_status "$DIALOG_EVENT_FILE")
      if [ "$baseline_dialog_status" = "acknowledged" ] || [ "$baseline_dialog_status" = "ambiguous" ] || [ "$baseline_dialog_status" = "observed" ]; then
        persist_dialog_event "$DIALOG_EVENT_FILE"
        printf '%s\n' "TERRA_EGO_NATIVE_DIALOG_$baseline_dialog_status: 浏览器动作监视器启动时已经存在原生弹窗；没有点击，也没有执行本轮 Ego 动作。已保留完整 AX 文本。" >&2
        /bin/cat "$DIALOG_EVENT_FILE" >&2
        stop_dialog_watch
        /bin/rm -f "$DIALOG_EVENT_FILE"
        exit 74
      fi
      if [ "$baseline_dialog_status" = "permission_required" ]; then
        persist_dialog_event "$DIALOG_EVENT_FILE"
        printf '%s\\n' 'TERRA_EGO_NATIVE_DIALOG_PERMISSION_REQUIRED: 原生弹窗动作监视器没有辅助功能权限；本轮 Ego 动作没有执行。' >&2
        /bin/cat "$DIALOG_EVENT_FILE" >&2
        stop_dialog_watch
        /bin/rm -f "$DIALOG_EVENT_FILE"
        exit 77
      fi
      if [ -s "$DIALOG_EVENT_FILE" ]; then
        persist_dialog_event "$DIALOG_EVENT_FILE"
      fi
      printf '%s\\n' "TERRA_EGO_NATIVE_DIALOG_GUARD_UNAVAILABLE: 原生弹窗动作监视器未能建立完整基线（status=\${baseline_dialog_status:-missing}）；本轮 Ego 动作没有执行。" >&2
      /bin/cat "$DIALOG_EVENT_FILE" >&2 || true
      stop_dialog_watch
      /bin/rm -f "$DIALOG_EVENT_FILE"
      exit 78
    else
      /bin/rm -f "$DIALOG_READY_FILE"
      DIALOG_READY_FILE=""
    fi
  fi
fi

set +e
"$HELPER" "$@"
helper_status=$?
set -e
settle_dialog_watch
stop_dialog_watch

if [ "$DIALOG_WATCH_NATURAL_EXIT" -eq 1 ]; then
  natural_dialog_status=$(dialog_status "$DIALOG_EVENT_FILE")
  if [ -z "$natural_dialog_status" ] || [ "$natural_dialog_status" = "none" ]; then
    printf '%s\\n' "TERRA_EGO_NATIVE_DIALOG_GUARD_UNAVAILABLE: 原生弹窗监视器在浏览器回合结束前退出（exit=\${DIALOG_WATCH_STATUS:-unknown}），且没有留下有效事件；页面动作结果不确定，不得继续或重试。" >&2
    /bin/rm -f "$DIALOG_EVENT_FILE" "$DIALOG_PERMISSION_FILE"
    exit 78
  fi
fi

if [ "$helper_status" -eq 255 ]; then
  printf '%s\\n' 'TERRA_EGO_BROWSER_VERSION_CONFLICT: Ego Lite 服务在浏览器回合期间发生协议冲突，页面动作是否已经执行无法确认。Terra-Edu 未使用或关闭其他浏览器；不得重试或刷新，请顾问检查当前页面并关闭另一版本 Ego Lite 后点击“继续任务”。' >&2
  exit 76
fi
if [ "$helper_status" -eq 252 ]; then
  printf '%s\\n' 'TERRA_EGO_BROWSER_SERVICE_UNAVAILABLE: 随包 Ego Lite 服务在浏览器回合期间不可用，页面动作是否已经执行无法确认。不得重试或刷新，请由顾问检查当前页面后再继续。' >&2
  exit 76
fi

if [ -n "$DIALOG_EVENT_FILE" ] && [ -s "$DIALOG_EVENT_FILE" ]; then
  watched_dialog_status=$(dialog_status "$DIALOG_EVENT_FILE")
  if [ "$watched_dialog_status" != "none" ]; then
    persist_dialog_event "$DIALOG_EVENT_FILE"
    if [ "$watched_dialog_status" = "permission_required" ]; then
      printf '%s\\n' 'TERRA_EGO_NATIVE_DIALOG_PERMISSION_REQUIRED: 浏览器回合中辅助功能权限失效；已保留证据，不得继续或重试。' >&2
      /bin/cat "$DIALOG_EVENT_FILE" >&2
      /bin/rm -f "$DIALOG_EVENT_FILE" "$DIALOG_PERMISSION_FILE"
      exit 77
    fi
    printf '%s\\n' "TERRA_EGO_NATIVE_DIALOG_$watched_dialog_status: Ego 回合中检测到原生弹窗；已保留完整 AX 文本。不得刷新、重试或继续本回合，下一回合必须先重新观察。" >&2
    /bin/cat "$DIALOG_EVENT_FILE" >&2
    /bin/rm -f "$DIALOG_EVENT_FILE" "$DIALOG_PERMISSION_FILE"
    exit 74
  fi
fi

if [ "$helper_status" -ne 0 ] && [ -n "$DIALOG_PERMISSION_FILE" ] && [ -s "$DIALOG_PERMISSION_FILE" ]; then
  persist_dialog_event "$DIALOG_PERMISSION_FILE"
  printf '%s\\n' 'TERRA_EGO_NATIVE_DIALOG_PERMISSION_REQUIRED: Ego 回合失败且 macOS 尚未允许 Terra-Edu 读取和关闭原生弹窗。不得刷新或重试；请先在系统设置中授予辅助功能权限。' >&2
  /bin/cat "$DIALOG_PERMISSION_FILE" >&2
  /bin/rm -f "$DIALOG_EVENT_FILE" "$DIALOG_PERMISSION_FILE"
  exit 77
fi
/bin/rm -f "$DIALOG_EVENT_FILE" "$DIALOG_PERMISSION_FILE"
exit "$helper_status"
`
}

async function writeEgoBrowserSkill(base: string) {
  const skillBase = join(base, "skills", "ego-browser")
  await mkdir(join(skillBase, "references"), { recursive: true })
  await mkdir(join(skillBase, "scripts"), { recursive: true })
  await writeGeneratedFile(join(skillBase, "SKILL.md"), readBundledEgoBrowserResource("SKILL.md"))
  await writeGeneratedFile(join(skillBase, "references/install.md"), readBundledEgoBrowserResource("references/install.md"))
  await writeGeneratedFile(join(skillBase, "scripts/install.sh"), readBundledEgoBrowserResource("scripts/install.sh"))
  await writeGeneratedFile(
    join(skillBase, "TERRA_PINNED.md"),
    [
      "# Terra-Edu Pinned ego-browser Skill",
      "",
      `Pin: ${EGO_BROWSER_SKILL_PIN}`,
      "",
      "This workspace uses the Terra-Edu bundled ego-browser skill snapshot.",
      "Do not replace it with a newer ego lite skill unless Terra-Edu explicitly updates this application build.",
      "The install script is locked by default and must not download or replace ego lite unless TERRA_EGO_BROWSER_ALLOW_INSTALL=1 is set by the owner.",
      "",
    ].join("\n"),
  )
}

async function writeEgoBrowserWrapper(base: string, overrides?: OpenCodeResourceOverrides) {
  const binBase = join(base, "bin")
  const wrapper = join(binBase, "ego-browser")
  await mkdir(binBase, { recursive: true })
  await writeGeneratedFile(wrapper, renderEgoBrowserWrapper(overrides), 0o755)
}

async function writeTerraPaddleOcrWrapper(base: string) {
  const wrapper = join(base, "bin", "terra-ocr")
  await writeGeneratedFile(
    wrapper,
    `#!/bin/sh
set -eu

OCR=${shellQuote(bundledTerraPaddleOcrPath())}
[ -x "$OCR" ] || { printf '%s\\n' "Terra-Edu bundled OCR is missing: $OCR" >&2; exit 127; }
exec "$OCR" "$@"
`,
    0o755,
  )
}

async function writeTerraDialogGuardWrapper(base: string, overrides?: OpenCodeResourceOverrides) {
  const wrapper = join(base, "bin", "terra-dialog-guard")
  await writeGeneratedFile(
    wrapper,
    `#!/bin/sh
set -eu

GUARD=${shellQuote(overrides?.dialogGuardPath || bundledTerraDialogGuardPath())}
[ -x "$GUARD" ] || { printf '%s\\n' "Terra-Edu native dialog guard is missing: $GUARD" >&2; exit 127; }
exec "$GUARD" "$@"
`,
    0o755,
  )
}

export function buildApplicationAgentStartPrompt(task: ApplicationTask) {
  const inputJson = JSON.stringify(task.input, null, 2)
  return `你现在是 Terra-Edu 申请 Agent，请立刻接管这个申请任务。不要等待顾问再输入第一条指令。

这条消息就是启动信号。请先执行稳定启动阶段：建立 todowrite、初始化工作区、同步状态并汇报结果；完成后再逐步进入材料读取、分类、申请要求抓取和填表。

重要交互规则：遇到不确定信息、材料用途、学校要求解释或申请平台字段选择时，优先调用 OpenCode 内置 question 工具向顾问提出清晰选项；顾问回复后，把确认结果写入 task_state.json、missing_items.json 或 application_progress.json，再继续执行。

长流程规则：这是一个从 0 到 1 的连续申请任务。上下文接近上限时允许 OpenCode 自动 compaction，但 compaction 完成后必须继续执行当前未完成步骤；不要因为上下文压缩、工具输出被截断、某一步耗时较长、ego-browser 交接给顾问或浏览器自动化临时暂停就直接结束任务。每次继续前先读取 todowrite、03_state/application_progress.json、03_state/task_state.json 和 03_state/agent_execution_audit.json 恢复现场。

## 任务创建页信息

\`\`\`json
${inputJson}
\`\`\`

## 固定路径

- OpenCode 当前会话目录：${task.sessionDirectory}
- 目标申请工作区：${task.workspacePath}
- 原始学生资料文件夹（只读来源）：${task.input.sourceFolder}
- 申请平台链接：${task.input.applicationUrl || "待官方核验"}
${task.input.batchWorkspacePath ? `- 选校批次工作区：${task.input.batchWorkspacePath}
- 当前批次顺序：第 ${task.input.batchOrder || "?"} 所；原始材料已统一暂存。OCR 时会自动复用批次共享结果，后续学校请按顺序处理，不要重复扫描同一份材料。` : ""}

## 申请专用 Custom Tools

你必须优先使用这些 OpenCode Custom Tools 完成可工具化步骤，不要只靠普通 shell 临时拼流程：

- application-agent_workspace：创建目录、复制原始材料到 00_original_backup、刷新文件计数。
- application-agent_materials：调用随包 PaddleOCR 提取扫描 PDF/图片文字，再分类 00_original_backup 中的材料，写入 materials_index；选校批次会复用已完成的共享 OCR 结果。
- application-agent_documents：从 missing_items.json 生成信息表、材料表、Word 清单和任务总结。
- application-agent_state：按统一 task_state.json schema 更新状态、统计和进度。
- ego-browser skill：macOS 申请平台填表的唯一浏览器自动化后端。通过 ego lite 的独立 task space 打开/复用申请平台，使用 snapshotText、fillInput、click、js、cdp、captureScreenshot、handOffTaskSpace、takeOverTaskSpace 完成真人式观察、填写、复查和保存。
- application-agent_cua：不再直接控制 Chrome，也不再调用 cua-driver；它只记录 ego-browser 填表阶段的 task space、观察结果、已验证字段、保存页面、上传材料、阻塞弹窗、失败原因和审计链。
- application-agent_native_dialog：只在 Ego 原生 AXApplicationDialog 阻塞 CDP 时，读取完整 AXCustomContent、检查按钮并关闭单按钮 alert；其他网页操作仍全部交给 ego-browser。
- application-agent_risk：识别并阻断最终提交、付款、不可逆推荐信邀请、保存账号密码等高风险动作。
- application-agent_requirements：保存 webfetch/websearch 得到的学校、项目、平台要求，生成 application_requirements.json/md，并把确定缺失项同步到 missing_items.json。

## 工具调用硬性约束

- 启动阶段只做三件事：输出简短进度、优先调用 OpenCode 内置 todowrite 建立默认计划、调用 application-agent_workspace 初始化工作区并复制材料副本。todowrite 如果失败一次，不要重试、不要调用 runtime、不要阻塞启动；改用文字列出计划并继续 workspace 初始化。
- 启动阶段不要调用 webfetch、websearch、application-agent_requirements、ego-browser 或填表相关工具；这些放到工作区初始化成功后的后续阶段逐步执行。
- 默认流程中的工作区创建、材料分类、状态更新、文档生成、ego-browser 填表状态记录和高风险识别，必须调用对应的 application-agent_* Custom Tool。
- 后续阶段中，学校、项目、专业、申请平台要求必须优先用 webfetch 读取已知链接；链接信息不足时用 websearch 查找官方学校/项目/申请要求页面。抓取结果必须调用 application-agent_requirements 落盘。
- 客户端已随包提供 ripgrep 和 OCR，不要下载工具、不要使用 application-agent_runtime、不要用 Python，也不要用 bash 读写状态 JSON。文件读取使用 OpenCode 内置 read/glob/grep；扫描材料调用 application-agent_materials 的 extract_text；状态更新只调用 application-agent_state 和其他申请专用工具。
- bash 只允许用于官方 ego-browser skill 指定的 ego-browser nodejs heredoc 浏览器操作，以及有限诊断；不得用普通 bash 临时脚本替代申请专用工具链。
- 每次调用申请专用 Custom Tool 后，工具会写入 03_state/agent_execution_audit.json。任务总结前必须检查该审计文件，确认关键工具链已经执行。
- 如果某个 Custom Tool 调用失败，先记录失败原因并告知顾问，再决定是否用普通命令做有限兜底；不能无声绕过工具链。
- 如果看到 OpenCode compaction/summary/上下文压缩相关消息，必须把它当作正常维护动作：先读取最新状态文件恢复任务现场，然后继续执行 todowrite 中未完成的下一步。
- ego-browser skill 和 ego lite 浏览器都是 Terra-Edu 随软件打包的固定快照。每次运行 ego-browser heredoc 必须使用 \`PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs <<'EOF'\`，命中 .opencode/bin/ego-browser wrapper；不能调用系统 PATH 中的 ego-browser，不能自动更新、替换、下载或从 ego lite 应用中重新复制。
${EGO_BROWSER_PROTOCOL}

- 上传文件只能调用 ego-browser 的 uploadFile(selector, absolutePath)，不得用 CDP 直接设置文件、不得改成原生文件选择器操作；上传后必须在新的无 dialog 观察中确认文件名或状态，再调用 application-agent_cua record_upload。
- 任何可能改变页面结构或可见内容的动作都会使旧复查失效。用最新观察理解新增内容，再以 remainingRequiredFields:[] 调用 application-agent_cua record_dynamic_form_verified；没有这条验证不得 SAVE。
- 点击 SAVE 前后都必须遵循通用观察协议，并以 taskSpaceId、当前 URL、页面标题和观察证据调用 record_save_verified。

## 启动阶段（第一轮只做这些）

1. 先用 1-2 句话告诉顾问：申请任务已接管，正在创建隔离工作区。
2. 优先调用 OpenCode 内置 todowrite 创建默认 10 步计划；如果 todowrite 调用失败一次，直接用文字列出默认计划并继续下一步。
3. 调用 application-agent_workspace，action 使用 initialize，初始化目标申请工作区并复制原始材料副本。
4. 调用 application-agent_state，把状态更新为“正在读取文件”或写入 workspace 初始化结果。
5. 输出工作区路径、材料副本位置和下一步计划。

启动阶段不要读取材料正文、不要抓取学校网页、不要打开申请平台、不要调用 runtime 兜底。完成上述步骤后，再按下面的后续阶段逐步推进。

## 后续阶段执行顺序

在执行过程中，你必须像真正的申请 Agent 聊天助手一样持续输出可读进度。每开始一个大步骤前先用 1-3 句话告诉顾问“正在做什么、为什么做、预计产出什么”；每完成一个大步骤后说明“已完成什么、文件保存在哪里、下一步是什么”。不要长时间只调用工具而不输出任何对顾问可见的文字。

后续阶段按 agent prompt 和 skills 中的 SOP 逐步执行：读取材料副本、分类材料、生成学生档案、抓取官方申请要求、记录缺失项、生成清单、再进入 ego-browser 填表。不要把这些后续工作塞进启动阶段一次性并行执行。

## 安全边界

- 严禁自动最终提交申请。
- 严禁自动付款。
- 严禁发送不可逆推荐信邀请。
- 严禁收集、保存或读取申请平台密码。页面需要登录、验证码或 MFA 时，必须交由顾问在浏览器中手动完成，再等待顾问明确回复继续。
- 严禁瞎填、猜填不确定字段。
- 遇到最终提交、付款、不可逆确认、推荐信邀请时，必须停止并写入 task_summary.md 的人工处理事项。

请现在只执行“启动阶段”：优先创建 todowrite 计划；如果 todowrite 不可用就用文字计划继续；初始化目标申请工作区、同步状态并汇报结果。`
}


const DEFAULT_APPLICATION_PROMPT = `你是 Terra-Edu 申请 Agent，服务对象是留学顾问。

你的目标是帮助顾问自动完成学生资料整理、申请信息生成、申请平台填写、缺失材料识别和补充材料清单输出。

顾问已经在任务创建页填写基础信息，包括学生姓名、学生资料文件夹、申请学校、申请项目、申请类型、申请平台或申请链接。任务开始后，你先完成稳定启动阶段，再按默认流程逐步执行，不要等待顾问一步一步指挥。

默认流程：
1. 优先调用 OpenCode 内置 todowrite 创建 10 步计划，并在每个阶段更新进度；如果 todowrite 调用失败一次，用文字计划继续，不要阻塞工作区初始化。
2. 调用 application-agent_workspace 创建/刷新专属申请工作区，并把原始资料复制到 00_original_backup。
3. 调用 application-agent_materials，action 使用 extract_text，对扫描 PDF/图片运行随包 PaddleOCR，并读取生成的文字索引。
4. 调用 application-agent_materials，action 使用 classify 整理材料，无法判断的文件放入 needs_review。
5. 使用 webfetch 读取申请链接；信息不足时用 websearch 查找官方学校/项目要求，并调用 application-agent_requirements 落盘。
6. 生成结构化 student_profile.md。
7. 检查缺失信息和缺失材料，已有信息不要重复要求，并写入 03_state/missing_items.json。
8. 调用 application-agent_documents，根据 missing_items.json 生成信息表、材料表、Word 清单和总结。
9. 材料、缺失项和顾问文档生成后，必须先汇报材料总结并停止。此时桌面应用会显示“材料确认”面板；在 03_state/material_review.json 的 status 变为 approved 且收到顾问后续指令前，严禁调用 application-agent_cua 的 prepare_ego_task、严禁启动 ego-browser 或打开申请平台。
10. 收到材料确认后的后续指令时，先读取 material_review.json 和 06_new_materials。若有补充文件，先提取文字、分类、更新 student_profile.md、missing_items.json 和顾问文档；若有文字补充，先同步到申请档案和缺失项。然后才可调用 application-agent_cua 的 prepare_ego_task，并按官方 ego-browser skill 使用 \`PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs\` heredoc 打开申请平台、读取 snapshot、填写字段和保存页面。需要 MFA/验证码时用 handOffTaskSpace 交给顾问，顾问回复继续后 takeOverTaskSpace 恢复。

可用 Custom Tools：
- application-agent_workspace：工作区初始化、复制原始材料、刷新材料计数。
- application-agent_materials：材料分类、materials_index 生成。
- application-agent_documents：从 missing_items.json 生成 Word 清单、表单和总结。
- application-agent_state：更新 task_state.json。
- ego-browser skill：macOS 申请平台填表后端。必须使用官方 helper：useOrCreateTaskSpace、openOrReuseTab、snapshotText、fillInput、click、js、cdp、captureScreenshot、handOffTaskSpace、takeOverTaskSpace。
- application-agent_cua：记录 ego-browser 填表状态、task space、观察结果、已验证字段、已保存页面、上传材料、阻塞弹窗和失败原因；不直接控制浏览器。
- application-agent_native_dialog：读取 Terra 管理的 Ego 原生弹窗全文，并仅关闭没有输入框的单按钮 alert；iframe 弹窗导致 Runtime.evaluate 超时时先用它，禁止刷新页面兜底。
- application-agent_risk：高风险动作识别和硬拦截。
- application-agent_requirements：保存学校、项目、平台要求，生成 application_requirements.json/md，并把确定缺失项同步到 missing_items.json。

工具调用硬性约束：
- 启动阶段只做 todowrite、application-agent_workspace initialize 和 application-agent_state 状态同步；todowrite 如果失败一次，用文字计划继续，不要阻塞工作区初始化；不要在启动阶段调用 webfetch、websearch、application-agent_requirements 或 ego-browser。
- 后续阶段中，学校、项目、专业、申请平台要求必须优先用 webfetch 读取已知链接；链接信息不足时用 websearch 查找官方页面。抓取结果必须调用 application-agent_requirements 落盘。
- 默认流程中的工作区创建、材料分类、状态更新、文档生成、ego-browser 填表状态记录和高风险识别，必须调用对应的 application-agent_* Custom Tool。
- 客户端已随包提供 ripgrep 和 OCR，不要下载工具、不要用 Python，也不要用 bash 读写状态 JSON。文件读取使用 OpenCode 内置 read/glob/grep；扫描材料调用 application-agent_materials 的 extract_text；状态更新只调用申请专用工具。
- bash 只允许用于官方 ego-browser skill 指定的 ego-browser nodejs heredoc 浏览器操作，以及有限诊断；不得用普通 bash 临时脚本替代申请专用工具链。
- 每次调用申请专用 Custom Tool 后，工具会写入 03_state/agent_execution_audit.json。任务总结前必须检查该审计文件，确认关键工具链已经执行。
- 如果某个 Custom Tool 调用失败，先记录失败原因并告知顾问，再决定是否用普通命令做有限兜底；不能无声绕过工具链。
- ego-browser skill 和 ego lite 浏览器都是 Terra-Edu 随软件打包的固定快照。每次运行 ego-browser heredoc 必须使用 \`PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs <<'EOF'\`，命中 .opencode/bin/ego-browser wrapper；不能调用系统 PATH 中的 ego-browser，不能自动更新、替换、下载或从 ego lite 应用中重新复制。
${EGO_BROWSER_PROTOCOL}
- 任何可能改变页面内容的动作都会使旧复查失效；用新的观察理解页面差异，完成动态表单验证后才可保存。保存记录必须提供 taskSpaceId、当前 URL、标题和观察证据，不能用 record_saved 直接算成功。

安全规则：
- 不删除或覆盖原始学生文件。
- 不在信息不确定时猜测填写。
- 可调用 OpenCode 内置 question 工具；所有问题必须短、清楚、带 2-3 个顾问可执行选项，并接受自定义回复。可多选的问题必须显式传 multiple:true，等待顾问勾选后点击“确认并提交”。
- 不自动点击最终提交申请。
- 不自动付款。
- 不自动发送不可逆推荐信邀请。
- 不收集、不保存、不读取申请平台密码；页面需要登录时交由顾问手动完成。
- 可以填写、上传和保存，但最终提交必须由顾问人工确认。

你必须在每个关键阶段通过对话框告诉顾问当前进度。`

const SKILL_DEFINITIONS = [
  {
    name: "task-initialization",
    description: "创建申请任务上下文，读取任务创建页信息并自动启动默认申请流程。",
    body: `执行步骤：
1. 读取任务创建页输入，确认学生姓名、资料文件夹、申请学校、项目和类型；申请链接为空时标记为待官方核验，不阻塞材料整理。
2. 说明本次任务边界：Agent 可以整理、填写、保存和上传可确认材料，但不能最终提交、付款或发送不可逆推荐信邀请。
3. 立即调用 todowrite 创建 10 步默认计划，并调用 application-agent_state，把状态更新为“正在创建申请工作区”。
4. 调用 workspace-building skill，只完成工作区初始化和材料副本复制。
5. 向顾问汇报工作区路径、材料副本位置和下一步计划；后续再进入材料读取、分类、申请要求抓取和填表阶段。

输出要求：
- 对话里用 1-3 句话说明当前开始做什么。
- 需要顾问确认时调用 OpenCode question 工具，提供短问题和 2-3 个可选答案。`,
  },
  {
    name: "student-file-reading",
    description: "读取申请工作区中的学生材料副本，识别文档、表格、图片、PDF 和未知材料。",
    body: `执行步骤：
1. 只读取 00_original_backup，不读取或修改原始学生文件夹。
2. 列出所有文件路径、扩展名、大小和可能用途。
3. 先调用 application-agent_materials，action 使用 extract_text；它会使用随包 PaddleOCR，并把 PDF/图片结果写入 03_state/extracted_text/ 和 ocr_index.json。
4. 再对有文本层的 PDF、doc/docx、xlsx/csv、txt/md 提取文字摘要；OCR 失败必须记录失败原因，不要假装读懂。
5. 无法识别用途的材料标记为 needs_review。

输出要求：
- 汇报识别到的材料类型和无法识别的文件。
- 后续判断必须基于文件内容、OCR 结果或明确文件名，不确定就记录。`,
  },
  {
    name: "workspace-building",
    description: "创建隔离申请工作区，复制原始材料，建立标准目录和初始状态文件。",
    body: `执行步骤：
1. 调用 application-agent_workspace，action 使用 initialize。
2. 确认目录包含 00_original_backup、01_classified_materials、02_generated、03_state、04_logs、05_screenshots、06_new_materials。
3. 确认原始学生文件夹没有被修改；所有后续读写都在申请工作区内完成。
4. 调用 application-agent_state，把状态更新为“正在读取文件”。

输出要求：
- 告诉顾问工作区已创建，原始材料已复制为副本。
- 如果复制失败，记录失败文件和原因，不要继续假装完成。`,
  },
  {
    name: "material-organization",
    description: "按身份、学术、语言、文书、推荐、财务、平台相关、其他、待确认分类材料。",
    body: `执行步骤：
1. 调用 application-agent_materials，先用 extract_text 生成扫描材料文字，再用 classify 对 00_original_backup 中的文件分类。
2. 优先结合文件名、03_state/extracted_text/ 中的文字和文件内容判断用途。
3. 分类目录必须覆盖 identity、academic、language、essays、recommendation、financial、platform_related、other、needs_review。
4. 不确定材料进入 needs_review，并在 missing_items.json 中加入“待确认材料用途”。
5. 分类完成后调用 application-agent_state 更新为“正在生成学生资料”。

输出要求：
- 汇报已分类数量、主要材料类型、待确认数量。
- 不要移动或覆盖原始学生文件夹。`,
  },
  {
    name: "student-profile-generation",
    description: "根据已有材料生成结构化 student_profile.md，作为后续填表核心资料库。",
    body: `执行步骤：
1. 读取 03_state/materials_index.json、文本/OCR 提取结果、已有缺失项和任务输入。
2. 生成或更新 02_generated/student_profile.md。
3. 档案必须包含：基本信息、联系方式、家庭信息、教育经历、成绩、语言成绩、活动、奖项、文书、推荐人、申请目标、材料目录、材料路径、缺失信息、不确定信息、填表注意事项。
4. 对无法确认的字段写“待确认”，不要编造。
5. 生成后调用 application-agent_state 更新为“正在检查缺失内容”。

输出要求：
- 告诉顾问档案路径和主要已确认信息。
- 明确列出仍不确定的关键字段。`,
  },
  {
    name: "application-target-analysis",
    description: "根据学校、项目、专业、申请类型和平台判断通用申请信息与材料需求。",
    body: `执行步骤：
1. 读取任务输入、student_profile.md 和材料目录。
2. 先用 webfetch 读取任务中的申请链接；如果链接只到登录页或信息不足，用 websearch 查找学校官网、项目页和 admissions requirements 官方页面。
3. 调用 application-agent_requirements，把来源 URL、抓取时间、可信度、字段需求、材料需求、待确认要求写入 application_requirements.json/md。
4. 基于申请学校、项目、专业、申请类型和官方来源判断通用需求：身份、学历、成绩、语言、简历、文书、推荐人、资金、紧急联系人、申请问题。
5. 只做可解释的通用申请分析；除非申请平台页面已经通过 ego-browser snapshot/pageInfo 识别，不要臆测平台专属字段。
6. 把缺失信息、缺失材料、不确定字段交给 missing-content-recording skill。

输出要求：
- 区分“确定缺失”和“需要确认”。
- 已有的信息不要重复问。
- 每条学校/项目要求要能追溯到 application_requirements.json 中的来源。`,
  },
  {
    name: "missing-content-recording",
    description: "记录申请过程中发现的所有缺失信息、缺失材料和不确定内容。",
    body: `执行步骤：
1. 读取现有 03_state/missing_items.json，去重后更新，不要反复制造相同缺失项。
2. 每个缺失项必须包含 name、type、source、whyNeeded、prepareFrom、formatRequirement、blocksProgress、status、addedToWordList。
3. 信息类、材料类、不确定类分别标记为 information、material、uncertain。
4. 页面填表过程中发现的缺失项要记录 page/currentPage。
5. 更新后调用 application-agent_state 同步缺失数量和当前状态。

输出要求：
- 只列真正缺失、无法判断或必须顾问确认的内容。
- 不要把已经在 student_profile.md 中确认的信息重复写成缺失。`,
  },
  {
    name: "word-checklist-generation",
    description: "根据 missing_items.json 生成适合发给学生或家长的 Word 缺失材料清单。",
    body: `执行步骤：
1. 必须从 03_state/missing_items.json 读取缺失项，不从聊天记录临时拼清单。
2. 调用 application-agent_documents，action 使用 generate_word 或 generate_all。
3. Word 清单面向顾问、学生和家长，避免技术语言。
4. 每项说明：缺什么、为什么需要、去哪里准备、格式要求、是否影响继续申请。
5. 如果没有缺失项，也生成“当前暂无需补充”的清单或在总结中说明。

输出要求：
- 告诉顾问 Word 文件路径。
- 不要输出内部 JSON 字段名给学生/家长。`,
  },
  {
    name: "cua-application-filling",
    description: "通过 ego-browser / ego lite 打开申请平台、等待顾问登录、识别页面字段、填写可确认信息并保存页面。",
    body: `执行步骤：
1. 首次进入平台前调用 application-agent_cua，action 使用 prepare_ego_task，记录申请链接、taskSpaceName 和本轮目标。
2. ${EGO_BROWSER_PROTOCOL}
3. 首轮先得到 task.id 和无 dialog 的页面观察，再以 taskSpaceId、当前 URL、标题和证据调用 record_observation。后续只依据 student_profile.md 中可确认的信息填写；不确定信息记录为缺失，不猜填。
4. 使用最新语义树、截图或窄范围 DOM/CDP 选择合适的操作方式。动作后的页面差异必须重新观察；任意可改变可见内容的动作都会使动态表单复查失效。
5. alert、离页确认、未知确认或顾问接管均按通用观察协议处理。交接前确认 handOffTaskSpace 返回 done:true；登录交接调用 handoff_to_consultant 时标记 handoffType: login，其他浏览器接管标记 handoffType: browser_takeover。
6. 保存前完成动态表单复查；保存后只在新观察明确显示结果时，以 confirmed:true、taskSpaceId、当前 URL、标题和证据调用 record_save_verified。
7. 上传材料用 ego-browser uploadFile；上传后在新的无 dialog 观察中确认文件名或状态，再调用 record_upload。
8. 每次准备执行最终提交、付款、推荐信邀请或其他不可逆确认前，必须先调用 application-agent_risk；命中 BLOCKED 就停止。
9. 只有整个浏览器阶段确实结束时才可 completeTaskSpace；不得因为当前页面完成而关闭或完成 task space。

输出要求：
- 持续告诉顾问正在填写哪个页面、保存了什么、缺了什么。
- 让实时观察决定采用语义、视觉或窄范围 DOM/CDP workflow，不为特定学校或页面预设规则。`,
  },
  {
    name: "material-upload",
    description: "根据申请平台要求匹配本地材料并尝试上传，记录成功或失败原因。",
    body: `执行步骤：
1. 读取 student_profile.md、materials_index.json 和当前申请页面状态。
2. 只上传用途和字段要求能明确匹配的材料；不确定材料不能上传。
3. 上传前检查高风险：不要上传含账号密码、无关隐私或用途不明文件。
4. 上传材料必须通过 ego-browser uploadFile 完成；上传后用 snapshotText/pageInfo 或必要截图确认文件名/状态。
5. 上传成功调用 application-agent_cua record_upload；失败调用 record_failure；需要证据时使用 ego-browser captureScreenshot，并把截图路径或页面证据写入 detail/evidence。
6. 上传后更新 application_progress.json 和 task_summary.md。

输出要求：
- 汇报上传了哪些材料、哪些失败、失败原因和是否需要顾问手动处理。`,
  },
  {
    name: "continue-after-supplement",
    description: "顾问补齐材料后重新读取新材料，更新档案和缺失项，并继续申请填写。",
    body: `执行步骤：
1. 优先读取 06_new_materials；如顾问说明材料在其他位置，先复制进申请工作区后再处理。
2. 调用 application-agent_workspace refresh 或相应工具刷新文件计数。
3. 重新执行 student-file-reading、material-organization、student-profile-generation、missing-content-recording。
4. 根据新的 missing_items.json 重新生成 Word 清单和任务总结。
5. 如果关键缺失已补齐，调用 cua-application-filling 继续从 application_progress.json 中的当前位置填写。

输出要求：
- 告诉顾问哪些缺失已解决、哪些仍然缺。
- 不要覆盖顾问明确保留的旧版本文件。`,
  },
  {
    name: "task-summary",
    description: "总结当前任务状态、完成内容、未完成内容、生成文件、申请平台进度和下一步建议。",
    body: `执行步骤：
1. 读取 task_state.json、application_progress.json、missing_items.json、materials_index.json、application_requirements.json、agent_execution_audit.json 和已生成文件列表。
2. 调用 application-agent_documents，action 使用 generate_summary 或 generate_all。
3. 总结已完成、未完成、缺失项、学校/项目要求来源、工具链审计结果、失败原因、高风险拦截、已保存页面、已上传材料、下一步建议。
4. 明确提醒最终提交、付款、推荐信邀请等需要顾问人工处理。

输出要求：
- 语言面向顾问，一眼能看懂。
- 不输出 OpenCode 内部实现细节或原始工具调用堆栈。`,
  },
]

const COMMAND_DEFINITIONS = [
  ["organize-materials", "整理学生资料", "请读取当前申请工作区材料副本，调用 material-organization skill，整理材料并更新材料目录。"],
  ["generate-profile", "生成学生申请档案", "请调用 student-profile-generation skill，基于当前材料生成或更新 student_profile.md。"],
  ["check-missing", "检查缺失内容", "请先调用 application-target-analysis skill，用 webfetch/websearch 获取官方申请要求并调用 application-agent_requirements 落盘，再调用 missing-content-recording skill 更新 missing_items.json。"],
  ["generate-info-form", "生成信息收集表", "请根据 missing_items.json 生成面向顾问和学生的信息补充清单。"],
  ["generate-material-form", "生成材料收集表", "请根据 missing_items.json 生成面向学生和家长的材料收集表。"],
  ["start-application", "开始申请填表", "先确认 03_state/material_review.json 已由顾问批准，再调用 cua-application-filling skill，打开申请平台，等待顾问登录，并填写可确认字段。"],
  ["continue-application", "继续申请填表", "请从 application_progress.json 恢复申请进度，继续填写和保存可确认页面。"],
  ["continue-after-supplement", "材料已经补好了，继续申请", "请调用 continue-after-supplement skill，读取补充材料，更新档案和缺失项，并继续申请填表。"],
  ["generate-word-checklist", "生成 Word 缺失清单", "请调用 word-checklist-generation skill，根据 missing_items.json 重新生成 missing_materials.docx。"],
  ["summarize-progress", "总结当前进度", "请调用 task-summary skill，总结已完成、未完成、缺失项、生成文件和下一步建议。"],
]

function renderSkill(skill: { name: string; description: string; body: string }) {
  return `---
name: ${skill.name}
description: ${skill.description}
compatibility: opencode
metadata:
  product: terra-edu-application-agent
---

## 作用

${skill.body}

## 执行原则

- 在申请工作区内操作，不修改原始学生资料。
- 只要步骤有对应 application-agent_* Custom Tool，必须优先调用该工具；bash 只可执行 ego-browser heredoc 和有限诊断，不能替代申请专用工具链，也不能用 Python 读写状态。
- 每次关键工具调用后检查 03_state/agent_execution_audit.json 或对应状态文件，确认工具链留下可回归的执行证据。
- 启动和复杂流程必须使用 todowrite 管理 10 步计划，并在 application_progress.json 同步关键状态。
- 申请学校、项目和平台要求必须优先用 webfetch/websearch 获取官方来源，再调用 application-agent_requirements 落盘。
- 已有信息不要重复要求。
- 遇到扫描 PDF 或图片材料，先调用 application-agent_materials 的 extract_text；失败要记录，不要猜。
- 不确定内容必须使用 OpenCode question 询问顾问，给出 2-3 个清楚选项并允许自定义回复。
- 最终提交、付款、推荐信邀请和不可逆确认必须停止并交给顾问。
`
}

function renderCommand(command: string[]) {
  return `---
description: ${command[1]}
agent: application-agent
model: opencode-go/deepseek-v4-pro
---

${command[2]}
`
}

function renderApplicationAgentTools() {
  return String.raw`import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join, relative, resolve } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

type ToolContext = { directory?: string; sessionID?: string; messageID?: string; threadID?: string; agent?: string; root?: string; worktree?: string }
type JsonSchema = Record<string, unknown>

function objectArg(properties: JsonSchema, required: string[] = []) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  }
}

function inputArg(properties: JsonSchema, required: string[] = []) {
  return {
    input: objectArg(properties, required),
  }
}

const statusValues = [
  "已创建",
  "正在复制原始材料",
  "正在创建申请工作区",
  "正在读取文件",
  "正在整理材料",
  "正在生成学生资料",
  "正在检查缺失内容",
  "等待顾问登录",
  "等待顾问接管浏览器",
  "正在填写申请平台",
  "正在保存申请进度",
  "正在上传材料",
  "等待补充材料",
  "等待顾问确认材料",
  "可继续申请",
  "阶段性完成",
  "异常中断",
] as const

const generated = [
  ["学生申请档案", "02_generated/student_profile.md", "markdown"],
  ["信息收集表", "02_generated/info_collection_form.md", "markdown"],
  ["材料收集表", "02_generated/material_collection_form.md", "markdown"],
  ["Word 缺失材料清单", "02_generated/missing_materials.docx", "docx"],
  ["任务总结", "02_generated/task_summary.md", "markdown"],
  ["任务状态", "03_state/task_state.json", "json"],
  ["缺失项记录", "03_state/missing_items.json", "json"],
  ["申请进度记录", "03_state/application_progress.json", "json"],
  ["申请要求记录", "03_state/application_requirements.json", "json"],
  ["申请要求摘要", "02_generated/application_requirements.md", "markdown"],
  ["工具执行审计", "03_state/agent_execution_audit.json", "json"],
  ["Agent 日志", "04_logs/agent_log.md", "log"],
  ["CUA 日志", "04_logs/cua_log.md", "log"],
] as const

const workspaceDirs = [
  "00_original_backup",
  "01_classified_materials/identity",
  "01_classified_materials/academic",
  "01_classified_materials/language",
  "01_classified_materials/essays",
  "01_classified_materials/recommendation",
  "01_classified_materials/financial",
  "01_classified_materials/platform_related",
  "01_classified_materials/other",
  "01_classified_materials/needs_review",
  "02_generated",
  "03_state",
  "04_logs",
  "05_screenshots",
  "06_new_materials",
]

function root(ctx: { directory?: string }) {
  if (!ctx.directory) throw new Error("OpenCode tool context is missing directory")
  return ctx.directory
}

async function readJson(path: string, fallback: any) {
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch {
    return fallback
  }
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8")
}

function redactSensitiveText(value: unknown) {
  return String(value ?? "")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/\\n[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "\\n[REDACTED_EMAIL]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/(const\s+password\s*=\s*)"(?:\\.|[^"])*"/gi, '$1"[REDACTED_PASSWORD]"')
    .replace(/(const\s+username\s*=\s*)"(?:\\.|[^"])*"/gi, '$1"[REDACTED_USERNAME]"')
    .replace(/(const\s+password\s*=\\?")([^"\\]*(?:\\.[^"\\]*)*)(\\?")/gi, '$1[REDACTED_PASSWORD]$3')
    .replace(/(const\s+username\s*=\\?")([^"\\]*(?:\\.[^"\\]*)*)(\\?")/gi, '$1[REDACTED_USERNAME]$3')
    .replace(/("password"\s*:\s*)"(?:\\.|[^"])*"/gi, '$1"[REDACTED_PASSWORD]"')
    .replace(/("username"\s*:\s*)"(?:\\.|[^"])*"/gi, '$1"[REDACTED_USERNAME]"')
    .replace(/("authorization"\s*:\s*)"(?:\\.|[^"])*"/gi, '$1"[REDACTED_AUTH]"')
}

async function appendLog(workspace: string, kind: "agent" | "cua", message: string) {
  const file = join(workspace, "04_logs", kind === "agent" ? "agent_log.md" : "cua_log.md")
  const current = existsSync(file) ? await readFile(file, "utf8") : "# " + (kind === "agent" ? "Agent" : "CUA") + " 日志\n\n"
  await writeFile(file, current + "- " + new Date().toISOString() + " " + redactSensitiveText(message) + "\n", "utf8")
}

async function appendAudit(workspace: string, tool: string, action: string, status: "started" | "completed" | "failed", detail = "", ctx?: ToolContext) {
  try {
    const file = join(workspace, "03_state", "agent_execution_audit.json")
    const current = await readJson(file, [])
    const entries = Array.isArray(current) ? current : []
    entries.push({
      at: new Date().toISOString(),
      tool: "application-agent_" + tool,
      action,
      status,
      detail: redactSensitiveText(detail),
      context: {
        sessionID: ctx?.sessionID || "",
        messageID: ctx?.messageID || "",
        threadID: ctx?.threadID || "",
        agent: ctx?.agent || "",
        directory: ctx?.directory || workspace,
        root: ctx?.root || "",
        worktree: ctx?.worktree || "",
      },
    })
    await writeJson(file, entries)
  } catch (error: any) {
    await appendLog(workspace, "agent", "工具执行审计写入失败：" + String(error?.message || error)).catch(() => {})
  }
}

function ensureCuaProgress(progress: any) {
  if (!progress || typeof progress !== "object") progress = {}
  if (!Array.isArray(progress.completedPages)) progress.completedPages = []
  if (!Array.isArray(progress.savedPages)) progress.savedPages = []
  if (!Array.isArray(progress.uploadedMaterials)) progress.uploadedMaterials = []
  if (!Array.isArray(progress.failedActions)) progress.failedActions = []
  if (!Array.isArray(progress.highRiskBlocks)) progress.highRiskBlocks = []
  if (!Array.isArray(progress.filledFields)) progress.filledFields = []
  if (!Array.isArray(progress.verifiedFields)) progress.verifiedFields = []
  if (!Array.isArray(progress.blockedDialogs)) progress.blockedDialogs = []
  if (!Array.isArray(progress.validationMessages)) progress.validationMessages = []
  if (!Array.isArray(progress.requiredEmptyFields)) progress.requiredEmptyFields = []
  if (!Array.isArray(progress.dynamicFormChecks)) progress.dynamicFormChecks = []
  return progress
}

function browserAuditError(action: string, fields: Record<string, unknown>) {
  const missing = Object.entries(fields)
    .filter(([, value]) => !String(value || "").trim())
    .map(([name]) => name)
  if (missing.length === 0) return ""
  return "BROWSER_AUDIT_REQUIRED: " + action + " requires " + missing.join(", ") + "."
}

function requireNumericTaskSpaceId(taskSpaceId: string) {
  if (numericTaskSpaceId(taskSpaceId)) return ""
  return "BROWSER_TASK_SPACE_ID_REQUIRED: taskSpaceId must be the numeric id returned by ego-browser."
}

function numericTaskSpaceId(value: unknown) {
  const taskSpaceId = String(value || "").trim()
  return /^\d+$/.test(taskSpaceId) ? taskSpaceId : ""
}

function browserTaskSpaceMismatch(progress: any, taskSpaceId: string) {
  const persistedTaskSpaceId = String(progress?.egoBrowser?.taskSpaceId || "").trim()
  if (persistedTaskSpaceId && !numericTaskSpaceId(persistedTaskSpaceId)) {
    return "BROWSER_LEGACY_TASK_SPACE_CONFIRMATION_REQUIRED: saved taskSpaceId is not a numeric ego-browser id. Use prepare_ego_task to list spaces and ask the consultant to confirm one."
  }
  const savedTaskSpaceId = numericTaskSpaceId(persistedTaskSpaceId)
  if (!savedTaskSpaceId || savedTaskSpaceId === taskSpaceId) return ""
  return "BROWSER_TASK_SPACE_MISMATCH: supplied taskSpaceId does not match the saved ego-browser task space."
}

function hasPendingBrowserHandoff(progress: any) {
  const browser = progress?.egoBrowser || {}
  if (browser.handoffPending === true) return true
  return browser.handoffPending !== false && Boolean(browser.handoffAt) && !browser.resumedAt
}

function requiresLegacyTaskSpaceConfirmation(progress: any) {
  const browser = progress?.egoBrowser || {}
  if (browser.awaitingFreshTaskSpaceId === true) return false
  return !numericTaskSpaceId(browser.taskSpaceId) && Boolean(browser.taskSpaceId || browser.preparedAt || browser.taskSpaceName || progress?.browserBackend === "ego-browser" || progress?.platformLastOpenedAt)
}

function hasVerifiedBrowserSave(progress: any) {
  return Array.isArray(progress?.savedPages) && progress.savedPages.length > 0
}

function appendLimited(progress: any, key: string, item: any, limit = 120) {
  if (!Array.isArray(progress[key])) progress[key] = []
  progress[key].push(item)
  if (progress[key].length > limit) progress[key] = progress[key].slice(progress[key].length - limit)
}

function parseJsonObjectFromText(text: string) {
  const raw = String(text || "").trim()
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {}
  const first = raw.indexOf("{")
  if (first < 0) return undefined
  for (let end = raw.length; end > first; end -= 1) {
    const chunk = raw.slice(first, end).trim()
    if (!chunk.endsWith("}")) continue
    try {
      return JSON.parse(chunk)
    } catch {}
  }
  return undefined
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(current: string) {
    if (!existsSync(current)) return
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      if (entry.isFile()) out.push(full)
    }
  }
  await walk(dir)
  return out
}

function resolveWorkspacePath(workspace: string, value?: string) {
  const raw = String(value || ".").trim()
  if (!raw || raw === ".") return workspace
  if (raw === "~") return process.env.HOME || raw
  if (raw.startsWith("~/")) return join(process.env.HOME || "", raw.slice(2))
  return raw.startsWith("/") ? raw : resolve(workspace, raw)
}

function isSensitivePath(path: string) {
  const name = basename(path).toLowerCase()
  if (name === ".env" || name.startsWith(".env.")) return true
  if (/password|secret|token|credential/.test(path.toLowerCase())) return true
  return false
}

function clipRuntimeText(value: unknown, max = 30000) {
  const text = redactSensitiveText(value)
  if (text.length <= max) return text
  return text.slice(0, max) + "\n...[truncated " + String(text.length - max) + " chars]"
}

function globToRegExp(pattern: string) {
  const escaped = pattern
    .replace(/[.+^$()|[\]\\{}]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp("^" + escaped + "$", "i")
}

function matchesRuntimePattern(path: string, workspace: string, pattern?: string) {
  const raw = String(pattern || "").trim()
  if (!raw || raw === "**/*" || raw === "*") return true
  const rel = relative(workspace, path)
  try {
    return globToRegExp(raw).test(rel) || globToRegExp(raw).test(basename(path))
  } catch {
    return rel.toLowerCase().includes(raw.toLowerCase()) || basename(path).toLowerCase().includes(raw.toLowerCase())
  }
}

function isDangerousRuntimeCommand(command: string) {
  const normalized = command.replace(/\s+/g, " ").trim().toLowerCase()
  if (/\brm\s+-rf\s+(\/|~|\*|\$home|\.)/.test(normalized)) return true
  if (/\bgit\s+push\b/.test(normalized)) return true
  if (/\b(shutdown|reboot|halt)\b/.test(normalized)) return true
  if (/osascript .*tell application .*system events/i.test(command)) return true
  return false
}

async function runtimeRunShell(command: string, cwd: string, timeout: number) {
  if (isDangerousRuntimeCommand(command)) {
    return { exitCode: 126, stdout: "", stderr: "Blocked by Terra-Edu runtime safety policy." }
  }
  const shell = process.env.SHELL || "/bin/zsh"
  const pathParts = [join(cwd, ".opencode/bin"), process.env.PATH || ""].filter(Boolean)
  try {
    const result = await execFileAsync(shell, ["-lc", command], {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024 * 8,
      env: { ...process.env, PATH: pathParts.join(":") },
    } as any)
    return { exitCode: 0, stdout: String(result.stdout || ""), stderr: String(result.stderr || "") }
  } catch (error: any) {
    return {
      exitCode: typeof error?.code === "number" ? error.code : 1,
      stdout: String(error?.stdout || ""),
      stderr: String(error?.stderr || error?.message || error),
    }
  }
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
}

function stripHtml(text: string) {
  return decodeHtmlEntities(String(text || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
}

async function runtimeFetchText(url: string, timeout: number) {
  const fetchFn = (globalThis as any).fetch
  if (typeof fetchFn !== "function") throw new Error("fetch is unavailable in this OpenCode runtime")
  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : undefined
  try {
    const response = await fetchFn(url, {
      signal: controller?.signal,
      headers: {
        "user-agent": "Terra-Edu Application Agent/1.0",
        accept: "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8",
      },
    })
    const text = await response.text()
    return {
      ok: Boolean(response.ok),
      status: Number(response.status || 0),
      url: String(response.url || url),
      contentType: String(response.headers?.get?.("content-type") || ""),
      text,
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function runtimeSearchWeb(query: string, maxResults: number) {
  const target = "https://duckduckgo.com/html/?q=" + encodeURIComponent(query)
  const fetched = await runtimeFetchText(target, 20000)
  const html = fetched.text
  const results = []
  const regex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) && results.length < maxResults) {
    const url = decodeHtmlEntities(match[1] || "")
    const title = stripHtml(match[2] || "")
    if (url && title) results.push({ title, url })
  }
  if (results.length === 0) {
    return {
      source: target,
      results: [],
      excerpt: clipRuntimeText(stripHtml(html), 4000),
    }
  }
  return { source: target, results }
}

async function runtimeLoadSkill(workspace: string, name: string) {
  const skillName = String(name || "").trim()
  if (!skillName) throw new Error("Skill name is required")
  const candidates = [
    join(workspace, ".opencode/skills", skillName, "SKILL.md"),
    join(workspace, ".opencode/skills", skillName.replace(/^.*:/, ""), "SKILL.md"),
    join(workspace, ".opencode/skill", skillName, "SKILL.md"),
  ]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const body = await readFile(file, "utf8")
    const related = (await listFiles(dirname(file))).slice(0, 50).map((item) => relative(workspace, item))
    return { name: skillName, path: relative(workspace, file), body: clipRuntimeText(body, 40000), relatedFiles: related }
  }
  return { name: skillName, status: "not_found", searched: candidates.map((item) => relative(workspace, item)) }
}

function generatedFiles(workspace: string) {
  return [
    { label: "申请工作区", path: workspace, kind: "folder" },
    ...generated.map(([label, path, kind]) => ({ label, path: join(workspace, path), kind })),
  ].filter((item) => item.kind === "folder" || existsSync(item.path))
}

function firstText(item: any, keys: string[]) {
  for (const key of keys) {
    const value = item?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
  }
  return ""
}

function collectMissingRecords(raw: any) {
  if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === "object")
  if (!raw || typeof raw !== "object") return []
  const direct = Array.isArray(raw.items) ? raw.items.filter((item: any) => item && typeof item === "object") : []
  const grouped: any[] = []
  for (const [key, type] of [["missingInformation", "information"], ["missing_info", "information"], ["missingMaterials", "material"], ["missing_materials", "material"], ["uncertainItems", "uncertain"], ["uncertain_items", "uncertain"]]) {
    const value = raw[key]
    if (!Array.isArray(value)) continue
    grouped.push(...value.filter((item: any) => item && typeof item === "object").map((item: any) => ({ ...item, type: item.type || type })))
  }
  return [...direct, ...grouped]
}

function classifyMissingType(item: any) {
  const type = String(item?.type ?? "").toLowerCase()
  const status = String(item?.status ?? item?.state ?? item?.progress ?? "").toLowerCase()
  const category = String(item?.category ?? "").toLowerCase()
  const text = (type + " " + category + " " + firstText(item, ["name", "item", "field", "title", "detail", "details", "reason"])).toLowerCase()
  if (/missing_form|form_error|required_field/.test(status)) return "information"
  if (/available_not_uploaded|upload_pending/.test(status)) return "material"
  if (/information|info|field|personal|信息缺失|信息/.test(type)) return "information"
  if (/material|document|file|upload|essay|文书缺失|材料缺失|材料|文书/.test(type)) return "material"
  if (/uncertain|confirmation|待确认/.test(type)) return "uncertain"
  if (/推荐|recommendation|财务|financial|银行|bank|文书|essay|sop|resume|cv|简历|upload|上传|document|材料/.test(text)) return "material"
  if (/地址|公民|法律|就业|工作|申请信息|表单|问题|日期|姓名|电话|邮箱|信息/.test(text)) return "information"
  return "uncertain"
}

function normalizeMissingStatus(item: any, type: string) {
  const status = String(item?.status ?? item?.state ?? item?.progress ?? "").toLowerCase()
  if (/resolved|complete|completed|done|filled|uploaded|verified|saved|已解决|已完成|已填写|已上传/.test(status)) return "resolved"
  if (/pending_consultant|needs_confirmation|need_confirmation|uncertain|waiting|待确认|需确认/.test(status)) return "needs_confirmation"
  if (type === "uncertain") return "needs_confirmation"
  return "missing"
}

function normalizeMissingItems(raw: any) {
  return collectMissingRecords(raw).map((item: any, index: number) => {
    const type = classifyMissingType(item)
    const status = normalizeMissingStatus(item, type)
    const priority = firstText(item, ["priority", "urgency"]) || "medium"
    const rawStatus = firstText(item, ["status", "state", "progress"])
    const explicitBlocksProgress = item.blocksProgress ?? item.blocks_progress ?? item.affects_continuation
    return {
      id: firstText(item, ["id"]) || "missing-" + String(index + 1).padStart(2, "0"),
      name: firstText(item, ["name", "item", "field", "title", "label", "requirement", "id"]) || "待确认事项 " + String(index + 1).padStart(2, "0"),
      type,
      status,
      source: ["material_scan", "application_target", "cua", "manual"].includes(item.source) ? item.source : "application_target",
      page: firstText(item, ["page", "section"]),
      whyNeeded: firstText(item, ["whyNeeded", "why_needed", "detail", "details", "reason", "description", "note"]) || "申请平台或学校申请要求需要该内容。",
      prepareFrom: firstText(item, ["prepareFrom", "prepare_from", "preparation_method", "sourceText", "source"]) || (type === "material" ? "请学生或家长提供对应材料。" : "请顾问向学生确认后补充。"),
      formatRequirement: firstText(item, ["formatRequirement", "format_requirement", "format", "requirementFormat", "requirement"]) || (type === "material" ? "清晰 PDF、Word 或图片文件，以申请平台要求为准。" : "文字说明即可；涉及日期、地址、姓名拼写时请按证件或官方材料填写。"),
      blocksProgress: status !== "resolved" && (typeof explicitBlocksProgress === "boolean" ? explicitBlocksProgress : priority === "high" || status === "missing"),
      addedToWordList: item.addedToWordList !== false && item.include_in_word !== false,
      priority,
      rawStatus,
      resolvedAt: firstText(item, ["resolvedAt", "resolved_at"]),
      resolvedReason: firstText(item, ["resolvedReason", "resolved_reason"]),
    }
  })
}

function collectProgressText(value: any): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(collectProgressText).join(" ")
  if (!value || typeof value !== "object") return ""
  return Object.values(value).map(collectProgressText).join(" ")
}

function hasVerifiedReviewReady(progress: any) {
  const savedPages = Array.isArray(progress?.savedPages) ? progress.savedPages : []
  return savedPages.some((entry: any) => {
    const text = collectProgressText(entry).toLowerCase()
    if (/application ready for submission|ready for submission|no errors? or warnings?/.test(text)) return true
    return /(0\s*(错误|error|errors))/.test(text) && /(0\s*(警告|warning|warnings))/.test(text)
  })
}

function isReviewResolvedPlatformItem(item: any) {
  const rawStatus = String(item.rawStatus || item.status || "").toLowerCase()
  const text = String([item.name, item.page, item.whyNeeded, item.prepareFrom, item.formatRequirement].join(" ")).toLowerCase()
  if (rawStatus === "missing_form") return true
  if (item.source === "cua") return true
  if (/review|slate|申请平台|form|表单|required|必填|validation|error|错误|warning|警告/.test(text)) {
    if (/文书|statement of purpose|sop|推荐信|recommendation|银行|存款|资金|financial|护照号码|passport number|i-20/.test(text)) {
      return rawStatus === "available_not_uploaded" || (/resume|cv|简历|upload|上传/.test(text) && /review[^。；\n]*(错误|error|required|is required)|error|错误|required|必填/.test(text))
    }
    return true
  }
  return false
}

function syncMissingItemsWithProgress(missing: any[], progress: any) {
  if (!hasVerifiedReviewReady(progress)) return missing
  const resolvedAt = new Date().toISOString()
  return missing.map((item: any) => {
    if (!isReviewResolvedPlatformItem(item)) return item
    return {
      ...item,
      status: "resolved",
      blocksProgress: false,
      addedToWordList: false,
      resolvedAt: item.resolvedAt || resolvedAt,
      resolvedReason: item.resolvedReason || "申请平台 Review 已由 ego-browser 验证为 0 错误 0 警告。",
    }
  })
}

function activeMissingItems(missing: any[]) {
  return missing.filter((item: any) => item.status !== "resolved")
}

function requirementList(value: any) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean)
  if (typeof value === "string" && value.trim()) return [value.trim()]
  return []
}

function normalizeRequirementSources(value: any) {
  const source = Array.isArray(value) ? value : []
  return source.map((item: any) => ({
    url: String(item?.url || item || "").trim(),
    title: String(item?.title || "").trim(),
    fetchedAt: String(item?.fetchedAt || new Date().toISOString()),
    confidence: String(item?.confidence || "medium"),
    notes: String(item?.notes || "").trim(),
  })).filter((item: any) => item.url)
}

function renderRequirementsMarkdown(task: any, requirements: any) {
  const input = task.input || {}
  const lines = [
    "# 申请要求摘要",
    "",
    "学生：" + (input.studentName || ""),
    "申请学校：" + (input.school || ""),
    "申请项目：" + (input.program || ""),
    "更新时间：" + (requirements.updatedAt || new Date().toISOString()),
    "",
    "## 来源",
    "",
  ]
  const sources = normalizeRequirementSources(requirements.sources)
  if (sources.length === 0) lines.push("- 暂无可确认来源，需顾问人工确认。")
  for (const source of sources) lines.push("- " + (source.title ? source.title + "：" : "") + source.url + "（可信度：" + source.confidence + "）")
  lines.push("", "## 字段要求", "")
  const fields = requirementList(requirements.fieldRequirements)
  if (fields.length === 0) lines.push("- 暂未确认字段要求。")
  for (const item of fields) lines.push("- " + item)
  lines.push("", "## 材料要求", "")
  const materials = requirementList(requirements.materialRequirements)
  if (materials.length === 0) lines.push("- 暂未确认材料要求。")
  for (const item of materials) lines.push("- " + item)
  lines.push("", "## 待确认", "")
  const uncertain = requirementList(requirements.uncertainRequirements)
  if (uncertain.length === 0) lines.push("- 暂无额外待确认要求。")
  for (const item of uncertain) lines.push("- " + item)
  lines.push("", "说明：最终以申请平台页面和学校官方要求为准。")
  return lines.join("\n") + "\n"
}

async function summarizeCounts(workspace: string) {
  const totalFiles = (
    await Promise.all(
      [join(workspace, "00_original_backup"), join(workspace, "06_new_materials")]
        .filter(existsSync)
        .map((directory) => listFiles(directory)),
    )
  ).flat().length
  const missingRaw = await readJson(join(workspace, "03_state/missing_items.json"), [])
  const progress = await readJson(join(workspace, "03_state/application_progress.json"), {})
  const missing = activeMissingItems(syncMissingItemsWithProgress(normalizeMissingItems(missingRaw), progress))
  return {
    totalFiles,
    missingInformation: missing.filter((item: any) => item.type === "information").length,
    missingMaterials: missing.filter((item: any) => item.type === "material").length,
    uncertainItems: missing.filter((item: any) => item.type === "uncertain").length,
  }
}

async function ensureTaskIsActive(workspace: string) {
  const control = await readJson<{ paused?: boolean }>(join(workspace, "03_state/task_control.json"), {})
  if (control.paused) {
    throw new Error("任务已由顾问暂停。请等待顾问在任务工作台点击“继续任务”。")
  }
}

async function loadTask(workspace: string) {
  const fallbackInput = await readJson(join(workspace, "03_state/task_input.json"), {})
  const now = new Date().toISOString()
  const task = await readJson(join(workspace, "03_state/task_state.json"), null)
  if (task?.input) return task
  return {
    id: task?.id ?? task?.task_id ?? basename(workspace),
    slug: task?.slug ?? basename(workspace),
    workspacePath: workspace,
    sessionDirectory: workspace,
    createdAt: task?.createdAt ?? now,
    updatedAt: task?.updatedAt ?? now,
    status: task?.status && statusValues.includes(task.status) ? task.status : "已创建",
    input: fallbackInput,
    counts: await summarizeCounts(workspace),
    generatedFiles: generatedFiles(workspace),
    progress: Array.isArray(task?.progress) ? task.progress : [],
  }
}

async function saveTask(workspace: string, task: any, status?: string, message?: string) {
  const now = new Date().toISOString()
  task.workspacePath = workspace
  task.sessionDirectory = workspace
  task.updatedAt = now
  task.counts = await summarizeCounts(workspace)
  task.generatedFiles = generatedFiles(workspace)
  if (status && statusValues.includes(status as any)) task.status = status
  if (!Array.isArray(task.progress)) task.progress = []
  if (message) task.progress.push({ at: now, status: task.status, message })
  await writeJson(join(workspace, "03_state/task_state.json"), task)
  return task
}

function categoryFor(name: string) {
  const lower = name.toLowerCase()
  if (/passport|护照|id card|身份证|identity/.test(lower)) return ["identity", "命中身份材料关键词"]
  if (/transcript|成绩|在读|毕业|degree|diploma|academic|school report|成绩单/.test(lower)) return ["academic", "命中学术材料关键词"]
  if (/toefl|ielts|duolingo|sat|act|gre|gmat|托福|雅思|多邻国|语言/.test(lower)) return ["language", "命中语言或标化关键词"]
  if (/essay|personal statement|statement|文书|ps|cv|resume|简历/.test(lower)) return ["essays", "命中文书或简历关键词"]
  if (/recommend|reference|推荐|rl|lor/.test(lower)) return ["recommendation", "命中推荐材料关键词"]
  if (/bank|finance|financial|资金|存款|资产|deposit/.test(lower)) return ["financial", "命中财务材料关键词"]
  if (/common app|coalition|ucas|apply|portal|申请平台|账号/.test(lower)) return ["platform_related", "命中申请平台关键词"]
  const ext = extname(lower)
  if ([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".heic"].includes(ext)) return ["other", "文件类型常见，但文件名无法判断具体用途"]
  return ["needs_review", "文件类型或文件名无法确认用途"]
}

async function uniquePath(path: string) {
  if (!existsSync(path)) return path
  const dir = dirname(path)
  const ext = extname(path)
  const stem = basename(path, ext)
  let index = 2
  let candidate = join(dir, stem + "-" + index + ext)
  while (existsSync(candidate)) {
    index += 1
    candidate = join(dir, stem + "-" + index + ext)
  }
  return candidate
}

function sharedOcrState(task: any) {
  const batchWorkspace = String(task.input?.batchWorkspacePath || "").trim()
  if (!batchWorkspace || !existsSync(batchWorkspace)) return undefined
  return {
    outputDir: join(batchWorkspace, "03_state", "shared_extracted_text"),
    indexPath: join(batchWorkspace, "03_state", "shared_ocr_index.json"),
  }
}

export const workspace = {
  description: "Create or refresh the isolated Terra-Edu application workspace. Copies the original student folder into 00_original_backup without modifying the source folder.",
  args: inputArg({
    action: { type: "string", enum: ["initialize", "refresh"], description: "initialize creates directories and copies source materials; refresh only updates counts" },
    sourceFolder: { type: "string", description: "Optional source student folder. Defaults to task input sourceFolder." },
  }),
  async execute(args, ctx) {
    const input = args.input || {}
    const workspace = root(ctx)
    await ensureTaskIsActive(workspace)
    for (const dir of workspaceDirs) await mkdir(join(workspace, dir), { recursive: true })
    const task = await loadTask(workspace)
    const action = input.action || "initialize"
    await appendAudit(workspace, "workspace", action, "started")
    const source = input.sourceFolder || task.input?.sourceFolder
    if (action === "initialize") {
      if (!source) throw new Error("sourceFolder is required for workspace initialization")
      if (!existsSync(source)) throw new Error("sourceFolder does not exist: " + source)
      const entries = await readdir(source, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue
        const from = join(source, entry.name)
        const to = await uniquePath(join(workspace, "00_original_backup", entry.name))
        await cp(from, to, { recursive: true, force: false, errorOnExist: false })
      }
      const batchNote = task.input?.batchWorkspacePath ? "本任务属于选校批次，已从批次共享材料区创建副本。" : ""
      await appendLog(workspace, "agent", "已初始化申请工作区，并把原始资料复制到 00_original_backup。" + batchNote)
      await saveTask(workspace, task, "正在读取文件", "申请工作区已创建，原始材料副本已进入 00_original_backup。" + batchNote)
    } else {
      await saveTask(workspace, task, task.status, "已刷新申请工作区状态和材料计数。")
    }
    await appendAudit(workspace, "workspace", action, "completed", "workspace ready")
    return "申请工作区已就绪：" + workspace
  },
}

export const materials = {
  description: "Extract text from scanned PDF/image materials with the bundled PaddleOCR, or classify backed-up materials and write materials_index files.",
  args: inputArg({
    action: { type: "string", enum: ["extract_text", "classify"], description: "Extract material text before classification, or classify all backed-up materials" },
  }, ["action"]),
  async execute(args, ctx) {
    const workspace = root(ctx)
    await ensureTaskIsActive(workspace)
    const task = await loadTask(workspace)
    const action = String(args.input?.action || "")
    const materialReview = await readJson(join(workspace, "03_state/material_review.json"), {})
    const supplementalRoot = join(workspace, "06_new_materials")
    const hasSupplementalMaterials = materialReview.status === "approved" && materialReview.mode === "supplement_folder" && existsSync(supplementalRoot)
    await appendAudit(workspace, "materials", action, "started")
    if (action === "extract_text") {
      const ocr = join(workspace, ".opencode", "bin", "terra-ocr")
      if (!existsSync(ocr)) throw new Error("Terra-Edu bundled OCR wrapper is missing: " + ocr)
      const shared = sharedOcrState(task)
      const localOutputDir = join(workspace, "03_state", "extracted_text")
      if (shared && existsSync(shared.indexPath) && !hasSupplementalMaterials) {
        await cp(shared.outputDir, localOutputDir, { recursive: true, force: false, errorOnExist: false })
        const results = await readJson(shared.indexPath, [])
        await writeJson(join(workspace, "03_state", "ocr_index.json"), results)
        await appendLog(workspace, "agent", "已复用选校批次共享的 PaddleOCR 提取结果，无需重复 OCR。")
        await saveTask(workspace, task, "正在读取文件", "已复用选校批次的扫描材料 OCR 结果。")
        await appendAudit(workspace, "materials", action, "completed", "reused shared ocr " + results.length, ctx)
        return JSON.stringify({ status: "completed", reusedSharedOcr: true, completed: results.length, files: results }, null, 2)
      }
      const outputDir = shared?.outputDir || localOutputDir
      await mkdir(outputDir, { recursive: true })
      const candidates = (await listFiles(hasSupplementalMaterials ? supplementalRoot : join(workspace, "00_original_backup"))).filter((file) => /\.(pdf|png|jpe?g|heic|tiff?)$/i.test(file))
      const previous = hasSupplementalMaterials
        ? (await readJson<Array<{ file: string; output: string; textLength: number; error: string }>>(join(workspace, "03_state", "ocr_index.json"), [])).filter(
            (item) => !item.file.startsWith("06_new_materials/"),
          )
        : []
      const results = [...previous]
      await appendLog(workspace, "agent", "已启动随包 PaddleOCR，正在逐份扫描 " + candidates.length + " 份 PDF/图片材料。大型扫描件通常需要 3–8 分钟，请保持应用打开。")
      await saveTask(workspace, task, "正在读取文件", "PaddleOCR 正在逐份扫描 " + candidates.length + " 份材料；大型扫描件通常需要 3–8 分钟，请保持应用打开。")
      for (const [index, file] of candidates.entries()) {
        await ensureTaskIsActive(workspace)
        await saveTask(workspace, task, "正在读取文件", "PaddleOCR 正在扫描第 " + (index + 1) + "/" + candidates.length + " 份材料；大型扫描件通常需要 3–8 分钟。")
        const output = join(outputDir, relative(workspace, file).replace(/[\\/]/g, "__") + ".txt")
        const result = await execFileAsync(ocr, [file], { maxBuffer: 16 * 1024 * 1024 }).then(
          ({ stdout, stderr }) => ({ text: stdout.trim(), error: stderr.trim() }),
          (error) => ({ text: "", error: error instanceof Error ? error.message : String(error) }),
        )
        if (result.text) await writeFile(output, result.text + "\n", "utf8")
        results.push({ file: relative(workspace, file), output: relative(workspace, output), textLength: result.text.length, error: result.error })
      }
      const completed = results.filter((result) => result.textLength > 0)
      const failed = results.filter((result) => result.error || result.textLength === 0)
      await writeJson(join(workspace, "03_state", "ocr_index.json"), results)
      if (shared) await writeJson(shared.indexPath, results)
      await appendLog(workspace, "agent", "已使用随包 PaddleOCR 提取 " + completed.length + "/" + results.length + " 份扫描材料文字。")
      await saveTask(workspace, task, "正在读取文件", "已完成扫描材料 OCR：成功 " + completed.length + " 份，失败或无文字 " + failed.length + " 份。")
      await appendAudit(workspace, "materials", action, "completed", "ocr " + completed.length + "/" + results.length)
      return JSON.stringify({ status: "completed", completed: completed.length, failed: failed.length, files: results }, null, 2)
    }

    const files = (
      await Promise.all(
        [join(workspace, "00_original_backup"), supplementalRoot].filter(existsSync).map((directory) => listFiles(directory)),
      )
    ).flat()
    const records = []
    for (const file of files) {
      const fileName = basename(file)
      const [category, reason] = categoryFor(fileName)
      const targetDir = join(workspace, "01_classified_materials", category)
      await mkdir(targetDir, { recursive: true })
      const target = await uniquePath(join(targetDir, fileName))
      await cp(file, target, { force: false, errorOnExist: false })
      records.push({
        originalPath: file,
        backupPath: relative(workspace, file),
        classifiedPath: relative(workspace, target),
        fileName,
        extension: extname(fileName).toLowerCase(),
        category,
        confidence: category === "needs_review" ? "needs_review" : category === "other" ? "medium" : "high",
        reason,
      })
    }
    await writeJson(join(workspace, "03_state/materials_index.json"), records)
    const md = ["# 材料目录", "", "原始材料副本目录：" + join(workspace, "00_original_backup"), ""]
    for (const item of records) md.push("- " + item.fileName + " -> " + item.classifiedPath + "（" + item.category + "，" + item.reason + "）")
    await writeFile(join(workspace, "02_generated/materials_index.md"), md.join("\n") + "\n", "utf8")
    await appendLog(workspace, "agent", "已完成材料分类，共 " + records.length + " 个文件。")
    await saveTask(workspace, task, "正在生成学生资料", "材料已分类完成，materials_index 已更新。")
    await appendAudit(workspace, "materials", action, "completed", "classified " + records.length + " files")
    return "已分类 " + records.length + " 个文件。无法确认用途的文件会留在 needs_review。"
  },
}

export const state = {
  description: "Update Terra-Edu task_state.json using the unified desktop schema, including status, progress, generated files, and missing item counts.",
  args: inputArg({
    status: { type: "string", enum: statusValues, description: "Current task status" },
    message: { type: "string", description: "Human-readable progress message for the consultant" },
  }, ["status", "message"]),
  async execute(args, ctx) {
    const input = args.input || {}
    const workspace = root(ctx)
    await ensureTaskIsActive(workspace)
    const task = await loadTask(workspace)
    await appendAudit(workspace, "state", String(input.status || "update"), "started", input.message || "")
    const progress = ensureCuaProgress(await readJson(join(workspace, "03_state/application_progress.json"), {}))
    if (input.status === "阶段性完成" && progress.egoBrowser?.preparedAt && !hasVerifiedBrowserSave(progress)) {
      await appendAudit(workspace, "state", String(input.status), "failed", "browser completion without verified save", ctx)
      throw new Error("ego-browser 尚未记录任何验证保存。不得把填表阶段标记为完成；请先保存并复查页面后调用 application-agent_cua record_save_verified，或记录明确阻塞原因。")
    }
    await saveTask(workspace, task, input.status, input.message)
    await appendLog(workspace, "agent", input.message)
    await appendAudit(workspace, "state", String(input.status || "update"), "completed", input.message || "")
    return "状态已更新：" + input.status
  },
}

export const documents = {
  description: "Generate consultant/student-facing forms, Word missing-material checklist, and task summary from 03_state/missing_items.json.",
  args: inputArg({
    action: { type: "string", enum: ["generate_forms", "generate_word", "generate_summary", "generate_all"], description: "Which document set to generate" },
  }),
  async execute(args, ctx) {
    const inputArgs = args.input || {}
    const action = inputArgs.action || "generate_all"
    const workspace = root(ctx)
    await ensureTaskIsActive(workspace)
    await appendAudit(workspace, "documents", action, "started")
    const task = await loadTask(workspace)
    const input = task.input || {}
    const progress = await readJson(join(workspace, "03_state/application_progress.json"), {})
    const syncedMissing = syncMissingItemsWithProgress(normalizeMissingItems(await readJson(join(workspace, "03_state/missing_items.json"), [])), progress)
    const missing = activeMissingItems(syncedMissing)
    await writeJson(join(workspace, "03_state/missing_items.json"), syncedMissing)
    const materials = await readJson(join(workspace, "03_state/materials_index.json"), [])
    const title = String(input.studentName || basename(workspace)).trim()
    if (action === "generate_forms" || action === "generate_all") {
      const infoItems = missing.filter((item: any) => item.type !== "material")
      const materialItems = missing.filter((item: any) => item.type === "material")
      await writeFile(join(workspace, "02_generated/info_collection_form.md"), renderCollection(title, input, "信息补充清单", infoItems), "utf8")
      await writeFile(join(workspace, "02_generated/material_collection_form.md"), renderCollection(title, input, "材料补充清单", materialItems), "utf8")
    }
    if (action === "generate_word" || action === "generate_all") {
      await writeFile(join(workspace, "02_generated/missing_materials.docx"), makeDocx(renderWordChecklist(title, input, missing)))
    }
    if (action === "generate_summary" || action === "generate_all") {
      const lines = ["# " + title + " 申请任务总结", "", "## 已完成", "", "- 已创建隔离申请工作区。", "- 已复制原始材料副本，未修改原始文件夹。", "- 已整理材料 " + materials.length + " 个。", "- 已生成或更新缺失项清单和顾问可转发文档。", "", "## 仍需处理", ""]
      if (missing.length === 0) lines.push("- 暂无仍需补充的缺失项。")
      for (const item of missing) lines.push("- " + item.name + "：" + item.whyNeeded)
      lines.push("", "## 人工处理事项", "", "- 最终提交申请、付款、不可逆推荐信邀请和账号密码输入必须由顾问人工确认。")
      await writeFile(join(workspace, "02_generated/task_summary.md"), lines.join("\n") + "\n", "utf8")
    }
    const materialReview = await readJson(join(workspace, "03_state/material_review.json"), {})
    const needsMaterialReview = !progress.egoBrowser?.preparedAt && materialReview.status !== "approved"
    if (needsMaterialReview) {
      await writeJson(join(workspace, "03_state/material_review.json"), {
        status: "pending",
        requestedAt: new Date().toISOString(),
        summary: "材料、缺失项和顾问文档已生成。等待顾问决定补充文件夹、文字补充或暂不补充。",
      })
    }
    await appendLog(workspace, "agent", "已根据 missing_items.json 生成申请文档。")
    await saveTask(
      workspace,
      task,
      needsMaterialReview ? "等待顾问确认材料" : !progress.egoBrowser?.preparedAt ? "可继续申请" : missing.some((item: any) => item.blocksProgress) ? "等待补充材料" : "阶段性完成",
      needsMaterialReview
        ? "材料整理、缺失项和阶段总结已完成。请在申请 Agent 的材料确认面板决定是否补充，再进入浏览器。"
        : "已生成信息表、材料表、Word 缺失清单和阶段总结。",
    )
    await appendAudit(workspace, "documents", action, "completed", "generated documents from missing_items.json")
    return needsMaterialReview
      ? "文档已生成到 02_generated，任务已停在材料确认关口。请等待顾问在桌面应用选择补充文件夹、填写文字补充或确认暂不补充；不要启动 ego-browser。"
      : "文档已生成到 02_generated。Word 清单基于 03_state/missing_items.json。"
  },
}

/* Direct distribution intentionally omits the legacy runtime fallback. Customer builds bundle the native tools they need instead of asking the model to repair tool failures with ad-hoc shell code. */
const legacyRuntime = {
  description: "Fallback runtime for installed Macs when OpenCode built-in bash/read/glob/webfetch/websearch/skill fail with the same low-level error. Prefer native built-ins first, then use this tool once a built-in class is confirmed broken.",
  args: inputArg({
    action: { type: "string", enum: ["diagnose", "record_builtin_failure", "read_file", "list_files", "run_bash", "fetch_url", "search_web", "load_skill"], description: "Fallback action to execute" },
    toolName: { type: "string", description: "Name of the failed OpenCode built-in tool, for record_builtin_failure" },
    error: { type: "string", description: "Original low-level error from the built-in tool" },
    path: { type: "string", description: "Relative or absolute path for read_file/list_files" },
    pattern: { type: "string", description: "Optional glob-like filter for list_files" },
    command: { type: "string", description: "Shell command for run_bash. Dangerous commands are blocked." },
    workdir: { type: "string", description: "Optional working directory for run_bash" },
    timeout: { type: "number", description: "Optional timeout in milliseconds" },
    url: { type: "string", description: "URL for fetch_url" },
    query: { type: "string", description: "Search query for search_web" },
    name: { type: "string", description: "Skill name for load_skill" },
    maxResults: { type: "number", description: "Maximum web search results or file entries" },
  }, ["action"]),
  async execute(args, ctx) {
    const input = args.input || {}
    const action = String(input.action || "")
    const workspace = root(ctx)
    await appendAudit(workspace, "runtime", action, "started", input.toolName || input.path || input.command || input.url || input.query || input.name || "", ctx)
    try {
      if (action === "diagnose") {
        const skillDir = join(workspace, ".opencode/skills")
        const result = {
          status: "ok",
          workspace,
          exists: existsSync(workspace),
          stateDir: existsSync(join(workspace, "03_state")),
          toolsFile: existsSync(join(workspace, ".opencode/tools/application-agent.ts")),
          skillsDir: existsSync(skillDir),
          egoBrowserWrapper: existsSync(join(workspace, ".opencode/bin/ego-browser")),
          path: process.env.PATH || "",
        }
        await appendAudit(workspace, "runtime", action, "completed", "diagnose ok", ctx)
        return JSON.stringify(result, null, 2)
      }

      if (action === "record_builtin_failure") {
        const progress = ensureCuaProgress(await readJson(join(workspace, "03_state/application_progress.json"), {}))
        appendLimited(progress, "failedActions", {
          at: new Date().toISOString(),
          action: "opencode_builtin_tool_failure",
          toolName: String(input.toolName || "unknown"),
          reason: redactSensitiveText(input.error || "OpenCode built-in tool failed"),
        })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "agent", "OpenCode 内置工具失败，已切换到 application-agent_runtime 兜底：" + String(input.toolName || "unknown"))
        await appendAudit(workspace, "runtime", action, "completed", String(input.toolName || "unknown"), ctx)
        return JSON.stringify({ status: "recorded", fallbackTool: "application-agent_runtime", failedTool: String(input.toolName || "unknown") }, null, 2)
      }

      if (action === "read_file") {
        const file = resolveWorkspacePath(workspace, input.path)
        if (isSensitivePath(file)) throw new Error("Refusing to read sensitive file: " + basename(file))
        const body = await readFile(file, "utf8")
        const result = { status: "completed", path: file, relativePath: relative(workspace, file), content: clipRuntimeText(body, 50000) }
        await appendAudit(workspace, "runtime", action, "completed", relative(workspace, file), ctx)
        return JSON.stringify(result, null, 2)
      }

      if (action === "list_files") {
        const dir = resolveWorkspacePath(workspace, input.path)
        const maxResults = Math.max(1, Math.min(1000, Number(input.maxResults || 300)))
        const files = (await listFiles(dir))
          .filter((file) => matchesRuntimePattern(file, workspace, input.pattern))
          .slice(0, maxResults)
          .map((file) => ({ path: file, relativePath: relative(workspace, file), name: basename(file), extension: extname(file).toLowerCase() }))
        await appendAudit(workspace, "runtime", action, "completed", "files " + files.length, ctx)
        return JSON.stringify({ status: "completed", root: dir, pattern: input.pattern || "", files }, null, 2)
      }

      if (action === "run_bash") {
        const command = String(input.command || "").trim()
        if (!command) throw new Error("command is required")
        const cwd = resolveWorkspacePath(workspace, input.workdir || ".")
        const timeout = Math.max(1000, Math.min(300000, Number(input.timeout || 120000)))
        const output = await runtimeRunShell(command, cwd, timeout)
        await appendAudit(workspace, "runtime", action, output.exitCode === 0 ? "completed" : "failed", "exit " + output.exitCode, ctx)
        return JSON.stringify({
          status: output.exitCode === 0 ? "completed" : "failed",
          exitCode: output.exitCode,
          cwd,
          stdout: clipRuntimeText(output.stdout, 50000),
          stderr: clipRuntimeText(output.stderr, 20000),
        }, null, 2)
      }

      if (action === "fetch_url") {
        const url = String(input.url || "").trim()
        if (!/^https?:\/\//i.test(url)) throw new Error("fetch_url requires an http(s) URL")
        const timeout = Math.max(1000, Math.min(60000, Number(input.timeout || 20000)))
        const fetched = await runtimeFetchText(url, timeout)
        await appendAudit(workspace, "runtime", action, fetched.ok ? "completed" : "failed", url + " status " + fetched.status, ctx)
        return JSON.stringify({
          status: fetched.ok ? "completed" : "failed",
          httpStatus: fetched.status,
          url: fetched.url,
          contentType: fetched.contentType,
          text: clipRuntimeText(stripHtml(fetched.text) || fetched.text, 50000),
        }, null, 2)
      }

      if (action === "search_web") {
        const query = String(input.query || "").trim()
        if (!query) throw new Error("query is required")
        const maxResults = Math.max(1, Math.min(10, Number(input.maxResults || 5)))
        const result = await runtimeSearchWeb(query, maxResults)
        await appendAudit(workspace, "runtime", action, "completed", query, ctx)
        return JSON.stringify({ status: "completed", query, ...result }, null, 2)
      }

      if (action === "load_skill") {
        const result = await runtimeLoadSkill(workspace, String(input.name || ""))
        await appendAudit(workspace, "runtime", action, result.status === "not_found" ? "failed" : "completed", input.name || "", ctx)
        return JSON.stringify(result, null, 2)
      }

      throw new Error("Unsupported runtime action: " + action)
    } catch (error: any) {
      await appendAudit(workspace, "runtime", action, "failed", String(error?.message || error), ctx)
      return JSON.stringify({ status: "failed", action, error: redactSensitiveText(error?.message || error) }, null, 2)
    }
  },
}

export const requirements = {
  description: "Persist official school/program/application-platform requirements gathered by webfetch/websearch. Writes 03_state/application_requirements.json, 02_generated/application_requirements.md, and can sync confirmed missing items into missing_items.json.",
  args: inputArg({
    sources: { type: "array", description: "Official source records with url, title, fetchedAt, confidence, and notes" },
    fieldRequirements: { type: "array", description: "Application field requirements discovered from official sources or platform pages" },
    materialRequirements: { type: "array", description: "Material requirements discovered from official sources or platform pages" },
    uncertainRequirements: { type: "array", description: "Requirements that need consultant confirmation" },
    missingItems: { type: "array", description: "Confirmed missing items to merge into 03_state/missing_items.json" },
    notes: { type: "string", description: "Short consultant-facing research summary" },
  }),
  async execute(args, ctx) {
    const input = args.input || {}
    const workspace = root(ctx)
    await ensureTaskIsActive(workspace)
    await appendAudit(workspace, "requirements", "update", "started", input.notes || "", ctx)
    const task = await loadTask(workspace)
    const existing = await readJson(join(workspace, "03_state/application_requirements.json"), {})
    const requirements = {
      studentName: task.input?.studentName || "",
      school: task.input?.school || "",
      program: task.input?.program || "",
      applicationType: task.input?.applicationType || "",
      applicationUrl: task.input?.applicationUrl || "",
      updatedAt: new Date().toISOString(),
      sources: normalizeRequirementSources([...(existing.sources || []), ...(input.sources || [])]),
      fieldRequirements: Array.from(new Set([...requirementList(existing.fieldRequirements), ...requirementList(input.fieldRequirements)])),
      materialRequirements: Array.from(new Set([...requirementList(existing.materialRequirements), ...requirementList(input.materialRequirements)])),
      uncertainRequirements: Array.from(new Set([...requirementList(existing.uncertainRequirements), ...requirementList(input.uncertainRequirements)])),
      notes: input.notes || existing.notes || "",
    }
    await writeJson(join(workspace, "03_state/application_requirements.json"), requirements)
    await writeFile(join(workspace, "02_generated/application_requirements.md"), renderRequirementsMarkdown(task, requirements), "utf8")

    const progress = await readJson(join(workspace, "03_state/application_progress.json"), { currentPage: "", completedPages: [], savedPages: [], uploadedMaterials: [], failedActions: [], highRiskBlocks: [] })
    const incomingMissing = normalizeMissingItems(input.missingItems || [])
    if (incomingMissing.length > 0) {
      const existingMissing = normalizeMissingItems(await readJson(join(workspace, "03_state/missing_items.json"), []))
      const seen = new Set(existingMissing.map((item: any) => String(item.name).toLowerCase() + ":" + item.type))
      for (const item of incomingMissing) {
        const key = String(item.name).toLowerCase() + ":" + item.type
        if (!seen.has(key)) {
          existingMissing.push({ ...item, source: item.source || "application_target" })
          seen.add(key)
        }
      }
      await writeJson(join(workspace, "03_state/missing_items.json"), syncMissingItemsWithProgress(existingMissing, progress))
    }

    progress.requirementsLastUpdatedAt = requirements.updatedAt
    await writeJson(join(workspace, "03_state/application_progress.json"), progress)
    await saveTask(workspace, task, "正在检查缺失内容", "已保存学校/项目申请要求，并准备对照学生材料检查缺失项。")
    await appendLog(workspace, "agent", "已保存申请要求：" + (requirements.notes || "见 application_requirements.md"))
    await appendAudit(workspace, "requirements", "update", "completed", "sources " + requirements.sources.length, ctx)
    return JSON.stringify({
      status: "completed",
      files: ["03_state/application_requirements.json", "02_generated/application_requirements.md"],
      sources: requirements.sources.length,
      fieldRequirements: requirements.fieldRequirements.length,
      materialRequirements: requirements.materialRequirements.length,
      missingItemsMerged: incomingMissing.length,
    }, null, 2)
  },
}

export const risk = {
  description: "Check and block high-risk application actions: final submission, payment, irreversible recommendation invitation, credential storage, or guessing uncertain fields.",
  args: inputArg({
    action: { type: "string", description: "Action the agent is about to perform" },
    page: { type: "string", description: "Optional page or context" },
  }, ["action"]),
  async execute(args, ctx) {
    const input = args.input || {}
    const workspace = root(ctx)
    const text = String(input.action || "").toLowerCase()
    await appendAudit(workspace, "risk", String(input.action || "check"), "started")
    const blocked = /submit|final|payment|pay|付款|最终提交|提交申请|推荐信邀请|recommendation invite|保存密码|password|猜填|不可逆/.test(text)
    if (!blocked) {
      await appendAudit(workspace, "risk", String(input.action || "check"), "completed", "allowed")
      return "该动作未命中高风险规则，可以继续，但不确定字段仍需先确认。"
    }
    const progress = await readJson(join(workspace, "03_state/application_progress.json"), { currentPage: "", completedPages: [], savedPages: [], uploadedMaterials: [], failedActions: [], highRiskBlocks: [] })
    if (!Array.isArray(progress.highRiskBlocks)) progress.highRiskBlocks = []
    progress.highRiskBlocks.push({ at: new Date().toISOString(), action: input.action, page: input.page || "", reason: "高风险申请动作必须交给顾问人工处理。" })
    await writeJson(join(workspace, "03_state/application_progress.json"), progress)
    await appendLog(workspace, "cua", "已阻断高风险动作：" + input.action)
    const task = await loadTask(workspace)
    await saveTask(workspace, task, "等待补充材料", "已阻断高风险动作：" + input.action + "。该步骤必须由顾问人工处理。")
    await appendAudit(workspace, "risk", String(input.action || "check"), "completed", "blocked")
    return "BLOCKED: " + input.action + "。最终提交、付款、不可逆推荐信邀请、保存密码和猜填均禁止自动执行。"
  },
}

export const native_dialog = {
  description: "Inspect or acknowledge a Chromium native application dialog in the exact Terra-managed Ego Lite process. It reads complete AXCustomContent text without OCR and may acknowledge only the same recently inspected single-button alert; it never navigates, fills a page, refreshes, or controls another app.",
  args: inputArg({
    action: { type: "string", enum: ["inspect", "acknowledge_single_button", "read_latest"], description: "Read the live dialog, safely acknowledge a verified single-button alert, or read the last wrapper-captured dialog event." },
    taskSpaceId: { type: "string", description: "Numeric ego-browser task-space ID already saved for this application." },
    taskSpaceName: { type: "string", description: "Saved Ego task-space/window name." },
    currentUrl: { type: "string", description: "Last observed application URL; its origin anchors the native dialog." },
    pageTitle: { type: "string", description: "Last observed page title for the audit record." },
    dialogFingerprint: { type: "string", description: "Exact fingerprint returned by the immediately preceding inspect action; required for acknowledgement." },
  }, ["action", "taskSpaceId"]),
  async execute(args, ctx) {
    const input = args.input || {}
    const workspace = root(ctx)
    const action = String(input.action || "")
    const progress = ensureCuaProgress(await readJson(join(workspace, "03_state/application_progress.json"), {}))
    const taskSpaceId = String(input.taskSpaceId || "").trim()
    const currentUrl = String(progress.currentUrl || "").trim()
    const pageTitle = String(progress.currentPage || "").trim()
    const taskSpaceName = String(progress.egoBrowser?.taskSpaceName || "").trim()
    const contextOverrideError =
      (input.currentUrl && String(input.currentUrl).trim() !== currentUrl) ||
      (input.pageTitle && String(input.pageTitle).trim() !== pageTitle) ||
      (input.taskSpaceName && String(input.taskSpaceName).trim() !== taskSpaceName)
        ? "BROWSER_AUDIT_MISMATCH: native dialog actions must use the saved task-space name, URL, and page title without caller overrides."
        : ""
    const auditError = requireNumericTaskSpaceId(taskSpaceId) || browserTaskSpaceMismatch(progress, taskSpaceId) || contextOverrideError
    if (auditError) {
      await appendAudit(workspace, "native_dialog", action, "failed", auditError, ctx)
      return auditError
    }
    await appendAudit(workspace, "native_dialog", action, "started", currentUrl + " | " + pageTitle, ctx)

    if (action === "read_latest") {
      const latest = await readJson(join(workspace, "03_state/native_dialog_last.json"), undefined)
      if (!latest) {
        await appendAudit(workspace, "native_dialog", action, "completed", "no captured dialog", ctx)
        return JSON.stringify({ status: "none", detail: "No wrapper-captured native dialog event exists for this workspace." }, null, 2)
      }
      const recordedAt = Date.parse(latest.recordedAt || "")
      const evidenceAge = Date.now() - recordedAt
      const evidenceMatches = latest.schemaVersion === 1 &&
        typeof latest.eventId === "string" &&
        latest.eventId.length > 0 &&
        latest.taskSpaceId === taskSpaceId &&
        latest.taskSpaceName === taskSpaceName &&
        latest.currentUrl === currentUrl &&
        Number.isFinite(recordedAt) &&
        evidenceAge >= 0 &&
        evidenceAge <= 10 * 60_000 &&
        !latest.consumedAt &&
        latest.status !== "none"
      if (!evidenceMatches) {
        const detail = "BROWSER_DIALOG_EVIDENCE_STALE: the saved native-dialog event is missing provenance, belongs to another task/URL, is already consumed, or is older than ten minutes. Inspect the live dialog again; do not reuse this evidence."
        await appendAudit(workspace, "native_dialog", action, "failed", detail, ctx)
        return detail
      }
      progress.pendingNativeDialogEvent = {
        eventId: latest.eventId,
        taskSpaceId,
        currentUrl,
        status: latest.status,
        readAt: new Date().toISOString(),
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendAudit(workspace, "native_dialog", action, "completed", JSON.stringify(latest), ctx)
      return JSON.stringify({
        ...latest,
        nextAction: latest.status === "acknowledged"
          ? "Use the complete dialogText/customContent as evidence, call application-agent_cua record_blocker with blockerDisposition=resolved and nativeDialogEventId=" + latest.eventId + ", end this browser round, then begin a new round with pageInfo()."
          : latest.status === "observed" && latest.candidateCount === 1 && Array.isArray(latest.buttonLabels) && latest.buttonLabels.length === 1 && latest.hasTextField === false && latest.treeTruncated === false && latest.axReadComplete === true && latest.customContentPresent === true && latest.customContentDecoded === true && typeof latest.fingerprint === "string" && latest.fingerprint.length > 0
            ? "Read the complete dialogText/customContent. If it is a genuine acknowledgement alert, call inspect for this same task-space ID and URL, then acknowledge_single_button within 30 seconds with the exact returned dialogFingerprint. Otherwise hand off. Never refresh or retry the browser round."
            : "Preserve the complete dialogText, customContent, and button evidence; call record_blocker with nativeDialogEventId=" + latest.eventId + " and hand off the unclear or unsafe dialog. Do not refresh or retry the browser round.",
      }, null, 2)
    }

    if (!currentUrl || !taskSpaceName) {
      const detail = "BROWSER_AUDIT_REQUIRED: native dialog inspection requires currentUrl and taskSpaceName from the saved Ego task space."
      await appendAudit(workspace, "native_dialog", action, "failed", detail, ctx)
      return detail
    }
    if (action === "acknowledge_single_button") {
      const inspected = await readJson(join(workspace, "03_state/native_dialog_last.json"), undefined)
      const inspectedAt = Date.parse(inspected?.recordedAt || "")
      const inspectionAge = Date.now() - inspectedAt
      const inspectionMatches = inspected?.status === "observed" &&
        inspected?.clicked === false &&
        inspected?.candidateCount === 1 &&
        Array.isArray(inspected?.buttonLabels) &&
        inspected.buttonLabels.length === 1 &&
        inspected?.hasTextField === false &&
        inspected?.treeTruncated === false &&
        inspected?.axReadComplete === true &&
        inspected?.customContentPresent === true &&
        inspected?.customContentDecoded === true &&
        typeof inspected?.fingerprint === "string" &&
        inspected.fingerprint.length > 0 &&
        String(input.dialogFingerprint || "") === inspected.fingerprint &&
        inspected?.taskSpaceId === taskSpaceId &&
        inspected?.taskSpaceName === taskSpaceName &&
        inspected?.currentUrl === currentUrl &&
        Number.isFinite(inspectedAt) &&
        inspectionAge >= 0 &&
        inspectionAge <= 30_000
      if (!inspectionMatches) {
        const detail = "BROWSER_DIALOG_INSPECTION_REQUIRED: first call inspect for this exact task space and URL, read the complete dialog text, then acknowledge within 30 seconds using the exact dialogFingerprint."
        await appendAudit(workspace, "native_dialog", action, "failed", detail, ctx)
        return detail
      }
    }
    const runtimeApp = join(process.env.HOME || "", "Library/Application Support/edu.terra.application-agent/ego-lite-runtime/ego lite.app")
    const guard = join(workspace, ".opencode/bin/terra-dialog-guard")
    if (!existsSync(guard)) {
      const detail = "TERRA_EGO_NATIVE_DIALOG_UNAVAILABLE: generated dialog-guard wrapper is missing. Refresh this application workspace before continuing browser automation."
      await appendAudit(workspace, "native_dialog", action, "failed", detail, ctx)
      return detail
    }
    const processLookup = Bun.spawn(["/usr/bin/pgrep", "-f", runtimeApp + "/Contents/MacOS/ego lite"], { stdout: "pipe", stderr: "pipe" })
    const [processLookupStatus, processLookupOutput] = await Promise.all([processLookup.exited, new Response(processLookup.stdout).text()])
    const processIdentifiers = processLookupOutput.split(/\s+/).map((value) => value.trim()).filter((value) => /^\d+$/.test(value))
    if (processLookupStatus !== 0 || processIdentifiers.length !== 1) {
      const detail = processIdentifiers.length > 1
        ? "TERRA_EGO_NATIVE_DIALOG_TARGET_AMBIGUOUS: multiple Terra-managed Ego Lite main processes are running; no dialog was read or clicked."
        : "TERRA_EGO_NATIVE_DIALOG_TARGET_MISSING: the exact Terra-managed Ego Lite process is not running."
      await appendAudit(workspace, "native_dialog", action, "failed", detail, ctx)
      return detail
    }
    const guardArguments = [
      guard,
      action === "acknowledge_single_button" ? "acknowledge" : "inspect",
      "--bundle-id", "com.citrolabs.ego.lite",
      "--pid", processIdentifiers[0],
      "--executable-path-prefix", runtimeApp,
      "--window-title", taskSpaceName,
      "--expected-url", currentUrl,
    ]
    if (action === "acknowledge_single_button") {
      guardArguments.push("--expected-fingerprint", String(input.dialogFingerprint || ""))
    }
    const child = Bun.spawn(guardArguments, { stdout: "pipe", stderr: "pipe" })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    const result = parseJsonObjectFromText(stdout)
    if (!result) {
      const detail = "TERRA_EGO_NATIVE_DIALOG_FAILED: helper exit " + exitCode + ": " + String(stderr || stdout || "no structured output")
      await appendAudit(workspace, "native_dialog", action, "failed", detail, ctx)
      return detail
    }
    const priorInspection = action === "acknowledge_single_button"
      ? await readJson(join(workspace, "03_state/native_dialog_last.json"), undefined)
      : undefined
    const event = {
      ...result,
      schemaVersion: 1,
      eventId: action === "acknowledge_single_button" && priorInspection?.eventId ? priorInspection.eventId : randomUUID(),
      source: "tool",
      taskSpaceId,
      taskSpaceName,
      currentUrl,
      pageTitle,
      recordedAt: new Date().toISOString(),
    }
    await writeJson(join(workspace, "03_state/native_dialog_last.json"), event)
    if (result.status !== "none") {
      const events = await readJson(join(workspace, "03_state/native_dialog_events.json"), [])
      const list = Array.isArray(events) ? events : []
      list.push(event)
      await writeJson(join(workspace, "03_state/native_dialog_events.json"), list.slice(-120))
      progress.pendingNativeDialogEvent = {
        eventId: event.eventId,
        taskSpaceId,
        currentUrl,
        status: result.status,
        readAt: new Date().toISOString(),
      }
      await appendLog(workspace, "cua", "原生弹窗 " + result.status + "：" + (Array.isArray(result.dialogText) ? result.dialogText.join(" | ") : result.detail || "无文字"))
    } else {
      delete progress.pendingNativeDialogEvent
    }
    await writeJson(join(workspace, "03_state/application_progress.json"), progress)
    await appendAudit(workspace, "native_dialog", action, exitCode === 0 ? "completed" : "failed", JSON.stringify(result), ctx)
    return JSON.stringify({
      ...event,
      taskSpaceId,
      currentUrl,
      pageTitle,
      nextAction: result.status === "acknowledged"
        ? "Call application-agent_cua record_blocker with blockerDisposition=resolved, nativeDialogEventId=" + event.eventId + ", and the full dialogText/customContent as evidence; end this browser round. The next round must begin with pageInfo()."
        : result.status === "observed"
          ? "If this is a fully decoded single-button validation alert, call this tool again with acknowledge_single_button and dialogFingerprint=" + String(result.fingerprint || "") + ". Otherwise call record_blocker with nativeDialogEventId=" + event.eventId + " and hand off. Do not refresh, navigate, or run page JavaScript."
          : result.status === "permission_required"
            ? "Stop browser retries. Terra-Edu needs macOS Accessibility permission before it can preserve and close native dialog text."
            : "Do not refresh or retry. Preserve this result and decide from the complete AX text and button list.",
    }, null, 2)
  },
}

export const cua = {
  description: "Coordinate ego-browser / ego lite application-platform filling. This tool does not directly control Chrome or call cua-driver. Use the official ego-browser skill for browser actions, then call this tool to record task space, observations, verified fields, verified saves, uploads, blockers, failures, and audit state.",
  args: inputArg({
    action: { type: "string", enum: ["prepare_ego_task", "resume_ego", "record_observation", "record_field_verified", "record_select_verified", "record_dynamic_form_verified", "record_save_verified", "record_blocker", "handoff_to_consultant", "complete_ego_task", "record_failure", "record_saved", "record_upload", "block_high_risk"], description: "ego-browser coordination action. Browser control itself must be done through the official ego-browser skill, not this tool." },
    applicationUrl: { type: "string", description: "Application platform URL, defaults to task input." },
    taskSpaceName: { type: "string", description: "ego-browser task space name for this application task." },
    taskSpaceId: { type: "string", description: "String form of the numeric ego-browser task.id returned by useOrCreateTaskSpace." },
    currentUrl: { type: "string", description: "Current URL reported by ego-browser pageInfo." },
    pageTitle: { type: "string", description: "Current page title reported by ego-browser pageInfo or snapshot." },
    fieldLabel: { type: "string", description: "Human-readable field label, such as State, Institution, Current Title." },
    text: { type: "string", description: "Field value, selected option, page summary, or observation text." },
    expectedText: { type: "string", description: "Expected visible value after ego-browser verification." },
    optionLabel: { type: "string", description: "Selected option label for record_select_verified." },
    optionValue: { type: "string", description: "Selected option value for record_select_verified." },
    evidence: { type: "string", description: "Short verification evidence from snapshotText/pageInfo/screenshot/readback." },
    remainingRequiredFields: { type: "array", items: { type: "string" }, description: "Required for record_dynamic_form_verified, including [] when the dynamic-form rescan found no visible empty required fields." },
    confirmed: { type: "boolean", description: "Required true for record_save_verified after ego-browser verified there are no required-field or validation errors." },
    consultantConfirmed: { type: "boolean", description: "Required true after the consultant explicitly chose to resume a handed-off task space, or to resolve an old workspace that has no saved taskSpaceId." },
    blockerDisposition: { type: "string", enum: ["resolved", "handoff"], description: "Required for record_blocker: resolved after a safe dialog response, or handoff after control was given to the consultant." },
    nativeDialogEventId: { type: "string", description: "Stable eventId returned by application-agent_native_dialog; required while a native-dialog event is pending." },
    handoffType: { type: "string", enum: ["login", "browser_takeover"], description: "For handoff_to_consultant: login only for an observed login/authentication need; browser_takeover for dialogs, user takeover, or other manual intervention." },
    detail: { type: "string", description: "Operation detail, failure reason, saved page, upload material, or high-risk action" },
  }, ["action"]),
  async execute(args, ctx) {
    const input = args.input || {}
    const workspace = root(ctx)
    if (![
      "record_observation",
      "record_field_verified",
      "record_select_verified",
      "record_dynamic_form_verified",
      "record_save_verified",
      "record_blocker",
      "handoff_to_consultant",
      "record_failure",
      "record_saved",
      "record_upload",
      "block_high_risk",
    ].includes(input.action)) await ensureTaskIsActive(workspace)
    const task = await loadTask(workspace)
    const progress = await readJson(join(workspace, "03_state/application_progress.json"), { currentPage: "", completedPages: [], savedPages: [], uploadedMaterials: [], failedActions: [], highRiskBlocks: [] })
    const auditAction = String(input.action || "unknown")
    await appendAudit(workspace, "cua", auditAction, "started", input.detail || "")
    if (input.action === "block_high_risk") {
      return await risk.execute({ input: { action: input.detail || "high risk application action", page: progress.currentPage || "" } }, ctx as any)
    }
    if (input.action === "resume_ego") {
      ensureCuaProgress(progress)
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const savedTaskSpaceId = numericTaskSpaceId(progress.egoBrowser?.taskSpaceId)
      const auditError =
        browserAuditError(auditAction, { taskSpaceId }) ||
        requireNumericTaskSpaceId(taskSpaceId) ||
        browserTaskSpaceMismatch(progress, taskSpaceId) ||
        (!savedTaskSpaceId ? "BROWSER_TASK_SPACE_REQUIRED: no saved taskSpaceId is available to resume." : "") ||
        (!hasPendingBrowserHandoff(progress) ? "BROWSER_HANDOFF_REQUIRED: only a recorded consultant handoff can be resumed with takeOverTaskSpace." : "") ||
        (input.consultantConfirmed === true ? "" : "CONSULTANT_CONFIRMATION_REQUIRED: resume only after the consultant explicitly continues the handed-off browser task space.")
      if (auditError) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: auditAction, reason: auditError, page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "拒绝恢复 ego-browser：" + auditError)
        await appendAudit(workspace, "cua", auditAction, "failed", auditError)
        return auditError
      }
      progress.browserBackend = "ego-browser"
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceId: savedTaskSpaceId,
        handoffPending: false,
        resumedAt: new Date().toISOString(),
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "已恢复 ego-browser 填表上下文：" + savedTaskSpaceId)
      await saveTask(workspace, task, "正在填写申请平台", "ego-browser task space 已恢复，Agent 可继续通过官方 skill 填写。")
      await appendAudit(workspace, "cua", auditAction, "completed", "resumed ego-browser task space")
      return "ego-browser 填表上下文已恢复。下一轮 Bash heredoc 必须使用 takeOverTaskSpace(" + JSON.stringify(savedTaskSpaceId) + ")，先 pageInfo() 观察；不得改用 useOrCreateTaskSpace 抢回顾问已交接的 Space。"
    }
    if (input.action === "prepare_ego_task") {
      const materialReview = await readJson(join(workspace, "03_state/material_review.json"), {})
      if (materialReview.status === "pending") {
        await appendAudit(workspace, "cua", auditAction, "failed", "material review has not been approved", ctx)
        throw new Error("材料整理已完成，但顾问尚未在材料确认面板完成选择。请停止，不要启动 ego-browser；等待 material_review.json 的 status 变为 approved。")
      }
      ensureCuaProgress(progress)
      const url = String(input.applicationUrl || task.input?.applicationUrl || "").trim()
      if (!url) throw new Error("applicationUrl is required for prepare_ego_task")
      const taskSpaceName = String(input.taskSpaceName || progress.egoBrowser?.taskSpaceName || ["Terra-Edu", task.input?.studentName, task.input?.school, task.input?.program].filter(Boolean).join(" / ")).trim()
      const savedTaskSpaceId = numericTaskSpaceId(progress.egoBrowser?.taskSpaceId)
      const suppliedTaskSpaceId = String(input.taskSpaceId || "").trim()
      const taskSpaceError =
        (suppliedTaskSpaceId && requireNumericTaskSpaceId(suppliedTaskSpaceId)) ||
        (savedTaskSpaceId && suppliedTaskSpaceId && savedTaskSpaceId !== suppliedTaskSpaceId
          ? "BROWSER_TASK_SPACE_MISMATCH: prepare_ego_task cannot replace the saved ego-browser task space."
          : "")
      if (taskSpaceError) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: auditAction, reason: taskSpaceError, page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "拒绝覆盖 ego-browser task space：" + taskSpaceError)
        await appendAudit(workspace, "cua", auditAction, "failed", taskSpaceError)
        return taskSpaceError
      }
      if (hasPendingBrowserHandoff(progress)) {
        await saveTask(workspace, task, "等待顾问接管浏览器", "当前 ego-browser task space 已交给顾问。不得重新准备、创建或认领空间；请等待顾问明确点击继续任务。")
        await appendAudit(workspace, "cua", auditAction, "failed", "browser handoff is still pending")
        return "BROWSER_HANDOFF_PENDING: 当前 task space 已交给顾问。不要调用 useOrCreateTaskSpace、openOrReuseTab 或 takeOverTaskSpace；顾问明确继续后，带保存的 taskSpaceId 调用 resume_ego（consultantConfirmed:true）。"
      }
      const legacyWorkspace = requiresLegacyTaskSpaceConfirmation(progress)
      if (legacyWorkspace && input.consultantConfirmed !== true) {
        progress.browserBackend = "ego-browser"
        progress.egoBrowser = {
          ...(progress.egoBrowser || {}),
          taskSpaceName,
          applicationUrl: url,
          backend: "ego-browser",
          legacyTaskSpaceConfirmationRequiredAt: new Date().toISOString(),
        }
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "旧工作区缺少 taskSpaceId，已停止自动创建/接管，等待顾问确认现有 ego-browser Space。")
        await saveTask(workspace, task, "等待顾问接管浏览器", "旧工作区没有保存 ego-browser taskSpaceId。请先列出现有空间并让顾问确认复用哪一个，或明确确认新建空间。")
        await appendAudit(workspace, "cua", auditAction, "completed", "legacy workspace requires task-space confirmation")
        return [
          "旧工作区没有可信 taskSpaceId。此时绝对不要调用 useOrCreateTaskSpace、takeOverTaskSpace 或按名称猜测空间。",
          "先运行一个只列空间、不操作页面的 heredoc：",
          "PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs <<'EOF'",
          "cliLog(JSON.stringify(await listTaskSpaces(), null, 2))",
          "EOF",
          "然后用 OpenCode question 工具向顾问展示每个空间的数值 id、名称和 ownership，并提供“复用指定空间”与“新建独立申请空间”选项。顾问明确选择后才可再次调用 prepare_ego_task：选择现有空间时传 consultantConfirmed:true 和该数值 taskSpaceId；选择新建时只传 consultantConfirmed:true。",
        ].join("\\n")
      }
      const selectedLegacyTaskSpaceId = legacyWorkspace && input.consultantConfirmed === true ? suppliedTaskSpaceId : ""
      const selectedFreshTaskSpaceId = !legacyWorkspace && !savedTaskSpaceId && progress.egoBrowser?.awaitingFreshTaskSpaceId === true
        ? suppliedTaskSpaceId
        : ""
      progress.browserBackend = "ego-browser"
      progress.currentPage = progress.currentPage || "申请平台准备中"
      progress.currentUrl = url
      progress.platformLastOpenedAt = new Date().toISOString()
      progress.platformLastOpenedUrl = url
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceName,
        taskSpaceId: savedTaskSpaceId || selectedLegacyTaskSpaceId || selectedFreshTaskSpaceId,
        applicationUrl: url,
        backend: "ego-browser",
        preparedAt: new Date().toISOString(),
        awaitingFreshTaskSpaceId: !savedTaskSpaceId && !selectedLegacyTaskSpaceId && !selectedFreshTaskSpaceId,
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "已准备 ego-browser 填表任务：" + taskSpaceName + " -> " + url)
      await saveTask(workspace, task, "正在填写申请平台", "已切换到 ego-browser / ego lite 后端，准备在独立 Space 中打开申请平台。")
      await appendAudit(workspace, "cua", auditAction, "completed", "prepared ego-browser task")
      if (savedTaskSpaceId || selectedFreshTaskSpaceId) {
        const activeTaskSpaceId = savedTaskSpaceId || selectedFreshTaskSpaceId
        return [
          selectedFreshTaskSpaceId
            ? "已保存刚创建的数值 ego-browser taskSpaceId。现在由带原生弹窗守卫的新回合打开申请网址。"
            : "已找到保存的数值 ego-browser taskSpaceId。正常回合只可复用这个 ID，不得按名称新建或匹配空间。",
          "PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs <<'EOF'",
          "const taskSpaceId = " + JSON.stringify(activeTaskSpaceId),
          "const spaces = await listTaskSpaces()",
          "const space = spaces.find((item) => String(item.id ?? item.taskId) === taskSpaceId)",
          "if (!space || space.ownership !== 'agent') {",
          "  cliLog(JSON.stringify({ taskSpaceId, control: space?.ownership || 'missing' }, null, 2))",
          "} else {",
          "  const task = await useOrCreateTaskSpace(taskSpaceId)",
          "  const beforeNavigation = await pageInfo()",
          ...(selectedFreshTaskSpaceId
            ? [
                "  if (!(beforeNavigation && typeof beforeNavigation === 'object' && 'dialog' in beforeNavigation)) await openOrReuseTab(" + JSON.stringify(url) + ", { wait: true, timeout: 30 })",
                "  const info = await pageInfo()",
              ]
            : ["  const info = beforeNavigation"]),
          "  const snapshot = info && typeof info === 'object' && 'dialog' in info ? undefined : await snapshotText()",
          "  cliLog(JSON.stringify({ taskSpaceId: task.id, info, snapshot }, null, 2))",
          "}",
          "EOF",
          "若空间不是 agent ownership、显示 inactive，或命令报告 user is controlling，立即停止浏览器命令，并以保存的 taskSpaceId、当前 URL、标题和 listTaskSpaces/错误证据调用 handoff_to_consultant（handoffType: browser_takeover）。",
        ].join("\\n")
      }
      if (selectedLegacyTaskSpaceId) {
        return [
          "顾问已明确选择旧空间。此回合只恢复控制并观察；不得导航、填写或保存。",
          "PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs <<'EOF'",
          "const task = await takeOverTaskSpace(" + JSON.stringify(selectedLegacyTaskSpaceId) + ")",
          "const info = await pageInfo()",
          "const snapshot = info && typeof info === 'object' && 'dialog' in info ? undefined : await snapshotText()",
          "cliLog(JSON.stringify({ taskSpaceId: task.id, info, snapshot }, null, 2))",
          "EOF",
          "只在无 dialog 的观察完成后，带真实 taskSpaceId、URL、标题和证据调用 record_observation。",
        ].join("\\n")
      }
      return [
        "ego-browser 填表任务已准备。下一步必须使用官方 ego-browser skill，不要调用 cua-driver。",
        "",
        "首轮只创建隔离 task space 并返回数值 ID；不得在同一回合打开学校网址。拿到 ID 后立刻再次调用 prepare_ego_task 并传 taskSpaceId，下一回合才会在原生弹窗守卫下导航。",
        "PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs <<'EOF'",
        "const task = await useOrCreateTaskSpace(" + JSON.stringify(taskSpaceName) + ")",
        "const initialInfo = await pageInfo()",
        "cliLog(JSON.stringify({ taskSpaceId: task.id, info: initialInfo }, null, 2))",
        "EOF",
        "",
        "不要把这个空白 task space 记作学校页面观察。用返回的数值 taskSpaceId 再次调用 application-agent_cua prepare_ego_task；不要按名称恢复或自行在本轮导航。",
      ].join("\n")
    }
    if (input.action === "record_observation") {
      ensureCuaProgress(progress)
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const currentUrl = String(input.currentUrl || "").trim()
      const pageTitle = String(input.pageTitle || "").trim()
      const evidence = String(input.evidence || input.text || "").trim()
      const auditError =
        browserAuditError(auditAction, { taskSpaceId, currentUrl, pageTitle, evidence }) ||
        requireNumericTaskSpaceId(taskSpaceId) ||
        browserTaskSpaceMismatch(progress, taskSpaceId)
      if (auditError) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: auditAction, reason: auditError, page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "拒绝记录无证据的 ego-browser 观察：" + auditError)
        await appendAudit(workspace, "cua", auditAction, "failed", auditError)
        return auditError
      }
      progress.browserBackend = "ego-browser"
      progress.currentPage = pageTitle
      progress.currentUrl = currentUrl
      progress.lastObservedAt = new Date().toISOString()
      progress.lastBrowserObservation = {
        at: progress.lastObservedAt,
        taskSpaceId,
        currentUrl,
        pageTitle,
        evidence,
      }
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceId,
        taskSpaceName: input.taskSpaceName || progress.egoBrowser?.taskSpaceName || "",
        lastSnapshotSummary: evidence,
        lastObservedAt: progress.lastObservedAt,
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "ego-browser 页面观察已记录：" + (progress.currentPage || "申请平台页面"))
      await saveTask(workspace, task, "正在填写申请平台", "已通过 ego-browser snapshot/pageInfo 观察当前页面，准备继续小步填写。")
      await appendAudit(workspace, "cua", auditAction, "completed", "recorded ego-browser observation")
      return "ego-browser 页面观察已记录。基于这次观察完成一个逻辑动作组后必须再次 pageInfo()；无 dialog 时再 snapshotText 或截图验证并结束本回合。"
    }
    if (input.action === "record_field_verified" || input.action === "record_select_verified") {
      ensureCuaProgress(progress)
      const kind = input.action === "record_select_verified" ? "select" : "field"
      const label = String(input.fieldLabel || input.detail || (kind === "select" ? "下拉字段" : "普通字段"))
      const value = String(input.optionLabel || input.optionValue || input.text || input.expectedText || "")
      progress.dynamicFormChecks = []
      appendLimited(progress, "filledFields", { at: new Date().toISOString(), kind, label, value, backend: "ego-browser", taskSpaceId: input.taskSpaceId || progress.egoBrowser?.taskSpaceId || "" })
      appendLimited(progress, "verifiedFields", { at: new Date().toISOString(), kind, label, value, expected: input.expectedText || value, evidence: input.evidence || "", backend: "ego-browser" })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "ego-browser 已填写并复查：" + label + " -> " + value)
      await saveTask(workspace, task, "正在填写申请平台", "已填写并复查字段：" + label)
      await appendAudit(workspace, "cua", auditAction, "completed", label + " verified via ego-browser")
      return (kind === "select" ? "选项" : "字段") + "已记录为 ego-browser 验证完成。任何后续动作都必须依据新的页面观察决定。"
    }
    if (input.action === "record_dynamic_form_verified") {
      ensureCuaProgress(progress)
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const currentUrl = String(input.currentUrl || "").trim()
      const pageTitle = String(input.pageTitle || "").trim()
      const evidence = String(input.evidence || input.text || "").trim()
      const auditError =
        browserAuditError(auditAction, { taskSpaceId, currentUrl, pageTitle, evidence }) ||
        requireNumericTaskSpaceId(taskSpaceId) ||
        browserTaskSpaceMismatch(progress, taskSpaceId) ||
        (progress.lastBrowserObservation?.taskSpaceId !== taskSpaceId ||
        progress.lastBrowserObservation?.currentUrl !== currentUrl ||
        progress.lastBrowserObservation?.pageTitle !== pageTitle ||
        !Date.parse(progress.lastBrowserObservation?.at || "")
          ? "DYNAMIC_FORM_OBSERVATION_REQUIRED: record a fresh matching page observation before dynamic form verification."
          : "")
      if (auditError) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: auditAction, reason: auditError, page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "拒绝记录无当前观察的动态表单复查：" + auditError)
        await appendAudit(workspace, "cua", auditAction, "failed", auditError)
        return auditError
      }
      if (!Array.isArray(input.remainingRequiredFields)) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: auditAction, reason: "missing dynamic form required-field scan", page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendAudit(workspace, "cua", auditAction, "failed", "missing dynamic form required-field scan")
        return "DYNAMIC_FORM_SCAN_REQUIRED: 必须提供 remainingRequiredFields（无空必填项时也传 []），证明已在最新选择或填写后完成页面复查。"
      }
      const remaining = input.remainingRequiredFields.map((field: unknown) => String(field).trim()).filter(Boolean)
      if (remaining.length > 0) {
        progress.requiredEmptyFields = remaining
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: auditAction, reason: "visible required fields remain", fields: remaining, page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "动态表单复查发现未填写必填项：" + remaining.join("、"))
        await appendAudit(workspace, "cua", auditAction, "failed", "remaining required fields: " + remaining.join(", "))
        return "DYNAMIC_FORM_INCOMPLETE: 当前仍有可见必填项：" + remaining.join("、") + "。不得保存；请在新的无 dialog 观察中补齐并重新验证页面。"
      }
      progress.requiredEmptyFields = []
      appendLimited(progress, "dynamicFormChecks", {
        at: new Date().toISOString(),
        taskSpaceId,
        page: pageTitle,
        url: currentUrl,
        evidence,
        observedAt: progress.lastObservedAt,
        backend: "ego-browser",
      })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "已完成动态表单复查：当前无新增空必填项。")
      await appendAudit(workspace, "cua", auditAction, "completed", "dynamic form verified")
      return "动态表单已复查通过。现在可以执行保存前最终检查；任何后续页面动作都会使本次复查失效。"
    }
    if (input.action === "record_blocker") {
      ensureCuaProgress(progress)
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const currentUrl = String(input.currentUrl || progress.currentUrl || "").trim()
      const pageTitle = String(input.pageTitle || progress.currentPage || "").trim()
      const evidence = String(input.evidence || input.text || "").trim()
      const disposition = input.blockerDisposition === "resolved" || input.blockerDisposition === "handoff" ? input.blockerDisposition : ""
      const nativeDialogEventId = String(input.nativeDialogEventId || "").trim()
      const pendingNativeDialog = progress.pendingNativeDialogEvent
      const nativeDialog = pendingNativeDialog || nativeDialogEventId
        ? await readJson(join(workspace, "03_state/native_dialog_last.json"), undefined)
        : undefined
      const nativeDialogError = pendingNativeDialog || nativeDialogEventId
        ? !pendingNativeDialog ||
          !nativeDialogEventId ||
          nativeDialogEventId !== pendingNativeDialog.eventId ||
          nativeDialog?.eventId !== nativeDialogEventId ||
          nativeDialog?.taskSpaceId !== taskSpaceId ||
          nativeDialog?.currentUrl !== currentUrl ||
          nativeDialog?.consumedAt ||
          (disposition === "resolved" && nativeDialog?.status !== "acknowledged")
          ? "BROWSER_DIALOG_EVENT_REQUIRED: record this blocker with the unconsumed nativeDialogEventId returned by native_dialog; resolved requires an acknowledged event."
          : ""
        : ""
      const auditError =
        browserAuditError(auditAction, { taskSpaceId, currentUrl, pageTitle, evidence, blockerDisposition: disposition }) ||
        requireNumericTaskSpaceId(taskSpaceId) ||
        browserTaskSpaceMismatch(progress, taskSpaceId) ||
        nativeDialogError
      if (auditError) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: auditAction, reason: auditError, page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "拒绝记录无证据的浏览器阻塞：" + auditError)
        await appendAudit(workspace, "cua", auditAction, "failed", auditError)
        return auditError
      }
      appendLimited(progress, "blockedDialogs", {
        at: new Date().toISOString(),
        disposition,
        taskSpaceId,
        currentUrl,
        pageTitle,
        detail: input.detail || input.text || "ego-browser blocker",
        evidence,
        nativeDialogEventId,
        backend: "ego-browser",
      })
      progress.currentUrl = currentUrl
      progress.currentPage = pageTitle
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceId,
        lastBlockerUrl: currentUrl,
        lastBlockerTitle: pageTitle,
        lastBlockerEvidence: evidence,
        handoffPending: disposition === "handoff",
        ...(disposition === "handoff"
          ? {
              handoffAt: new Date().toISOString(),
              handoffReason: input.detail || input.text || "浏览器阻塞需要顾问处理。",
              handoffType: "browser_takeover",
            }
          : {}),
      }
      // A dialog response or handoff can reveal new required fields or leave
      // the page in a different state. Never let pre-dialog observations or
      // dynamic-form checks satisfy a later save gate.
      delete progress.lastBrowserObservation
      progress.lastObservedAt = ""
      progress.dynamicFormChecks = []
      if (nativeDialogEventId && nativeDialog) {
        await writeJson(join(workspace, "03_state/native_dialog_last.json"), {
          ...nativeDialog,
          consumedAt: new Date().toISOString(),
          consumedDisposition: disposition,
        })
        delete progress.pendingNativeDialogEvent
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      if (disposition === "resolved") {
        await appendLog(workspace, "cua", "ego-browser 已安全处理阻塞：" + (input.detail || "未命名浏览器阻塞"))
        await saveTask(workspace, task, "正在填写申请平台", "浏览器阻塞已安全处理。下一轮必须重新观察页面后再继续。")
        await appendAudit(workspace, "cua", auditAction, "completed", input.detail || "resolved ego-browser blocker")
        return "已记录已解决的浏览器阻塞。请结束当前 heredoc；下一轮从 pageInfo() 开始重新观察。"
      }
      await appendLog(workspace, "cua", "ego-browser 阻塞已交给顾问：" + (input.detail || "需要人工处理。"))
      await saveTask(workspace, task, "等待顾问接管浏览器", input.detail || "请顾问在 ego lite 中处理当前浏览器阻塞，然后明确回复继续。")
      await appendAudit(workspace, "cua", auditAction, "completed", input.detail || "handoff required for ego-browser blocker")
      return "浏览器阻塞已记录为顾问接管。不要再运行浏览器命令；顾问明确继续后，先以保存的 taskSpaceId 调用 resume_ego，再在新 heredoc 中 takeOverTaskSpace。"
    }
    if (input.action === "handoff_to_consultant") {
      ensureCuaProgress(progress)
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const currentUrl = String(input.currentUrl || progress.currentUrl || "").trim()
      const pageTitle = String(input.pageTitle || progress.currentPage || "").trim()
      const evidence = String(input.evidence || input.text || "").trim()
      const auditError =
        browserAuditError(auditAction, { taskSpaceId, currentUrl, pageTitle, evidence }) ||
        requireNumericTaskSpaceId(taskSpaceId) ||
        browserTaskSpaceMismatch(progress, taskSpaceId)
      if (auditError) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: auditAction, reason: auditError, page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "拒绝记录无证据的顾问交接：" + auditError)
        await appendAudit(workspace, "cua", auditAction, "failed", auditError)
        return auditError
      }
      const handoffType = input.handoffType === "login" ? "login" : "browser_takeover"
      progress.currentUrl = currentUrl
      progress.currentPage = pageTitle
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceId,
        handoffAt: new Date().toISOString(),
        handoffPending: true,
        handoffReason: input.detail || "需要顾问接管 ego-browser Space。",
        handoffType,
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "已交接 ego-browser task space 给顾问：" + (input.detail || "需要人工登录/验证。"))
      await saveTask(
        workspace,
        task,
        handoffType === "login" ? "等待顾问登录" : "等待顾问接管浏览器",
        input.detail || (handoffType === "login" ? "请顾问在 ego lite Space 中完成登录后回复继续。" : "请顾问在 ego lite Space 中处理当前浏览器状态后回复继续。"),
      )
      await appendAudit(workspace, "cua", auditAction, "completed", "handoff to consultant")
      return "已记录顾问接管。确认 ego-browser 脚本中的 handOffTaskSpace(task.id) 已返回 done:true；顾问明确继续后，使用保存的 taskSpaceId 调用 resume_ego（consultantConfirmed:true），再用 takeOverTaskSpace 恢复。"
    }
    if (input.action === "record_save_verified") {
      ensureCuaProgress(progress)
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const currentUrl = String(input.currentUrl || "").trim()
      const pageTitle = String(input.pageTitle || "").trim()
      const evidence = String(input.evidence || input.text || "").trim()
      const auditError =
        browserAuditError(auditAction, { taskSpaceId, currentUrl, pageTitle, evidence }) ||
        requireNumericTaskSpaceId(taskSpaceId) ||
        browserTaskSpaceMismatch(progress, taskSpaceId)
      if (auditError) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: auditAction, reason: auditError, page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "拒绝记录无证据的页面保存：" + auditError)
        await appendAudit(workspace, "cua", auditAction, "failed", auditError)
        return auditError
      }
      if (!input.confirmed) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: "record_save_verified", reason: "missing confirmed:true", page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "收到未确认保存记录，未写入 savedPages：" + (input.detail || progress.currentPage || "申请页面"))
        await saveTask(workspace, task, "正在保存申请进度", "保存记录需要 ego-browser 保存前检查和保存后复查，未确认前不算成功。")
        await appendAudit(workspace, "cua", auditAction, "failed", "unverified save record")
        return "UNVERIFIED_SAVE_RECORDED: 必须在 ego-browser 脚本里完成保存前 required/validation 检查、点击 SAVE、保存后 snapshot/pageInfo 复查，并以 confirmed:true 调用 record_save_verified。"
      }
      const saveUrl = currentUrl
      const dynamicCheck = progress.dynamicFormChecks.findLast((check: { taskSpaceId?: string; url?: string; page?: string }) =>
        check.taskSpaceId === taskSpaceId && check.url === saveUrl && check.page === pageTitle,
      )
      if (!dynamicCheck) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: "record_save_verified", reason: "missing dynamic form verification", page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "拒绝记录保存：本页没有最新的动态表单复查。")
        await appendAudit(workspace, "cua", auditAction, "failed", "missing dynamic form verification")
        return "UNVERIFIED_DYNAMIC_FORM: 任何选择或填写后都必须重新 snapshotText/pageInfo，并以 remainingRequiredFields:[] 调用 record_dynamic_form_verified；完成后才能记录保存。"
      }
      const postSaveObservedAt = Date.parse(progress.lastBrowserObservation?.at || "")
      const dynamicCheckedAt = Date.parse(dynamicCheck.at || "")
      if (
        !Number.isFinite(postSaveObservedAt) ||
        !Number.isFinite(dynamicCheckedAt) ||
        postSaveObservedAt <= dynamicCheckedAt ||
        progress.lastBrowserObservation?.taskSpaceId !== taskSpaceId ||
        progress.lastBrowserObservation?.currentUrl !== saveUrl ||
        progress.lastBrowserObservation?.pageTitle !== pageTitle
      ) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: "record_save_verified", reason: "missing post-save observation", page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "拒绝记录保存：动态表单复查后没有新的页面观察证据。")
        await appendAudit(workspace, "cua", auditAction, "failed", "missing post-save observation")
        return "UNVERIFIED_POST_SAVE_OBSERVATION: 保存后必须再次调用 record_observation，提供新的 pageInfo/snapshot 或截图证据；该观察必须晚于本页动态表单复查。"
      }
      const pageName = String(input.detail || pageTitle || progress.currentPage || "申请页面")
      progress.currentPage = pageTitle
      progress.currentUrl = saveUrl
      if (!Array.isArray(progress.savedPages)) progress.savedPages = []
      progress.savedPages.push({ at: new Date().toISOString(), page: pageName, url: saveUrl, backend: "ego-browser", taskSpaceId, evidence, dynamicFormEvidence: dynamicCheck.evidence || "" })
      progress.dynamicFormChecks = []
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      const syncedMissing = syncMissingItemsWithProgress(normalizeMissingItems(await readJson(join(workspace, "03_state/missing_items.json"), [])), progress)
      const activeMissing = activeMissingItems(syncedMissing)
      await writeJson(join(workspace, "03_state/missing_items.json"), syncedMissing)
      const inputForDocs = task.input || {}
      const title = String(inputForDocs.studentName || basename(workspace)).trim()
      const materials = await readJson(join(workspace, "03_state/materials_index.json"), [])
      await writeFile(join(workspace, "02_generated/info_collection_form.md"), renderCollection(title, inputForDocs, "信息补充清单", activeMissing.filter((item: any) => item.type !== "material")), "utf8")
      await writeFile(join(workspace, "02_generated/material_collection_form.md"), renderCollection(title, inputForDocs, "材料补充清单", activeMissing.filter((item: any) => item.type === "material")), "utf8")
      await writeFile(join(workspace, "02_generated/missing_materials.docx"), makeDocx(renderWordChecklist(title, inputForDocs, activeMissing)))
      const summaryLines = ["# " + title + " 申请任务总结", "", "## 已完成", "", "- 已通过 ego-browser 保存并复查当前页面：" + pageName, "- 已同步缺失项和顾问文档。", "- 已整理材料 " + materials.length + " 个。", "", "## 仍需处理", ""]
      if (activeMissing.length === 0) summaryLines.push("- 暂无仍需补充的缺失项。")
      for (const item of activeMissing) summaryLines.push("- " + item.name + "：" + item.whyNeeded)
      summaryLines.push("", "## 人工处理事项", "", "- 最终提交申请、付款、不可逆推荐信邀请和账号密码输入必须由顾问人工确认。")
      await writeFile(join(workspace, "02_generated/task_summary.md"), summaryLines.join("\n") + "\n", "utf8")
      await appendLog(workspace, "cua", "ego-browser 已验证保存页面：" + pageName)
      await saveTask(workspace, task, "正在保存申请进度", "已通过 ego-browser 保存并复查当前页面：" + pageName + "；缺失项和顾问文档已同步。")
      await appendAudit(workspace, "cua", auditAction, "completed", "verified save via ego-browser")
      return "页面已记录为 ego-browser 验证保存，缺失项和顾问文档已同步。继续下一页前请再次 snapshotText/pageInfo。"
    }
    if (input.action === "complete_ego_task") {
      ensureCuaProgress(progress)
      if (!hasVerifiedBrowserSave(progress)) {
        await appendAudit(workspace, "cua", auditAction, "failed", "completion without verified save", ctx)
        return "UNVERIFIED_BROWSER_COMPLETION: 当前没有 record_save_verified 证据，不能完成填表阶段。请保存并复查页面，或用 record_blocker 记录无法继续的具体原因。"
      }
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceId: input.taskSpaceId || progress.egoBrowser?.taskSpaceId || "",
        completedAt: new Date().toISOString(),
        completionDetail: input.detail || "",
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "ego-browser task space 完成：" + (input.detail || "本轮填表阶段完成。"))
      await saveTask(workspace, task, "阶段性完成", input.detail || "本轮 ego-browser 填表阶段已完成。")
      await appendAudit(workspace, "cua", auditAction, "completed", "completed ego-browser task")
      return "ego-browser 阶段完成状态已记录。只有整个浏览器任务确实结束时，才在独立最终 heredoc 调用 completeTaskSpace；不得在单个页面完成后调用。"
    }
    if (input.action === "record_saved") {
      ensureCuaProgress(progress)
      appendLimited(progress, "unverifiedSaveRequests", { at: new Date().toISOString(), detail: input.detail || progress.currentPage || "申请页面", page: progress.currentPage || "" })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "收到未验证保存记录请求，未写入 savedPages：" + (input.detail || "申请页面"))
      await saveTask(workspace, task, "正在保存申请进度", "保存请求已记录，但必须通过 ego-browser 保存前检查和保存后复查，再调用 record_save_verified 才算保存成功。")
      await appendAudit(workspace, "cua", auditAction, "completed", input.detail || "unverified save request")
      return "UNVERIFIED_SAVE_RECORDED: record_saved 不再把页面计为保存成功。请先用 ego-browser 完成保存前检查、点击保存、保存后复查，再以 confirmed:true 调用 record_save_verified 写入 savedPages。"
    }
    if (input.action === "record_upload") {
      if (!Array.isArray(progress.uploadedMaterials)) progress.uploadedMaterials = []
      progress.dynamicFormChecks = []
      progress.uploadedMaterials.push(input.detail || "未命名材料")
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "已记录材料上传：" + (input.detail || "未命名材料"))
      await saveTask(workspace, task, "正在上传材料", "已记录可确认材料上传结果。")
      await appendAudit(workspace, "cua", auditAction, "completed", input.detail || "uploaded material")
      return "材料上传记录已更新。上传会改变页面可见内容，旧的动态表单复查已失效；保存前必须重新观察并验证。"
    }
    if (!Array.isArray(progress.failedActions)) progress.failedActions = []
    const detail = input.detail || "未提供原因"
    const browserServiceBlocked = /TERRA_EGO_BROWSER_(?:VERSION_CONFLICT|EXTERNAL_SERVICE_ACTIVE|SERVICE_UNAVAILABLE)/.test(detail)
    progress.failedActions.push({ at: new Date().toISOString(), action: input.action, reason: detail, page: progress.currentPage || "" })
    await writeJson(join(workspace, "03_state/application_progress.json"), progress)
    await appendLog(workspace, "cua", "已记录 CUA 失败：" + detail)
    if (browserServiceBlocked) {
      const externalService = /TERRA_EGO_BROWSER_(?:VERSION_CONFLICT|EXTERNAL_SERVICE_ACTIVE)/.test(detail)
      const message = externalService
        ? "检测到另一 Ego Lite 浏览器服务。为保护其登录态和页面，Terra-Edu 没有接管、查询或关闭它；请顾问关闭另一 Ego Lite 后明确点击“继续任务”。"
        : "随包 Ego Lite 服务不可用，当前浏览器回合结果不确定；不得重试或刷新，请顾问检查当前页面后明确点击“继续任务”。"
      await saveTask(workspace, task, "等待顾问接管浏览器", message)
      await appendAudit(workspace, "cua", auditAction, "failed", detail)
      return "BROWSER_SERVICE_BLOCKED: " + message
    }
    await saveTask(workspace, task, "异常中断", "CUA 操作遇到问题，已记录失败原因。")
    await appendAudit(workspace, "cua", auditAction, "failed", detail)
    return "CUA 失败原因已记录。"
  },
}


function renderCollection(studentName: string, input: any, title: string, items: any[]) {
  const lines = ["# " + studentName + " " + title, "", "申请学校：" + (input.school || ""), "申请项目：" + (input.program || ""), "", "以下只列出缺失、无法判断或需要确认的内容。", ""]
  if (items.length === 0) lines.push("当前没有需要补充的内容。")
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    lines.push("## " + (index + 1) + ". " + item.name, "", "- 为什么需要：" + item.whyNeeded, "- 去哪里准备：" + item.prepareFrom, "- 格式要求：" + item.formatRequirement, "- 是否影响继续申请：" + (item.blocksProgress ? "是" : "否"), "")
  }
  return lines.join("\n") + "\n"
}

function renderWordChecklist(studentName: string, input: any, items: any[]) {
  const lines = [
    studentName + " 补充材料清单",
    "",
    "申请学校：" + (input.school || ""),
    "申请项目：" + (input.program || ""),
    "",
    "请按以下要求补充材料或信息。补齐后请发给顾问，或放入指定补充材料文件夹。",
    "",
  ]
  const included = items.filter((item: any) => item.addedToWordList !== false)
  if (included.length === 0) lines.push("当前没有需要补充的材料或信息。")
  for (let index = 0; index < included.length; index += 1) {
    const item = included[index]
    lines.push(String(index + 1) + ". " + item.name, "为什么需要：" + item.whyNeeded, "如何准备：" + item.prepareFrom, "文件格式：" + item.formatRequirement, "")
  }
  lines.push("说明：最终提交申请、付款和推荐信邀请需由顾问人工确认完成。")
  return lines.join("\n")
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

function makeDocx(text: string) {
  const body = text.split("\n").map((line) => "<w:p><w:r><w:t xml:space=\"preserve\">" + escapeXml(line) + "</w:t></w:r></w:p>").join("\n")
  const documentXml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>" + body + "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\"/></w:sectPr></w:body></w:document>"
  return zipStore({
    "[Content_Types].xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>",
    "_rels/.rels": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>",
    "word/document.xml": documentXml,
  })
}

function zipStore(files: Record<string, string>) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name)
    const data = Buffer.from(content, "utf8")
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuffer, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuffer.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuffer)
    offset += local.length + nameBuffer.length + data.length
  }
  const centralOffset = offset
  const central = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, central, end])
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}
`
}

export async function writeOpenCodeConfig(workspacePath: string, overrides?: OpenCodeResourceOverrides) {
  const base = join(workspacePath, ".opencode")
  await mkdir(join(base, "agents"), { recursive: true })
  await mkdir(join(base, "bin"), { recursive: true })
  await mkdir(join(base, "commands"), { recursive: true })
  await mkdir(join(base, "prompts"), { recursive: true })
  await mkdir(join(base, "tools"), { recursive: true })
  await Promise.all(
    ["node_modules", "package.json", "package-lock.json", "bun.lock"].map((name) =>
      rm(join(base, name), { recursive: true, force: true }),
    ),
  )
  await writeGeneratedJson(join(base, "opencode.json"), {
    $schema: "https://opencode.ai/config.json",
    model: APPLICATION_AGENT_MODEL,
    permission: {
      "*": "allow",
      read: {
        "*": "allow",
        "*.env": "deny",
        "*.env.*": "deny",
        "*.env.example": "allow",
      },
      edit: {
        "*": "allow",
        "../*": "deny",
      },
      external_directory: {
        "*": "allow",
      },
      skill: {
        "*": "allow",
      },
      todowrite: "allow",
      webfetch: "allow",
      websearch: "allow",
      question: "allow",
      bash: {
        "*": "allow",
        "rm -rf *": "deny",
        "git push*": "deny",
        "python*": "deny",
        "python3*": "deny",
      },
      "cua_final_submit": "deny",
      "cua_payment": "deny",
      "cua_recommendation_invite": "deny",
    },
    agent: {
      "application-agent": {
        description: "Terra-Edu 留学申请 Agent，自动整理资料、识别缺失项、生成清单并协助填写申请平台。",
        mode: "primary",
        model: APPLICATION_AGENT_MODEL,
        prompt: "{file:./prompts/application-agent.md}",
      permission: {
        "*": "allow",
        read: {
          "*": "allow",
          "*.env": "deny",
          "*.env.*": "deny",
          "*.env.example": "allow",
        },
        glob: "allow",
        grep: "allow",
        bash: {
          "*": "allow",
          "rm -rf *": "deny",
          "git push*": "deny",
        },
        question: "allow",
        skill: { "*": "allow" },
        todowrite: "allow",
        webfetch: "allow",
        websearch: "allow",
        },
      },
    },
    tool_output: {
      max_lines: 300,
      max_bytes: 16384,
    },
    compaction: {
      auto: true,
      prune: true,
      tail_turns: 18,
      preserve_recent_tokens: 60000,
      reserved: 12000,
    },
  })
  await writeGeneratedFile(join(base, "prompts/application-agent.md"), DEFAULT_APPLICATION_PROMPT)
  await writeGeneratedFile(
    join(base, "agents/application-agent.md"),
    `---
description: Terra-Edu 留学申请 Agent，服务留学顾问完成申请资料整理、缺失项识别、Word 清单和 ego-browser 填表。
mode: primary
model: opencode-go/deepseek-v4-pro
permission:
  "*": allow
  read:
    "*": allow
    "*.env": deny
    "*.env.*": deny
    "*.env.example": allow
  glob: allow
  grep: allow
  bash:
    "*": allow
    "rm -rf *": deny
    "git push*": deny
    "python*": deny
    "python3*": deny
  question: allow
  skill:
    "*": allow
  todowrite: allow
  webfetch: allow
  websearch: allow
---

${DEFAULT_APPLICATION_PROMPT}
`,
  )
  for (const skill of SKILL_DEFINITIONS) {
    const dir = join(base, "skills", skill.name)
    await mkdir(dir, { recursive: true })
    await writeGeneratedFile(join(dir, "SKILL.md"), renderSkill(skill))
  }
  await writeEgoBrowserSkill(base)
  await writeEgoBrowserWrapper(base, overrides)
  await writeTerraPaddleOcrWrapper(base)
  await writeTerraDialogGuardWrapper(base, overrides)
  for (const command of COMMAND_DEFINITIONS) {
    await writeGeneratedFile(join(base, "commands", `${command[0]}.md`), renderCommand(command))
  }
  await writeGeneratedFile(join(base, "tools/application-agent.ts"), renderApplicationAgentTools())
}
