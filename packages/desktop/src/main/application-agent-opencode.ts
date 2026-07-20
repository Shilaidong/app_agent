import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { APPLICATION_AGENT_MODEL, APPLICATION_AGENT_MODEL_ID } from "./application-agent-model"
import type { ApplicationRefillAttempt, ApplicationTask } from "./application-agent"
import egoRuntimeLock from "../../resources/ego-runtime.lock.json"

const root = dirname(fileURLToPath(import.meta.url))
const EGO_BROWSER_SKILL_PIN = egoRuntimeLock.terraPolicyRevision + ":" + egoRuntimeLock.officialSkill.sha256
const EGO_LITE_VENDOR_VERSION = egoRuntimeLock.version
const EGO_BROWSER_HELPER_SHA256 = egoRuntimeLock.egoBrowserHelperSha256
const EGO_LITE_CDHASH = egoRuntimeLock.cdHash
const EGO_BROWSER_PROTOCOL = `## ego-browser 通用观察协议

- 每个 heredoc 只完成一个短回合：先观察、执行一个逻辑动作组、再验证并结束本回合。同一可见区块内 3–8 个普通纯文本字段必须作为短批次：连续 fillInput+Tab，最后统一 snapshot/读回；不要一字段一回合。选择、添加/删除、自动完成、日期选择器、上传、保存和导航必须各自单独复查，不要与下一项高风险动作串在同一批次。
- 首次使用 task space 时记录返回的数值 task.id，并把它作为唯一可恢复的 taskSpaceId（调用 application-agent_cua 时传该 ID 的字符串形式）。已有保存 ID 的正常连续回合先用 listTaskSpaces 确认该空间仍为 agent ownership，再以该数值 ID 调用 useOrCreateTaskSpace(taskSpaceId)；不得再按名称匹配。若 listTaskSpaces 中已没有这个数值 ID，立即停止，用 retire_and_rebind_ego_task 记录缺失证据并让顾问明确选择“复用指定现有空间”或“新建替代空间”；确认前不得废弃、替换、新建或按名称猜测。主动调用 handOffTaskSpace 且确认 done:true 后，只有顾问明确回复继续，才可执行 \`await takeOverTaskSpace(taskSpaceId)\`；不要读取它的返回值，紧接着先调用 pageInfo()。若未主动交接却意外出现 user ownership、inactive、not assigned 或 user is controlling，立即停止浏览器命令并记录交接；顾问明确确认继续后按官方 API 执行 \`await claimTaskSpace(taskSpaceId)\`，紧接着也只调用 pageInfo()。绝不自动抢回控制。
- 选定 task space 后，每个回合先调用 pageInfo()。首次新建的 task space 已选中一个可观察的空白标签页时，初次申请网址导航必须在这个相同 target 内调用 navigateInitialPageCapturingAlerts；不得用 openOrReuseTab 新建第二个 target。锁定版 Ego 的 Page.navigate 会被同步 load-time alert 阻塞，并在 helper 回合退出时自动消掉仍未处理的弹窗，所以绝不能假设下一回合还能读取该弹窗。navigateInitialPageCapturingAlerts 只在初次导航期间临时替换无选择分支的 window.alert，通过 Ego CDP binding 记录完整 message、URL 和 frameId，并以等价“确定”语义让导航继续；它绝不替换 confirm、prompt 或 beforeunload。返回 kind:alerts 时记录全部文案后立即结束本 heredoc，下一独立回合只复用同一 taskSpaceId 并调用 pageInfo；不得重试导航或刷新。返回 kind:cleanup_failed（contaminated:true）时，临时注入无法确认已移除，该 task space 视为污染：立即硬停止一切导航、填写和保存，不得重试清理；调用 application-agent_cua record_browser_safety_stop（safetyKind:cleanup_failed）结构化写入 progress.egoBrowser.safetyStop，并原样保留 cleanupError、infoError、capturedAlerts、最后 pageInfo 和 taskSpaceId；也可用 TERRA_EGO_TASKSPACE_CONTAMINATED: 前缀的 record_failure 兼容写入同一字段。污染空间不可恢复：顾问只能点击“重新填写”创建全新 taskSpaceId，不得 resume/takeOver/rebind existing，也不得把这次情况记为 record_blocker resolved。返回 kind:alert_evidence_lost 时，注入已清理、空间未被污染，但 iframe load-time alert 可能已被自动确认且文字丢失：同样立即硬停止，不得 snapshot、填写、保存、导航或重试；调用 record_browser_safety_stop（safetyKind:alert_evidence_lost）结构化写入 safetyStop（或 TERRA_EGO_ALERT_EVIDENCE_LOST: 前缀的 record_failure 兼容写入），并用 question 工具明确告知顾问本回合 iframe 弹窗文字可能丢失。顾问只能通过桌面“查看后继续当前空间”按钮授权同空间恢复，或点击“重新填写”；模型传入 consultantConfirmed:true 不能解除。授权后第一回合只能 record_observation，观察成功前禁止填写/保存/complete。这两种硬停止都由 CUA 与 ego-browser wrapper 读取同一 safetyStop 字段强制阻断，不得记为 record_blocker resolved。只有 pageInfo() 没有 dialog 时，才可调用 snapshotText、captureScreenshot、js、click、fillInput、导航或其他页面操作。普通表单优先用 snapshotText 的语义 workflow；语义信息不足时由你根据现场截图改用 visual workflow；DOM/CDP 仅用于有明确观察证据的窄范围操作，不得用它伪造填写结果或直接绕过正常提交。
- 如果 pageInfo() 返回 dialog，先记录完整 dialog 信息和最近一次顶层页面证据；此时不得调用 snapshotText、captureScreenshot、js、点击/输入/上传/导航等任何页面操作，或任何 CDP 命令，唯一例外是 Page.handleJavaScriptDialog。type 为 alert 时使用 accept:true 关闭、调用 application-agent_cua record_blocker（blockerDisposition: resolved）后立刻结束本 heredoc；type 为 beforeunload 时一律 accept:false、记录 resolved 后结束本 heredoc，下一回合先确认 URL 未变化；所有 confirm 或 prompt 都必须 handOffTaskSpace，确认返回 done:true 后以真实 taskSpaceId、顶层 URL、标题和证据记录 blockerDisposition: handoff 并等待顾问，不得由 Agent 猜测选项或 prompt 文本。
- iframe 原生 alert 会阻塞触发它的 click/save Promise，但 Ego 仍能通过 pageInfo() 返回完整 dialog。任何保存、继续、选择、导航、上传等可能改变页面的动作，都必须按 ego-browser skill 的 observePageAction 模式执行：先启动动作但不 await，同时轮询 pageInfo；不得写成“await click 后再检查”。
- observePageAction 返回 dialog 时，保存完整 type、message、url、frameId。调用 record_blocker 时 currentUrl 始终传最近一次 pageInfo 的顶层 URL，dialog.url 和 frameId 分别传 dialogUrl、dialogFrameId，绝不能用 iframe URL 覆盖全局 currentUrl。alert 用 Page.handleJavaScriptDialog accept:true 关闭并立刻结束 heredoc；beforeunload 使用 accept:false；所有 confirm/prompt 都交接顾问。
- observePageAction 返回 unknown、click 拒绝或 Runtime.evaluate 超时时，结果只是“未决”，不是已经失败。记录精确动作、最后 pageInfo 和错误后立即结束本 heredoc；此时不得调用 application-agent_cua record_failure、不得交接顾问、不得刷新、重开链接、进入 iframe URL、用 JS 直接 submit 或重复动作。下一独立 heredoc 只能复用同一 taskSpaceId 并调用 pageInfo。只有这个新观察明确证明动作失败或仍无法观察时，才可记录失败或交接；只有新观察明确显示登录页或认证失败时才请求登录。
- 截图不是每回合默认动作。仅在页面跳转/登录态变化、保存前后证据不足、或 snapshotText 语义无法区分字段/错误时，才写入 \`05_screenshots/<有意义且唯一的名称>.png\` 并 \`await captureScreenshot(...)\`，随后用 OpenCode 内置 read 读取同一 PNG。禁止无参数 captureScreenshot；禁止对同一稳定表单页每字段截图。不得仅凭路径、cliLog 或旧截图判断页面。
- 普通文本输入必须使用 fillInput，随后发送真实 Tab；同区块 3–8 个纯文本字段应连成一批后再统一读回。编号/注册号/appointment number 等标识字段只能来自材料原文或顾问确认，禁止用分数、成绩或近似字符串推断。只有遮罩输入或 fillInput 无法产生真实按键语义时，才可逐键发送 CDP Input.dispatchKeyEvent，随后同样 Tab 并读取回显。
- 日期字段优先用 TERRA_POLICY 中的 fillDatePickerByClicks（真实 click 打开日历 → 真实点击切年/月 → 点日 → 点 OK/Apply → 读回）。若平台拒绝键入日期并提示必须用 date picker icon，禁止继续盲打键盘。最多尝试两种策略（icon 路径、相邻 calendar 按钮路径）；两种都失败则记录缺失/blocker 并 handOffTaskSpace 交给顾问，不得在日期控件上反复试错超过 2 个 heredoc。下拉选择必须先 click 打开、重新 snapshot、click 当前可见选项，再重新观察；任何重渲染都会使旧 ref 立即失效。
- 页面写操作禁止读取或调用 Vue internals、\`$router\`、store，禁止直接 DOM value setter、element.click()、form.submit()/requestSubmit() 或注入脚本提交。js/cdp 只可观察（含读取日历当前年月文案），唯一写入例外是真实键盘/CDP key events、Page.handleJavaScriptDialog 和用于保存审计的 network event 观察；页面交互仍必须走 click/fillInput/uploadFile/fillDatePickerByClicks 等真实交互 helper。
- 任何选择、添加/删除、自动完成、切换或导航都可能改变可见内容。动作后用新的 pageInfo 加 snapshotText 复查；仅当语义不足时再截图。DOM required 扫描只是辅助证据。每次改变页面后都必须重新进行带 taskSpaceId、URL、标题和证据的动态表单验证，才能保存。
- 遇到校验、超时、服务端错误或结果不明确时，先保留当前页面和观察证据，不得自动刷新、重开链接、重复同一动作或要求重新登录。若属于 observePageAction unknown，必须严格按上一条立即结束，并在下一独立 heredoc 只调用 pageInfo；只有该新观察明确证明动作失败或需要人工处理后，才可记录失败或交接。只有新观察明确显示认证失败或登录页时，才可请求顾问重新登录。
- 若 Terra 包装器返回 TERRA_EGO_BROWSER_VERSION_CONFLICT、TERRA_EGO_BROWSER_EXTERNAL_SERVICE_ACTIVE 或 TERRA_EGO_BROWSER_SERVICE_UNAVAILABLE，立即停止，不得重试、调用系统 ego-browser、关闭其他 Ego Lite 或猜测 task space。原样调用 application-agent_cua record_failure，并让顾问按提示处理后从新的观察回合继续。
- 保存前后都必须有新观察证据。每次 record_observation 都同时记录真正承载表单的 frameId、loaderId 和 frameUrl（非 iframe 页面就是主 frame）。动态复查通过后先调用 begin_save_attempt 得到 saveAttemptId 并固化源页面/frame/loader，再以 observePageAction 执行一次真实保存动作，记录 actionStartedAt 和 eventsDrainedAt，并收集 drainEvents/CDP Network 的结构化响应证据。把 requestWillBeSent 与 responseReceived 精简为 request/response 两部分并由 record_save_verified 以同一非空 requestId 关联；request 的 frameId/loaderId 是上下文身份，response 的 frameId/loaderId 若事件实际提供则必须与同 requestId 的 request 一致，未提供时不得伪造。不得传 headers、body、postData、cookies 或带 query/hash 的证据 URL。保存后调用 record_observation 写入新的顶层页面与表单 frame 证据。只有与源 frame/loader 和该次点击时间窗口一致的 POST/PUT/PATCH 2xx XHR/fetch，或同一 frame 中的普通 2xx document POST/重定向 document POST，并且目标 frame URL/loader 与最终响应匹配时，才能调用 record_save_verified。这同时支持顶层保存和 iframe 内保存；GET、非 2xx、后台 POST、旧事件、frame/loader 不匹配、无网络证据或仅有“Saved”文字都不能算服务器确认。
- complete_ego_task 是独立且终态的最终门。它必须使用最新页面观察的完整 taskSpaceId、顶层 URL/标题、frame/loader 和原样 evidence，显式传 confirmed:true、completionDisposition 以及 remainingRequiredFields:[]。任何 pending save attempt、顾问交接/接管、task-space rebind、空必填项，或没有晚于最新服务器确认保存的完成页观察，都不得记录阶段完成。complete_ego_task 成功后，所有 application-agent_cua 动作都会返回 BROWSER_TASK_ALREADY_COMPLETED；需要继续改动必须由顾问点击“重新填写”，不能污染已完成的会话。随后只能在独立 heredoc 调用 completeTaskSpace(taskSpaceId, { keep: true })。若这个唯一的最终 helper 回合失败，立即停止，不得再观察或重试；只可调用 record_failure，传相同 taskSpaceId，并把 detail 写为 TERRA_EGO_COMPLETION_HELPER_FAILED: 后紧跟原始错误，工具会归档并撤销这次假完成。
- 当前锁定的 Ego Lite 0.4.4.15 在程序化关闭经历过原生弹窗的窗口时可能崩溃。只有整所学校的浏览器任务真正结束后，才可在独立最终回合调用 \`completeTaskSpace(taskSpaceId, { keep: true })\`；一律不得使用 keep:false、关闭全部标签页或由 Agent 销毁该窗口，留给顾问正常查看和关闭。`

const EGO_OBSERVE_PAGE_ACTION_SOURCE = `async function observePageAction(action, { actionTimeoutMs = 8000, settleMs = 2000, pollMs = 100, pageInfoTimeoutMs = 1500 } = {}) {
  let settled
  const actionPromise = Promise.resolve()
    .then(action)
    .then((value) => (settled = { status: 'resolved', value }))
    .catch((error) => (settled = { status: 'rejected', error: String(error) }))
  const actionDeadline = Date.now() + actionTimeoutMs
  let quietDeadline
  let lastInfo
  let lastError
  let observedAfterSettled = false
  while (true) {
    if (settled && !quietDeadline) quietDeadline = Date.now() + settleMs
    const deadline = quietDeadline || actionDeadline
    if (Date.now() >= deadline) {
      if (settled && observedAfterSettled) return { kind: 'action', info: lastInfo, action: settled }
      return { kind: 'unknown', info: lastInfo, error: lastError || 'pageInfo produced no bounded post-action observation', action: settled, actionPromise }
    }
    let timeoutId
    const remaining = Math.max(1, Math.min(pageInfoTimeoutMs, deadline - Date.now()))
    const observation = await Promise.race([
      Promise.resolve().then(() => pageInfo()).then(
        (info) => ({ kind: 'info', info }),
        (error) => ({ kind: 'error', error: String(error) }),
      ),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve({ kind: 'timeout' }), remaining)
      }),
    ])
    clearTimeout(timeoutId)
    if (observation.kind === 'info') {
      lastInfo = observation.info
      if (lastInfo && typeof lastInfo === 'object' && 'dialog' in lastInfo) return { kind: 'dialog', info: lastInfo, actionPromise }
      if (quietDeadline) observedAfterSettled = true
    }
    if (observation.kind === 'error') lastError = observation.error
    if (observation.kind === 'timeout') lastError = 'pageInfo timed out after ' + remaining + 'ms'
    if (settled && !quietDeadline) {
      quietDeadline = Date.now() + settleMs
      observedAfterSettled = false
    }
    const sleepMs = Math.min(pollMs, Math.max(0, (quietDeadline || actionDeadline) - Date.now()))
    if (sleepMs > 0) await new Promise((resolve) => setTimeout(resolve, sleepMs))
  }
}`


// Real-click calendar helper for portals that reject typed dates. js() is only used to
// observe the open popup's year/month labels — never to set the field value.
export const EGO_FILL_DATE_PICKER_SOURCE = `async function fillDatePickerByClicks(target, desired, { maxMonthSteps = 36 } = {}) {
  const wanted = String(desired || '').trim()
  const match = wanted.match(/^(\\d{4})[-/](\\d{1,2})[-/](\\d{1,2})$/) || wanted.match(/^(\\d{1,2})[-/](\\d{1,2})[-/](\\d{4})$/)
  if (!match) return { ok: false, reason: 'unsupported_date_format', desired: wanted }
  const year = match[1].length === 4 ? Number(match[1]) : Number(match[3])
  const month = match[1].length === 4 ? Number(match[2]) : Number(match[1])
  const day = match[1].length === 4 ? Number(match[3]) : Number(match[2])
  if (!(year > 1900) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) {
    return { ok: false, reason: 'invalid_date_parts', desired: wanted }
  }
  const pickerSelector = target.pickerSelector || target.iconSelector || target.selector
  if (!pickerSelector) return { ok: false, reason: 'missing_picker_selector' }
  await click(pickerSelector, { label: target.label || 'open date picker' })
  await wait(0.25)
  const readPopup = async () => js("(() => { const roots = Array.from(document.querySelectorAll('[role=\\"dialog\\"], .datepicker, .calendar, .ui-datepicker, .k-calendar, .p-datepicker, .ant-picker-dropdown, .mx-datepicker-popup')); const root = roots.find((el) => el && el.offsetParent !== null) || roots[0]; if (!root) return null; const text = (root.innerText || root.textContent || '').replace(/\\s+/g, ' ').trim(); const yearMatch = text.match(/(19|20)\\d{2}/); const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']; let monthNum = null; const monthDigit = text.match(/\\b(1[0-2]|0?[1-9])\\b/); if (monthDigit) monthNum = Number(monthDigit[1]); const lower = text.toLowerCase(); for (let i = 0; i < monthNames.length; i++) { if (lower.includes(monthNames[i])) { monthNum = i + 1; break } } return { text: text.slice(0, 240), year: yearMatch ? Number(yearMatch[0]) : null, month: monthNum } })()")
  const clickByText = async (patterns) => {
    const found = await js("((patterns) => { const roots = Array.from(document.querySelectorAll('button, a, span, div, td, th')); for (const el of roots) { if (!el || el.offsetParent === null) continue; const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim(); if (!label) continue; if (patterns.some((p) => label === p || label.toLowerCase() === String(p).toLowerCase() || new RegExp(p, 'i').test(label))) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2, label } } } return null })(" + JSON.stringify(patterns) + ")")
    if (!found) return false
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: found.x, y: found.y, button: 'left', clickCount: 1 })
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: found.x, y: found.y, button: 'left', clickCount: 1 })
    await wait(0.15)
    return true
  }
  let steps = 0
  while (steps < maxMonthSteps) {
    const popup = await readPopup()
    if (!popup) return { ok: false, reason: 'picker_not_open', desired: wanted }
    if (popup.year === year && popup.month === month) break
    const goNext = !popup.year || popup.year < year || (popup.year === year && (popup.month || 0) < month)
    const moved = await clickByText(goNext
      ? ['Next', '›', '>', '下个月', '后一年', 'next month', 'next year']
      : ['Prev', '‹', '<', '上个月', '前一年', 'previous month', 'previous year'])
    if (!moved) return { ok: false, reason: 'cannot_navigate_calendar', popup, desired: wanted }
    steps += 1
  }
  const dayClicked = await clickByText([String(day), String(day).padStart(2, '0')])
  if (!dayClicked) return { ok: false, reason: 'day_not_found', desired: wanted }
  await clickByText(['OK', 'Apply', 'Done', '确定', '完成', '选择'])
  await wait(0.2)
  const readback = target.valueSelector
    ? await js("((sel) => { const el = document.querySelector(sel); return el ? (el.value || el.textContent || '').trim() : '' })(" + JSON.stringify(target.valueSelector) + ")")
    : ''
  return { ok: true, desired: wanted, readback, steps }
}`



export const EGO_INITIAL_NAVIGATION_SOURCE = `async function navigateInitialPageCapturingAlerts(url, { timeout = 30, settle = 1 } = {}) {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2)
  const bindingName = '__terraInitialAlert_' + suffix
  const stateKey = '__terraInitialAlertState_' + suffix
  await cdp('Runtime.enable')
  await drainEvents()
  await cdp('Runtime.addBinding', { name: bindingName })
  let installed
  try {
    installed = await cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: "(() => {" +
      "const bindingName=" + JSON.stringify(bindingName) + ";" +
      "const stateKey=" + JSON.stringify(stateKey) + ";" +
      "const original=globalThis.alert;" +
      "const state={alerts:[],restored:false};" +
      // After restore, aliases of the wrapped function captured by page scripts
      // must fall through to the native alert instead of silently swallowing it.
      "const wrapped=(message)=>{if(state.restored)return typeof original==='function'?original(message):undefined;const item={type:'alert',message:String(message),url:String(location.href),observedAt:new Date().toISOString()};state.alerts.push(item);try{globalThis[bindingName](JSON.stringify(item))}catch{}};" +
      "const restore=()=>{if(globalThis.alert===wrapped)globalThis.alert=original;state.restored=true};" +
      "state.restore=restore;" +
      "Object.defineProperty(globalThis,stateKey,{value:state,configurable:true});" +
      "globalThis.alert=wrapped;" +
      "globalThis.addEventListener('load',()=>setTimeout(restore,0),{once:true});" +
      "})()",
    })
  } catch (error) {
    // Compensate for the partially installed capture before failing the round.
    await cdp('Runtime.removeBinding', { name: bindingName }).catch(() => {})
    throw error
  }
  const actionStartedAt = new Date().toISOString()
  let action
  let actionError
  try {
    action = await gotoAndWait(url, { timeout, settle })
  } catch (error) {
    actionError = String(error)
  }
  // Cleanup must always be attempted. A removeScript/removeBinding failure means
  // the injected alert wrapper may survive into later documents, so it is a hard
  // contamination failure, never a successful action/alerts result.
  const cleanupFailures = []
  const cleanupIssues = []
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: installed.identifier }).catch((error) => cleanupFailures.push('removeScript: ' + String(error)))
  const events = await drainEvents().catch((error) => {
    cleanupIssues.push('drainEvents: ' + String(error))
    return []
  })
  await cdp('Runtime.removeBinding', { name: bindingName }).catch((error) => cleanupFailures.push('removeBinding: ' + String(error)))
  const contexts = new Map(events
    .filter((event) => event?.method === 'Runtime.executionContextCreated' && event.params?.context)
    .map((event) => [event.params.context.id, event.params.context.auxData?.frameId || '']))
  const bindingAlerts = events.flatMap((event) => {
    if (event?.method !== 'Runtime.bindingCalled' || event.params?.name !== bindingName) return []
    try {
      const item = JSON.parse(event.params.payload)
      return [{ ...item, frameId: contexts.get(event.params.executionContextId) || '' }]
    } catch {
      return []
    }
  })
  const cleanupError = cleanupFailures.concat(cleanupIssues).join('; ') || undefined
  // pageInfo is observed with a bounded catch so a broken or hung observation
  // can never mask a contamination or evidence-loss hard stop.
  let info
  let infoError
  {
    let timeoutId
    const observation = await Promise.race([
      Promise.resolve().then(() => pageInfo()).then(
        (value) => ({ kind: 'info', value }),
        (error) => ({ kind: 'error', error: String(error) }),
      ),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve({ kind: 'timeout' }), 5000)
      }),
    ])
    clearTimeout(timeoutId)
    if (observation.kind === 'info') info = observation.value
    else infoError = observation.kind === 'timeout' ? 'pageInfo timed out after 5000ms' : observation.error
  }
  const dialogOpen = Boolean(info && typeof info === 'object' && 'dialog' in info)
  if (cleanupFailures.length > 0) return { kind: 'cleanup_failed', contaminated: true, cleanupError, capturedAlerts: bindingAlerts, info, infoError, action, actionError, actionStartedAt }
  if (cleanupIssues.length > 0) {
    // The injection was removed, but the drained binding evidence is gone: an
    // iframe load-time alert may have been auto-accepted with its text lost.
    // Only the top-level fallback can still be read; a dialog blocks js().
    const topLevelAlerts = dialogOpen || infoError
      ? []
      : await js("(() => {const state=globalThis[" + JSON.stringify(stateKey) + "];if(state?.restore)state.restore();const frame=document.createElement('iframe');frame.style.display='none';document.documentElement.appendChild(frame);globalThis.alert=frame.contentWindow.alert.bind(frame.contentWindow);frame.remove();return state?.alerts||[]})()").catch(() => [])
    return { kind: 'alert_evidence_lost', cleanupError, capturedAlerts: bindingAlerts, topLevelAlerts: Array.isArray(topLevelAlerts) ? topLevelAlerts : [], info, infoError, action, actionError, actionStartedAt }
  }
  // A still-open native dialog (confirm/prompt, or an alert this capture does
  // not cover) blocks Runtime.evaluate, so the dialog check must come before
  // the top-level js() fallback; captured alert text is preserved either way.
  if (dialogOpen) return { kind: 'dialog', info, capturedAlerts: bindingAlerts, action, actionError, actionStartedAt, cleanupError, infoError }
  if (infoError) return { kind: 'unknown', info, capturedAlerts: bindingAlerts, error: actionError || infoError, actionStartedAt, cleanupError, infoError }
  // Always rebind a true native alert after temporary capture. Relying only on
  // restore() can leave a non-modal wrapper that later clicks swallow silently.
  const topLevelAlerts = await js("(() => {const state=globalThis[" + JSON.stringify(stateKey) + "];if(state?.restore)state.restore();const frame=document.createElement('iframe');frame.style.display='none';document.documentElement.appendChild(frame);globalThis.alert=frame.contentWindow.alert.bind(frame.contentWindow);frame.remove();return state?.alerts||[]})()").catch(() => [])
  const frameTree = await cdp('Page.getFrameTree')
  const topFrameId = frameTree?.frameTree?.frame?.id || ''
  const alerts = bindingAlerts.concat(Array.isArray(topLevelAlerts) ? topLevelAlerts.map((item) => ({ ...item, frameId: topFrameId })) : [])
    .map((item) => ({ ...item, frameId: item.frameId || (item.url === info?.url ? topFrameId : '') }))
    .filter((item, index, items) => items.findIndex((candidate) => candidate.message === item.message && candidate.url === item.url && candidate.frameId === item.frameId && candidate.observedAt === item.observedAt) === index)
  if (alerts.length > 0) return { kind: 'alerts', alerts, info, frameTree, action, actionStartedAt, cleanupError, infoError }
  if (actionError) return { kind: 'unknown', info, frameTree, error: actionError, actionStartedAt, cleanupError, infoError }
  return { kind: 'action', info, frameTree, action, actionStartedAt, cleanupError, infoError }
}`

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

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export type OpenCodeResourceOverrides = {
  egoLiteAppPath?: string
  egoRuntimeRoot?: string
  egoBrowserTestHelperPath?: string
  egoBrowserReadinessAttempts?: number
  egoBrowserSingleLaunchSentinel?: string
  sharedWorkspacePath?: string
}

function renderEgoBrowserWrapper(overrides?: OpenCodeResourceOverrides) {
  const appPath = overrides?.egoLiteAppPath || bundledEgoLiteAppPath()
  const runtimeRoot = overrides?.egoRuntimeRoot ? shellQuote(overrides.egoRuntimeRoot) : '"$HOME/Library/Application Support/edu.terra.application-agent/ego-lite-runtime"'
  const testHelperAssignment = overrides?.egoBrowserTestHelperPath
    ? "TEST_HELPER_PATH=" + shellQuote(overrides.egoBrowserTestHelperPath)
    : "TEST_HELPER_PATH=''"
  const singleLaunchAssignment = overrides?.egoBrowserSingleLaunchSentinel
    ? "SINGLE_LAUNCH_SENTINEL=" + shellQuote(overrides.egoBrowserSingleLaunchSentinel)
    : "SINGLE_LAUNCH_SENTINEL=''"
  const readinessAttempts = overrides?.egoBrowserReadinessAttempts ?? 15
  if (!Number.isInteger(readinessAttempts) || readinessAttempts < 1) throw new Error("egoBrowserReadinessAttempts must be a positive integer")
  return `#!/bin/sh
set -eu

APP_PATH=${shellQuote(appPath)}
EXPECTED_VERSION=${shellQuote(EGO_LITE_VENDOR_VERSION)}
EXPECTED_CDHASH=${shellQuote(EGO_LITE_CDHASH)}
EXPECTED_HELPER_SHA256=${shellQuote(EGO_BROWSER_HELPER_SHA256)}
EXPECTED_BUNDLE_ID='com.citrolabs.ego.lite'
EXPECTED_TEAM_ID='JGQLC6YQYJ'
INFO_PLIST="$APP_PATH/Contents/Info.plist"
RUNTIME_ROOT=${runtimeRoot}
RUNTIME_APP="$RUNTIME_ROOT/ego lite.app"
RUNTIME_INFO_PLIST="$RUNTIME_APP/Contents/Info.plist"
EGO_USER_DATA_ROOT="$HOME/Library/Application Support/Citro Labs/ego lite"
EGO_CONFIG="$EGO_USER_DATA_ROOT/ego_config.json"
READINESS_ATTEMPTS=${readinessAttempts}
${testHelperAssignment}
${singleLaunchAssignment}

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
    printf '%s\\n' "$identity" | /usr/bin/grep -Fxq "CDHash=$EXPECTED_CDHASH" &&
    printf '%s\\n' "$identity" | /usr/bin/grep -Fq 'Authority=Developer ID Application: CITRO LABS PTE. LIMITED (JGQLC6YQYJ)'
}

helper_integrity_valid() {
  helper="$1/Contents/Frameworks/ego Framework.framework/Versions/$EXPECTED_VERSION/Helpers/ego-browser"
  [ -x "$helper" ] && [ "$(/usr/bin/shasum -a 256 "$helper" | /usr/bin/awk '{ print $1 }')" = "$EXPECTED_HELPER_SHA256" ]
}

enabled_updater() {
  find "$1/Contents" -type f \\( -path '*/EgoUpdater.app/*' -o -path '*/EgoSoftwareUpdate.bundle/*' -o -path '*/com.citrolabs.ego.UpdaterPrivilegedHelper' \\) -exec sh -c 'for candidate do [ ! -x "$candidate" ] || printf "%s\\n" "$candidate"; done' sh {} + 2>/dev/null | head -n 1 || true
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
WORKSPACE=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)
EGO_NODE_STDIN=""
EGO_NODE_STDIN_COMPACT=""
HELPER_STDOUT=""
HELPER_STDERR=""
READINESS_STDERR=""
cleanup_wrapper_files() {
  [ -z "$EGO_NODE_STDIN" ] || /bin/rm -f "$EGO_NODE_STDIN"
  [ -z "$EGO_NODE_STDIN_COMPACT" ] || /bin/rm -f "$EGO_NODE_STDIN_COMPACT"
  [ -z "$HELPER_STDOUT" ] || /bin/rm -f "$HELPER_STDOUT"
  [ -z "$HELPER_STDERR" ] || /bin/rm -f "$HELPER_STDERR"
  [ -z "$READINESS_STDERR" ] || /bin/rm -f "$READINESS_STDERR"
}
trap 'cleanup_wrapper_files' EXIT
if [ -f "$WORKSPACE/03_state/task_control.json" ] && /usr/bin/grep -Eq '"paused"[[:space:]]*:[[:space:]]*true' "$WORKSPACE/03_state/task_control.json"; then
  printf '%s\\n' 'TERRA_EGO_TASK_PAUSED' >&2
  exit 75
fi
SAFETY_KIND=""
if [ -f "$WORKSPACE/03_state/application_progress.json" ]; then
  SAFETY_KIND=$(/usr/bin/python3 -c 'import json,sys
try:
  progress=json.load(open(sys.argv[1], encoding="utf-8"))
  stop=((progress.get("egoBrowser") or {}).get("safetyStop") or {})
  if stop.get("active") is True and stop.get("kind") in ("cleanup_failed", "alert_evidence_lost"):
    print(stop.get("kind") or "")
  elif stop.get("observationRequired") is True and stop.get("kind") == "alert_evidence_lost":
    print("observation_required")
except Exception:
  pass
' "$WORKSPACE/03_state/application_progress.json" 2>/dev/null || true)
  if [ "$SAFETY_KIND" = "cleanup_failed" ]; then
    printf '%s\\n' 'TERRA_EGO_TASKSPACE_CONTAMINATED: active browser safety stop blocks all ego-browser commands for this contaminated task space. Only consultant refill may create a replacement space.' >&2
    exit 82
  fi
  if [ "$SAFETY_KIND" = "alert_evidence_lost" ]; then
    printf '%s\\n' 'TERRA_EGO_ALERT_EVIDENCE_LOST: active browser safety stop blocks all ego-browser commands until the consultant authorizes continue on the desktop or starts refill.' >&2
    exit 83
  fi
fi
if [ "\${1:-}" = "nodejs" ]; then
  EGO_NODE_STDIN=$(/usr/bin/mktemp "$WORKSPACE/03_state/.ego-node-stdin.XXXXXX")
  EGO_NODE_STDIN_COMPACT=$(/usr/bin/mktemp "$WORKSPACE/03_state/.ego-node-stdin-compact.XXXXXX")
  /bin/cat > "$EGO_NODE_STDIN"
  /usr/bin/tr '\\r\\n\\t' '   ' < "$EGO_NODE_STDIN" > "$EGO_NODE_STDIN_COMPACT"
  if /usr/bin/sed -E 's/completeTaskSpace[[:space:]]*\\([[:space:]]*[[:alnum:]_$]+[[:space:]]*,[[:space:]]*\\{[[:space:]]*keep[[:space:]]*:[[:space:]]*true[[:space:]]*\\}[[:space:]]*\\)//g' "$EGO_NODE_STDIN_COMPACT" | /usr/bin/grep -Eiq 'complete([^[:alnum:]]|[[:space:]])*TaskSpace'; then
    printf '%s\\n' 'TERRA_EGO_UNSAFE_TASKSPACE_CLOSE: completeTaskSpace 只能使用可验证的字面量 completeTaskSpace(taskSpaceId, { keep: true })。省略参数、空参数、变量 keep、别名或 keep:false 都会在启动 Ego 前被拒绝。' >&2
    exit 81
  fi
  if /usr/bin/grep -Eiq 'closeTab' "$EGO_NODE_STDIN_COMPACT"; then
    printf '%s\\n' 'TERRA_EGO_UNSAFE_TASKSPACE_CLOSE: 申请任务禁止由 Agent 程序化关闭标签页或窗口。请保留当前 Ego 窗口给顾问查看和正常关闭。' >&2
    exit 81
  fi
  if /usr/bin/grep -Eiq 'reload' "$EGO_NODE_STDIN_COMPACT"; then
    printf '%s\\n' 'TERRA_EGO_UNSAFE_PAGE_RELOAD: 申请页面异常时禁止自动刷新；请结束本回合，下一回合只重新观察，仍异常则交接顾问。' >&2
    exit 81
  fi
  if [ "$SAFETY_KIND" = "observation_required" ] && /usr/bin/grep -Eiq 'fillInput|uploadFile|observePageAction|dispatchKeyEvent|navigateInitialPageCapturingAlerts|handOffTaskSpace|takeOverTaskSpace|claimTaskSpace|completeTaskSpace|openOrReuseTab' "$EGO_NODE_STDIN_COMPACT"; then
    printf '%s\\n' 'BROWSER_SAFETY_OBSERVATION_REQUIRED: after alert_evidence_lost recovery, only a pageInfo/list/snapshot observation round is allowed before any write, navigation, or control-change command.' >&2
    exit 84
  fi
  # Text blacklist only (defense-in-depth / speed bump). Anchored require/import patterns
  # avoid false positives on "required field" form text. Concatenation, encoding, and
  # indirect module loading can still evade — this targets model shortcuts, not deliberate bypass.
  # Do not switch to Node Permission Model here: Ego itself writes screenshots/profile/cache.
  if /usr/bin/grep -Eiq "require[[:space:]]*\\([[:space:]]*['\\"](node:)?(fs|child_process|os|net|http|https|dgram|dns|tls|worker_threads|vm|cluster|module|v8|inspector|perf_hooks)" "$EGO_NODE_STDIN_COMPACT"; then
    printf '%s\\n' 'TERRA_EGO_NODE_CAPABILITY_DENIED: heredoc 禁止 require() 加载 fs/child_process 等危险 Node 内置模块（文本黑名单为纵深防御，非完整安全边界）。' >&2
    exit 85
  fi
  if /usr/bin/grep -Eiq "import[[:space:]]*\\([[:space:]]*['\\"](node:)?(fs|child_process|os|net|http|https|dgram|dns|tls|worker_threads|vm|cluster|module|v8|inspector|perf_hooks)" "$EGO_NODE_STDIN_COMPACT"; then
    printf '%s\\n' 'TERRA_EGO_NODE_CAPABILITY_DENIED: heredoc 禁止 import() 动态加载 fs/child_process 等危险 Node 内置模块（文本黑名单为纵深防御，非完整安全边界）。' >&2
    exit 85
  fi
  if /usr/bin/grep -Eiq 'process[[:space:]]*\\.[[:space:]]*binding|process[[:space:]]*\\.[[:space:]]*dlopen|module[[:space:]]*\\.[[:space:]]*constructor' "$EGO_NODE_STDIN_COMPACT"; then
    printf '%s\\n' 'TERRA_EGO_NODE_CAPABILITY_DENIED: heredoc 禁止 process.binding / process.dlopen / module.constructor 等危险 Node 能力（文本黑名单为纵深防御，非完整安全边界）。' >&2
    exit 85
  fi
  # require[^[:alnum:]_] avoids matching the substring "require" inside "required".
  if /usr/bin/grep -Eiq 'Function[[:space:]]*\\(.*require[^[:alnum:]_]|return[[:space:]]+require[[:space:]]*\\(' "$EGO_NODE_STDIN_COMPACT"; then
    printf '%s\\n' 'TERRA_EGO_NODE_CAPABILITY_DENIED: heredoc 禁止 Function()/return require 规避写法加载 Node 内置模块（文本黑名单为纵深防御，非完整安全边界）。' >&2
    exit 85
  fi
  # Backtick module specifiers: shell single-quoted pattern so \` is a literal backtick (TS template escapes it).
  if /usr/bin/grep -Eiq 'require[[:space:]]*\\([[:space:]]*\`(node:)?(fs|child_process|os|net|http|https|dgram|dns|tls|worker_threads|vm|cluster|module|v8|inspector|perf_hooks)' "$EGO_NODE_STDIN_COMPACT"; then
    printf '%s\\n' 'TERRA_EGO_NODE_CAPABILITY_DENIED: heredoc 禁止 require() 以反引号加载 fs/child_process 等危险 Node 内置模块（文本黑名单为纵深防御，非完整安全边界）。' >&2
    exit 85
  fi
  if /usr/bin/grep -Eiq 'import[[:space:]]*\\([[:space:]]*\`(node:)?(fs|child_process|os|net|http|https|dgram|dns|tls|worker_threads|vm|cluster|module|v8|inspector|perf_hooks)' "$EGO_NODE_STDIN_COMPACT"; then
    printf '%s\\n' 'TERRA_EGO_NODE_CAPABILITY_DENIED: heredoc 禁止 import() 以反引号动态加载 fs/child_process 等危险 Node 内置模块（文本黑名单为纵深防御，非完整安全边界）。' >&2
    exit 85
  fi
fi
if [ -f "$WORKSPACE/03_state/material_review.json" ] && /usr/bin/grep -Eq '"status"[[:space:]]*:[[:space:]]*"pending"' "$WORKSPACE/03_state/material_review.json"; then
  die "Terra-Edu material review is pending. Ask the advisor to confirm materials in the desktop app before starting ego-browser."
fi

if [ -z "$TEST_HELPER_PATH" ]; then
  [ -d "$APP_PATH" ] || die "Terra-Edu bundled ego lite is missing: $APP_PATH"
  [ -f "$INFO_PLIST" ] || die "Terra-Edu bundled ego lite Info.plist is missing: $INFO_PLIST"

VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST" 2>/dev/null || true)
[ "$VERSION" = "$EXPECTED_VERSION" ] || die "Terra-Edu bundled ego lite version mismatch: expected $EXPECTED_VERSION, got \${VERSION:-unknown}"

if ! /usr/bin/codesign --verify --deep --strict "$APP_PATH" >/dev/null 2>&1 || ! ego_identity_valid "$APP_PATH"; then
  unavailable "Terra-Edu 内置 Ego Lite 母版的官方签名已失效；为保护登录态和页面，没有启动浏览器。请重新安装 Terra-Edu 后再继续。"
fi
helper_integrity_valid "$APP_PATH" || unavailable "Terra-Edu 内置 Ego Lite helper 与运行锁不匹配；没有启动或复制浏览器。"
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
      helper_integrity_valid "$RUNTIME_APP" &&
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
    ! helper_integrity_valid "$STAGED_APP" ||
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

prepare_ego_first_run() {
  if [ -f "$EGO_CONFIG" ]; then
    if [ "$(/usr/bin/plutil -extract not_first_run raw -o - "$EGO_CONFIG" 2>/dev/null || true)" = "true" ]; then
      return
    fi
    unavailable "检测到已有但未完成首次运行的 Ego Lite 配置；Terra-Edu 没有覆盖它。请完成 Ego Lite 首次设置后点击“继续任务”。"
  fi
  if [ -e "$EGO_CONFIG" ]; then
    unavailable "Ego Lite 首次运行配置路径不是普通文件；Terra-Edu 没有修改或启动浏览器。"
  fi
  if ! /bin/mkdir -p "$EGO_USER_DATA_ROOT"; then
    unavailable "无法创建 Ego Lite 用户数据目录；没有启动浏览器。"
  fi
  if ! EGO_CONFIG_STAGED=$(umask 077 && /usr/bin/mktemp "$EGO_USER_DATA_ROOT/.ego_config.terra.XXXXXX"); then
    unavailable "无法准备 Ego Lite 首次运行配置；没有启动浏览器。"
  fi
  if ! printf '%s\\n' '{"not_first_run":true}' > "$EGO_CONFIG_STAGED"; then
    /bin/rm -f "$EGO_CONFIG_STAGED"
    unavailable "无法准备 Ego Lite 首次运行配置；没有启动浏览器。"
  fi
  if ! /bin/ln "$EGO_CONFIG_STAGED" "$EGO_CONFIG" 2>/dev/null; then
    /bin/rm -f "$EGO_CONFIG_STAGED"
    if [ -f "$EGO_CONFIG" ] && [ "$(/usr/bin/plutil -extract not_first_run raw -o - "$EGO_CONFIG" 2>/dev/null || true)" = "true" ]; then
      return
    fi
    unavailable "Ego Lite 首次运行配置在启动时发生变化；Terra-Edu 没有覆盖或启动浏览器。"
  fi
  /bin/rm -f "$EGO_CONFIG_STAGED"
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
  if /usr/bin/pgrep -f 'ego lite.app/Contents/' >/dev/null 2>&1 || /bin/launchctl print "gui/$USER_ID" 2>/dev/null | /usr/bin/grep -Fq 'com.citrolabs.ego.lite.ego-browser'; then
    printf '%s\\n' 'TERRA_EGO_BROWSER_EXTERNAL_SERVICE_ACTIVE: Ego Lite 在准备运行副本期间被另一进程启动。为保护其登录态和页面，Terra-Edu 未修改首次运行配置或启动竞争浏览器；请关闭另一 Ego Lite 后点击“继续任务”。' >&2
    exit 76
  fi
  prepare_ego_first_run
  if [ -n "$SINGLE_LAUNCH_SENTINEL" ]; then
    if [ -e "$SINGLE_LAUNCH_SENTINEL" ] || ! /bin/mkdir "$SINGLE_LAUNCH_SENTINEL" 2>/dev/null; then
      printf '%s\\n' 'TERRA_EGO_BROWSER_SERVICE_UNAVAILABLE: 隔离验收中的 Ego Lite 已经启动过但当前进程不存在；为避免反复启动和掩盖异常，本次验收不会重新打开浏览器。' >&2
      exit 76
    fi
  fi
  # Managed application filling never stores school-platform passwords in Terra.
  # Pass Chromium basic/mock keychain flags so a missing or reset macOS "ego"
  # keychain dialog cannot block CDP readiness or freeze GUI smoke.
  if [ -n "\${HOME:-}" ] && [ -n "\${CFFIXED_USER_HOME:-}" ]; then
    /usr/bin/open --env "HOME=$HOME" --env "CFFIXED_USER_HOME=$CFFIXED_USER_HOME" -n -gj "$RUNTIME_APP" --args --no-default-browser-check --no-first-run --password-store=basic --use-mock-keychain >/dev/null 2>&1 || true
  elif [ -n "\${HOME:-}" ]; then
    /usr/bin/open --env "HOME=$HOME" -n -gj "$RUNTIME_APP" --args --no-default-browser-check --no-first-run --password-store=basic --use-mock-keychain >/dev/null 2>&1 || true
  elif [ -n "\${CFFIXED_USER_HOME:-}" ]; then
    /usr/bin/open --env "CFFIXED_USER_HOME=$CFFIXED_USER_HOME" -n -gj "$RUNTIME_APP" --args --no-default-browser-check --no-first-run --password-store=basic --use-mock-keychain >/dev/null 2>&1 || true
  else
    /usr/bin/open -n -gj "$RUNTIME_APP" --args --no-default-browser-check --no-first-run --password-store=basic --use-mock-keychain >/dev/null 2>&1 || true
  fi
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
  ! helper_integrity_valid "$RUNTIME_APP" ||
  [ -n "$(enabled_updater "$RUNTIME_APP")" ]; then
  printf '%s\\n' 'TERRA_EGO_BROWSER_VERSION_CONFLICT: Terra-Edu 管理的 Ego Lite 运行副本已在当前浏览器会话中改变。为保护登录态和页面，没有调用它；请关闭该 Ego Lite 后点击“继续任务”。' >&2
  exit 76
fi
  HELPER="$RUNTIME_APP/Contents/Frameworks/ego Framework.framework/Versions/$EXPECTED_VERSION/Helpers/ego-browser"
  helper_integrity_valid "$RUNTIME_APP" || unavailable "已验证的 Ego Lite 运行副本缺少与运行锁匹配的 ego-browser helper；没有执行浏览器操作。"
else
  HELPER="$TEST_HELPER_PATH"
  [ -x "$HELPER" ] || die "Terra-Edu test ego-browser helper is not executable: $HELPER"
fi

export TERRA_EGO_LITE_APP="$RUNTIME_APP"
export TERRA_EGO_BROWSER_HELPER="$HELPER"
# Wait only for our pinned helper to answer a read-only task-space query; never
# fall back to a system helper.
READINESS_STDERR=$(/usr/bin/mktemp "$WORKSPACE/03_state/.ego-readiness-stderr.XXXXXX")
attempt=1
ready=0
readiness_status=252
while [ "$attempt" -le "$READINESS_ATTEMPTS" ]; do
  set +e
  "$HELPER" taskspace list >/dev/null 2>"$READINESS_STDERR"
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
  attempt=$((attempt + 1))
  [ "$attempt" -gt "$READINESS_ATTEMPTS" ] || sleep 1
done
if [ "$ready" -ne 1 ]; then
  /bin/cat "$READINESS_STDERR" >&2
  printf '%s\\n' "TERRA_EGO_BROWSER_SERVICE_UNAVAILABLE: 随包 Ego Lite 未在限定时间内就绪（最后一次 taskspace list 退出码 \${readiness_status}）；没有执行浏览器操作。请由顾问确认后再继续。" >&2
  exit 76
fi

set +e
HELPER_STDOUT=$(/usr/bin/mktemp "$WORKSPACE/03_state/.ego-helper-stdout.XXXXXX")
HELPER_STDERR=$(/usr/bin/mktemp "$WORKSPACE/03_state/.ego-helper-stderr.XXXXXX")
if [ -n "$EGO_NODE_STDIN" ]; then
  "$HELPER" "$@" <"$EGO_NODE_STDIN" >"$HELPER_STDOUT" 2>"$HELPER_STDERR"
else
  "$HELPER" "$@" >"$HELPER_STDOUT" 2>"$HELPER_STDERR"
fi
helper_status=$?
set -e
/bin/cat "$HELPER_STDOUT"
/bin/cat "$HELPER_STDERR" >&2

if [ "$helper_status" -eq 255 ]; then
  printf '%s\\n' 'TERRA_EGO_BROWSER_VERSION_CONFLICT: Ego Lite 服务在浏览器回合期间发生协议冲突，页面动作是否已经执行无法确认。Terra-Edu 未使用或关闭其他浏览器；不得重试或刷新，请顾问检查当前页面并关闭另一版本 Ego Lite 后点击“继续任务”。' >&2
  exit 76
fi
if [ "$helper_status" -eq 252 ]; then
  printf '%s\\n' 'TERRA_EGO_BROWSER_SERVICE_UNAVAILABLE: 随包 Ego Lite 服务在浏览器回合期间不可用，页面动作是否已经执行无法确认。不得重试或刷新，请由顾问检查当前页面后再继续。' >&2
  exit 76
fi
# Helper stdout is also the browser script's cliLog channel and can contain
# arbitrary page text. Only the helper's diagnostic stderr may establish that
# Ego actually rejected the operation because control was lost.
if /usr/bin/grep -Eiq '^Error: (user is controlling( this task space)?|task[ -]?space( [^:]+)? (is )?inactive|task[ -]?space( [^:]+)? (is )?not assigned to an agent|no longer assigned to an agent)[.!]?$' "$HELPER_STDERR"; then
  printf '%s\n' 'TERRA_EGO_TASKSPACE_CONTROL_LOST: Ego 报告当前 task space 已由用户控制、inactive 或不再分配给 Agent。不得重试或自动接管；请记录交接并等待顾问明确确认。' >&2
  exit 80
fi
SCRIPT_FAILURE_CODE=$(/usr/bin/sed -n "s/.*ego's nodejs process exited with code \\([0-9][0-9]*\\)\\..*/\\1/p" "$HELPER_STDOUT" "$HELPER_STDERR" | /usr/bin/tail -n 1)
if [ "$helper_status" -eq 0 ] && [ -n "$SCRIPT_FAILURE_CODE" ] && [ "$SCRIPT_FAILURE_CODE" -ne 0 ]; then
  printf '%s\n' "TERRA_EGO_SCRIPT_FAILED: ego-browser helper 返回 0，但其 nodejs 子进程退出码为 \${SCRIPT_FAILURE_CODE}。原始输出已完整保留；不得重试或刷新。下一回合只重新调用 pageInfo；若仍无法观察，交接顾问并保留当前页面。" >&2
  exit 79
fi
exit "$helper_status"
`
}

function readAuthoritativeEgoBrowserResource(relativePath: string, overrides?: OpenCodeResourceOverrides) {
  const path = join(
    overrides?.egoLiteAppPath || bundledEgoLiteAppPath(),
    dirname(egoRuntimeLock.officialSkill.relativePath),
    relativePath,
  )
  if (existsSync(path)) {
    const contents = readFileSync(path, "utf8")
    if (relativePath === "SKILL.md" && createHash("sha256").update(contents).digest("hex") !== egoRuntimeLock.officialSkill.sha256) {
      throw new Error("Authoritative Ego Lite skill hash does not match ego-runtime.lock.json")
    }
    return contents
  }
  throw new Error("Missing authoritative Ego Lite " + EGO_LITE_VENDOR_VERSION + " ego-browser resource: " + relativePath)
}

function managedEgoBrowserSkill(upstream: string) {
  const replacements = [
    [
      "await openOrReuseTab('https://example.com', { wait: true, timeout: 20 })",
      "// Managed Terra-Edu application tasks create and observe the blank task space in this first round. The next round uses navigateInitialPageCapturingAlerts from TERRA_POLICY.md on this same target.",
    ],
    [
      "cliLog(await snapshotText())",
      "const first = await pageInfo()\ncliLog(JSON.stringify({ taskSpaceId: task.id, first }, null, 2))\n// End this first round after persisting task.id. Navigate only in the next independent round under TERRA_POLICY.md.",
    ],
    [
      "- Navigation / state: `listTabs`, `openOrReuseTab`, `closeTab`, `gotoAndWait`, `currentTab`, `switchTab`, `gotoUrl`, `pageInfo`, `ensureRealTab`",
      "- Navigation / state: `listTabs`, `openOrReuseTab`, `gotoAndWait`, `currentTab`, `switchTab`, `gotoUrl`, `pageInfo`, `ensureRealTab`",
    ],
    [
      "- `await closeTab(target?)` — closes the given target id / tab object, or the current tab when omitted.",
      "- Managed Terra-Edu application tasks must not call `closeTab`; leave every tab and window open for the advisor to inspect and close normally.",
    ],
    [
      "   - Open or switch pages with `await openOrReuseTab(url, { wait: true })`; use `await gotoAndWait(url, { timeout, settle })` only when navigating inside the current tab.",
      "   - For a fresh managed task space whose first `pageInfo()` observes the selected blank tab, keep that same target and navigate with `navigateInitialPageCapturingAlerts(url, { timeout, settle })` from TERRA_POLICY.md; do not create a second target with `openOrReuseTab`. It records and accepts only information-only load-time alerts through direct Ego CDP, then the next round is pageInfo-only; it never intercepts confirm, prompt, or beforeunload.",
    ],
    [
      "Closing all tabs in a task space is equivalent to closing that task space.",
      "Closing all tabs in a task space is equivalent to closing that task space. Managed Terra-Edu application tasks therefore never close tabs programmatically.",
    ],
    [
      "For any follow-up on the same user goal — including continue, corrections, retries, validation, user-reported problems, or work after `completeTaskSpace(..., { keep: true })` — resume the original task space first if it still exists. Do not create a new task space for the same goal unless the user asks for a fresh space, starts an unrelated goal, or the original space is unavailable after checking. If a new space is necessary, state why.",
      "Before final completion, follow-up rounds for the same managed application goal reuse the saved numeric taskSpaceId. After `completeTaskSpace(taskSpaceId, { keep: true })`, the browser session is terminal: do not resume or modify that task space. Further filling requires the advisor to choose 重新填写, which starts a fresh Agent conversation and a fresh task space while reusing the prepared dossier.",
    ],
    [
      "| `completeTaskSpace(…, { keep: false })` | claims it, then closes it |",
      "| `completeTaskSpace(…, { keep: false })` | blocked by the managed Terra-Edu wrapper before Ego starts |",
    ],
    [
      "**`completeTaskSpace(nameOrId, { keep })` must occupy its own dedicated final heredoc, and run only after a prior heredoc's output has confirmed the task is genuinely done.** `keep` is required and defaults by policy to `false`: close the task space after completion unless there is a concrete reason to leave the live page visible.",
      "**`completeTaskSpace(taskSpaceId, { keep: true })` must occupy its own dedicated final heredoc, and run only after a prior heredoc's output has confirmed the task is genuinely done.** In a managed Terra-Edu application task, the literal `{ keep: true }` is mandatory; omitted options, variables, aliases, or any other completion form are rejected before Ego starts.",
    ],
    [
      "Use `{ keep: true }` only when the user explicitly asks to keep the page open, the task needs manual user action in that exact page, or the result cannot be delivered well as a URL, file, artifact, or summary. Do not keep a task space open merely because a page was visited, a document was created, or a screenshot was used for verification.",
      "Managed Terra-Edu application tasks always use `{ keep: true }` so the advisor can inspect and normally close the live application page.",
    ],
    [
      "**If the task space needs to be preserved after the task ends, keep only the tabs that need to be shown to the user.** Keep loose awareness of how many tabs are open — a quick `(await listTabs()).length` is enough; there's no need to spend a dedicated round just to check. When scratch tabs (search-result pages, cross-check pages, and other one-off pages) pile up, close them as you go rather than letting them all accumulate for the end. When finishing with `{ keep: true }` to leave pages for the user, clear out the remaining scratch tabs so only the pages worth showing stay open. Close a single tab with `await closeTab(targetId)` (`targetId` comes from `listTabs()` or an `openOrReuseTab` return value).",
      "**Preserve the whole managed task space after the task ends.** Do not close scratch tabs or the application window programmatically; switch to the application tab that should remain visible and leave normal closing to the advisor.",
    ],
    [
      "**Regaining control**: Take control back *only* after the user explicitly confirms — through an Ask (your harness's button/option prompt, e.g. \"Continue\" vs \"Finish task\") or a \"continue\" message in chat. Then start a new heredoc with `await takeOverTaskSpace([nameOrId])` and resume; if the user chooses to finish, close out with `await completeTaskSpace(nameOrId, { keep })`. Never call `takeOverTaskSpace` on your own to grab control back — it has no ownership check and will seize the browser away from the user.",
      "**Regaining control**: Take control back *only* after the user explicitly confirms — through an Ask (your harness's button/option prompt, e.g. \"Continue\" vs \"Finish task\") or a \"continue\" message in chat. Then start a new heredoc with `await takeOverTaskSpace([nameOrId])` and resume; if the user chooses to finish, preserve the page with `await completeTaskSpace(taskSpaceId, { keep: true })`. Never call `takeOverTaskSpace` on your own to grab control back — it has no ownership check and will seize the browser away from the user.",
    ],
    [
      "- If `await pageInfo()` reports `w: 0` or `h: 0`, do not continue coordinate actions or screenshots until the viewport is fixed. Try switching to the real tab, reloading, or using CDP viewport metrics, then verify with `await pageInfo()` and `await captureScreenshot()`.",
      "- If `await pageInfo()` reports `w: 0` or `h: 0`, switch once to the exact observed real tab and call `pageInfo()` again. Never reload an application page; if the viewport is still unavailable, stop the round and hand control to the advisor without changing the page.",
    ],
    [
      "- Always call `completeTaskSpace(name, { keep })` when the task is done — do not leave the space hanging. Default to `{ keep: false }`; use `{ keep: true }` only for the concrete live-page cases described in Task spaces.",
      "- When the managed application task is genuinely done, call exactly `completeTaskSpace(taskSpaceId, { keep: true })` in its own final heredoc. Never omit options, use a variable for `keep`, close tabs, or reload the page.",
    ],
  ] as const
  return replacements.reduce((contents, replacement) => {
    if (!contents.includes(replacement[0])) throw new Error("Locked Ego Skill no longer contains an expected managed-policy source passage: " + replacement[0])
    return contents.replace(replacement[0], replacement[1])
  }, upstream)
}

async function writeEgoBrowserSkill(base: string, overrides?: OpenCodeResourceOverrides) {
  const skillBase = join(base, "skills", "ego-browser")
  await mkdir(join(skillBase, "references"), { recursive: true })
  await mkdir(join(skillBase, "scripts"), { recursive: true })
  await writeGeneratedFile(
    join(skillBase, "SKILL.md"),
    managedEgoBrowserSkill(readAuthoritativeEgoBrowserResource("SKILL.md", overrides).trimEnd()) + [
      "",
      "",
      "## Terra-Edu workspace policy",
      "",
      "Before the first browser command, read `TERRA_POLICY.md` in this skill directory and follow it together with this upstream skill. The Terra policy narrows invocation, task-space recovery, screenshot attachment, real interactions, dialogs, and server-confirmed save evidence for this managed workspace.",
      "",
      "The managed wrapper uses this canonical bounded observer for actions that may open a dialog:",
      "",
      "```js",
      EGO_OBSERVE_PAGE_ACTION_SOURCE,
      "",
      "const result = await observePageAction(() => click('@save', { label: 'save current page' }))",
      "cliLog(JSON.stringify(result.kind === 'dialog' ? result.info : result, null, 2))",
      "```",
      "",
      "Date portals that require a calendar icon must use this real-click helper from TERRA_POLICY.md:",
      "",
      "```js",
      EGO_FILL_DATE_PICKER_SOURCE,
      "",
      "const dateResult = await fillDatePickerByClicks({ pickerSelector: '@dob-icon', valueSelector: '#dob', label: 'date of birth' }, '2002-05-18')",
      "cliLog(JSON.stringify(dateResult, null, 2))",
      "```",
      "",
      "Fresh managed navigation uses this direct-Ego alert capture because Chromium discards a still-blocked load-time alert when the helper round detaches:",
      "",
      "```js",
      EGO_INITIAL_NAVIGATION_SOURCE,
      "```",
      "",
    ].join("\n"),
  )
  await writeGeneratedFile(join(skillBase, "references/install.md"), readAuthoritativeEgoBrowserResource("references/install.md", overrides))
  await writeGeneratedFile(join(skillBase, "scripts/install.sh"), readAuthoritativeEgoBrowserResource("scripts/install.sh", overrides))
  await writeGeneratedFile(
    join(skillBase, "TERRA_POLICY.md"),
    [
      "# Terra-Edu ego-browser policy",
      "",
      `This policy accompanies the authoritative Ego Lite ${EGO_LITE_VENDOR_VERSION} skill above; it does not replace or redefine the upstream API.`,
      "",
      "Always invoke the managed wrapper as `PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs <<'EOF'`. Never call an unprefixed or system ego-browser and never install or update Ego Lite from this workspace.",
      "",
      "Screenshots are not default every turn. Capture only after navigation/login changes, before/after save when evidence is thin, or when snapshotText cannot resolve fields/errors. For every required screenshot, call `await captureScreenshot('05_screenshots/<unique-name>.png')`. After the heredoc returns, the next action must be OpenCode `read` on that exact `05_screenshots/<unique-name>.png`; continue visual reasoning only after the PNG is attached as `image/png`. Never call `captureScreenshot()` without a path, and never screenshot every plain text field.",
      "",
      "Allowed write chains are `fillInput+Tab+readback` for ordinary text (batch 3–8 plain fields in one round), `fillDatePickerByClicks` for date-picker portals, `cdp-key-events+Tab+readback` only for masked inputs, and `click+snapshot+click-option+reobserve` for selects. Registration/appointment numbers must come from source materials, never inferred from scores. Vue internals, $router/store access, direct DOM value setters, and scripted submit are forbidden.",
      "",
      "For save evidence: first record_observation with the top-level page plus the active form frame's frameId, loaderId, and frameUrl from Page.getFrameTree. Call `Network.enable`, drain old events, record actionStartedAt immediately before one real save click through observePageAction, settle briefly, then drain new events and record eventsDrainedAt. Join `Network.requestWillBeSent` and `Network.responseReceived` by the same non-empty requestId. Pass only compact evidence to record_save_verified: source page/title/frame/loader, the action window, request={requestId,method,url,observedAt,frameId,loaderId}, and response={requestId,status,url,resourceType,observedAt,frameId?,loaderId?,redirected?}. The request event supplies the authoritative frame/loader context; retain response frameId/loaderId only when the drained response event actually provides them, and never invent missing fields. Any provided response IDs must match that same request. XHR/fetch must stay on the frozen source frame+loader. A same-frame document POST may acquire a new request loader; the freshly observed destination frame URL/loader must match that request loader and final 2xx response. This covers ordinary document POST and iframe redirects without comparing an iframe URL to the top-level URL. Strip query/hash from every evidence URL. Never retain or pass headers, postData, body, cookies, or payloads.",
      "",
      "## Canonical action observer",
      "",
      "```js",
      EGO_OBSERVE_PAGE_ACTION_SOURCE,
      "",
      "const result = await observePageAction(() => click('@save', { label: 'save current page' }))",
      "cliLog(JSON.stringify(result.kind === 'dialog' ? result.info : result, null, 2))",
      "```",
      "",
      "## Canonical date picker helper",
      "",
      "```js",
      EGO_FILL_DATE_PICKER_SOURCE,
      "",
      "const dateResult = await fillDatePickerByClicks({ pickerSelector: '@dob-icon', valueSelector: '#dob', label: 'date of birth' }, '2002-05-18')",
      "cliLog(JSON.stringify(dateResult, null, 2))",
      "```",
      "",
      "Try at most two date strategies in two heredocs. If the portal rejects typed dates and both strategies fail, handOffTaskSpace instead of looping.",
      "",
      "## Canonical initial navigation",
      "",
      "```js",
      EGO_INITIAL_NAVIGATION_SOURCE,
      "```",
      "",
      EGO_BROWSER_PROTOCOL,
      "",
    ].join("\n"),
  )
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
- 当前批次顺序：第 ${task.input.batchOrder || "?"} 所；学校任务位于学生工作区的 schools 目录中。` : ""}
${task.input.sharedWorkspacePath ? `- 学生共享资料库（只通过申请专用工具更新）：${task.input.sharedWorkspacePath}
- 共享原始材料：${join(task.input.sharedWorkspacePath, "00_original_backup")}
- 共享 OCR 与材料索引：${join(task.input.sharedWorkspacePath, "03_state")}
- 共享学生核心档案：${join(task.input.sharedWorkspacePath, "02_generated/student_profile.md")}
- 当前学校只独立保存申请要求、学校缺失项、Ego task space、填表进度和审计。先调用 application-agent_workspace initialize：如果返回 reusedSharedDossier:true，必须跳过 OCR、分类和 student_profile 生成，直接只读复用本地同步的共享档案；如果返回 ownerPreparation:true，当前任务才负责完成一次材料整理并发布共享档案。` : ""}

## 申请专用 Custom Tools

你必须优先使用这些 OpenCode Custom Tools 完成可工具化步骤，不要只靠普通 shell 临时拼流程：

- application-agent_workspace：创建学校工作区；单校任务复制原始材料，选校批次则检查并同步学生共享资料库。
- application-agent_materials：调用随包 PaddleOCR 提取扫描 PDF/图片文字并分类材料；选校批次只允许资料库负责人执行一次，后续学校直接复用共享结果。
- application-agent_documents：从 missing_items.json 生成信息表、材料表、Word 清单和任务总结。
- application-agent_state：按统一 task_state.json schema 更新状态、统计和进度。
- ego-browser skill：macOS 申请平台填表的唯一浏览器自动化后端。通过 ego lite 的独立 task space 打开/复用申请平台，使用 snapshotText、fillInput、click、js、cdp、captureScreenshot、handOffTaskSpace、takeOverTaskSpace 完成真人式观察、填写、复查和保存。
- application-agent_cua：不再直接控制 Chrome，也不再调用 cua-driver；它只记录 ego-browser 填表阶段的 task space、观察结果、已验证字段、保存页面、上传材料、阻塞弹窗、失败原因和审计链。
- application-agent_risk：识别并阻断最终提交、付款、不可逆推荐信邀请、保存账号密码等高风险动作。
- application-agent_requirements：保存 webfetch/websearch 得到的学校、项目、平台要求，生成 application_requirements.json/md，并把确定缺失项同步到 missing_items.json。

## 工具调用硬性约束

- 启动阶段只做三件事：输出简短进度、优先调用 OpenCode 内置 todowrite 建立默认计划、调用 application-agent_workspace 初始化工作区或同步学生共享档案。todowrite 如果失败一次，不要重试、不要调用 runtime、不要阻塞启动；改用文字列出计划并继续 workspace 初始化。
- 启动阶段不要调用 webfetch、websearch、application-agent_requirements、ego-browser 或填表相关工具；这些放到工作区初始化成功后的后续阶段逐步执行。
- 默认流程中的工作区创建、材料分类、状态更新、文档生成、ego-browser 填表状态记录和高风险识别，必须调用对应的 application-agent_* Custom Tool。
- 后续阶段中，学校、项目、专业、申请平台要求必须优先用 webfetch 读取已知链接；链接信息不足时用 websearch 查找官方学校/项目/申请要求页面。抓取结果必须调用 application-agent_requirements 落盘。
- 客户端已随包提供 ripgrep 和 OCR，不要下载工具、不要使用 application-agent_runtime、不要用 Python，也不要用 bash 读写状态 JSON。文件读取使用 OpenCode 内置 read/glob/grep；扫描材料调用 application-agent_materials 的 extract_text；状态更新只调用 application-agent_state 和其他申请专用工具。
- bash 只允许用于官方 ego-browser skill 指定的 ego-browser nodejs heredoc 浏览器操作，以及有限诊断；不得用普通 bash 临时脚本替代申请专用工具链。
- 每次调用申请专用 Custom Tool 后，工具会写入 03_state/agent_execution_audit.json。任务总结前必须检查该审计文件，确认关键工具链已经执行。
- 如果某个 Custom Tool 调用失败，先记录失败原因并告知顾问，再决定是否用普通命令做有限兜底；不能无声绕过工具链。
- 如果看到 OpenCode compaction/summary/上下文压缩相关消息，必须把它当作正常维护动作：先读取最新状态文件恢复任务现场，然后继续执行 todowrite 中未完成的下一步。
- ego-browser skill 和 ego lite 浏览器都是 Terra-Edu 随软件打包的固定快照。每次运行 ego-browser heredoc 必须使用 \`PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs <<'EOF'\`，命中 .opencode/bin/ego-browser wrapper；不能调用系统 PATH 中的 ego-browser，不能自动更新、替换、下载或从 ego lite 应用中重新复制。
- 完整 ego-browser 通用观察协议只维护在工作区 \`.opencode/skills/ego-browser/TERRA_POLICY.md\`；进入填表阶段前必须 read 该文件。启动阶段不要打开浏览器。
- 填表关键回合规则（细节以 TERRA_POLICY 为准）：同区块 3–8 个纯文本字段一批 fill；日期用 fillDatePickerByClicks，两种策略失败即 handoff；编号字段禁猜；截图仅导航/保存/语义不足时使用；保存必须有网络证据。

- 上传文件只能调用 ego-browser 的 uploadFile(selector, absolutePath)，不得用 CDP 直接设置文件、不得改成原生文件选择器操作；上传后必须在新的无 dialog 观察中确认文件名或状态，再调用 application-agent_cua record_upload。
- 任何可能改变页面结构或可见内容的动作都会使旧复查失效。用最新观察理解新增内容，再以 remainingRequiredFields:[] 调用 application-agent_cua record_dynamic_form_verified；没有这条验证不得 SAVE。
- 点击 SAVE 前后都必须遵循 TERRA_POLICY，并以 taskSpaceId、当前 URL、页面标题和观察证据调用 record_save_verified。

## 启动阶段（第一轮只做这些）

1. 先用 1-2 句话告诉顾问：申请任务已接管，正在创建隔离工作区。
2. 优先调用 OpenCode 内置 todowrite 创建默认 10 步计划；如果 todowrite 调用失败一次，直接用文字列出默认计划并继续下一步。
3. 调用 application-agent_workspace，action 使用 initialize。单校任务初始化并复制副本；选校批次由工具判断当前任务是一次性资料整理负责人，还是直接同步已发布的共享档案。
4. 调用 application-agent_state 同步 workspace 结果：ownerPreparation:true 更新为“正在读取文件”；reusedSharedDossier:true 更新为“正在检查缺失内容”，不要把状态退回材料准备阶段。
5. 输出学校工作区、学生共享资料库（如有）、是否复用共享档案和下一步计划。若工具返回 reusedSharedDossier:true，后续计划必须删除 OCR、分类和重新生成学生档案三步。

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

export function buildApplicationAgentRefillPrompt(task: ApplicationTask, attempt: ApplicationRefillAttempt) {
  return `你现在是 Terra-Edu 重新填写 Agent。顾问刚刚在桌面软件明确点击了“重新填写”，这是一个全新的 OpenCode 对话；请立刻只接管 ${task.input.school} ${task.input.program} 的申请平台填写，不要继承或猜测旧对话中的任何结论。

## 本次重新填写

\`\`\`json
${JSON.stringify(attempt, null, 2)}
\`\`\`

- 目标工作区：${task.workspacePath}
- 申请平台链接：${task.input.applicationUrl}
- 本次唯一 Ego task space 名称：${attempt.taskSpaceName}
${attempt.batchId ? `- 这是选校批次 ${attempt.batchId} 的第 ${attempt.batchOrder || "?"} 所学校；只处理当前学校，不要并发启动批次内其他学校。批次共享材料已经整理完成，本次直接复用当前学校工作区的结构化产物。` : ""}
${task.input.sharedWorkspacePath ? `- 学生共享资料库：${task.input.sharedWorkspacePath}
- 学生核心档案和材料证据来自该共享资料库；它在本会话中严格只读。当前学校自己的 requirements、missing_items、application_progress 和浏览器审计仍在目标学校工作区内。` : ""}

## 这是填表专用会话，不是材料整理会话

以下产物已经由原任务生成并经顾问确认，必须只读复用：

- 03_state/task_state.json
- 03_state/materials_index.json
- 02_generated/student_profile.md
- 03_state/application_requirements.json
- 03_state/missing_items.json
- 03_state/material_review.json
- 00_original_backup 和 01_classified_materials
${task.input.sharedWorkspacePath ? `- ${task.input.sharedWorkspacePath} 下的共享原始材料、分类材料、OCR 文字与学生核心档案` : ""}

严禁调用 application-agent_workspace、application-agent_materials、application-agent_requirements 或 application-agent_documents。严禁重新初始化工作区、复制材料、OCR、分类、抓取/重写申请要求、重新生成 student_profile.md 或重新做材料总结。工具层和当前 Agent 权限也会拒绝这些操作；如果任何必需产物看起来不完整，请清楚报告缺失并停止，不得自行兜底重建。

## 第一轮执行

1. 用 read 只读取上面列出的结构化文件，建立本次填表所需的最小上下文；不要读取旧聊天记录，也不要从旧 application_progress 恢复浏览器操作。read 被权限规则拒绝时立即报告系统权限异常并停止，严禁改用 bash、cat、sed、Python、子代理或 skill 绕过。本次旧进度已归档在 ${attempt.progressArchivePath}，它只用于审计，不是续填依据。
2. 用 todowrite 建立 5 步填表计划：读取既有档案、创建独立 task space、观察并填写、逐页动态复查与保存、记录阻塞与总结。todowrite 失败一次就用文字计划继续，不要切换到材料整理。
3. 调用 application-agent_cua，action 使用 prepare_ego_task，applicationUrl 使用 ${JSON.stringify(task.input.applicationUrl || "")}，taskSpaceName 必须精确使用 ${JSON.stringify(attempt.taskSpaceName)}。顾问点击“重新填写”已经只授权本次创建一个全新的独立 task space；不得复用、接管、按名称猜测或刷新旧空间。
4. 完整观察协议见 \`.opencode/skills/ego-browser/TERRA_POLICY.md\`（进入浏览器前必须 read）。拿到新空间的数值 taskSpaceId 后，立即再次调用 prepare_ego_task 保存 ID；后续每个浏览器回合都只使用这个 ID。同区块 3–8 个纯文本字段一批填写；日期用 fillDatePickerByClicks，两种策略失败即 handoff；编号字段禁猜；截图仅导航/保存/语义不足时使用。

## 填写规则

- 只填写 student_profile.md、application_requirements.json 和已确认材料能够直接证明的内容；不确定字段调用 question 询问顾问，并通过 application-agent_cua 记录。
- 选择、添加/删除、自动完成、上传、保存和导航后必须重新观察动态字段；未通过最新 required-field 检查不得保存。
- 原生 alert/beforeunload/confirm/prompt 按通用观察协议处理；不得刷新页面或要求无证据的重新登录。
- 上传只能使用 ego-browser uploadFile，并在新观察中验证。
- 最终提交、付款、不可逆推荐信邀请、保存账号密码和猜填始终禁止。
- 只有整个当前学校申请的可自动填写阶段真正完成时，才可调用 completeTaskSpace(taskSpaceId, { keep: true })；不能每页完成就结束空间，也不得由 Agent 关闭窗口。

请现在开始第一轮：先简短告诉顾问“正在复用已整理内容并创建全新填表空间”，只读载入结构化档案，然后准备本次独立 Ego task space。`
}


const DEFAULT_APPLICATION_PROMPT = `你是 Terra-Edu 申请 Agent，服务对象是留学顾问。

你的目标是帮助顾问自动完成学生资料整理、申请信息生成、申请平台填写、缺失材料识别和补充材料清单输出。

顾问已经在任务创建页填写基础信息，包括学生姓名、学生资料文件夹、申请学校、申请项目、申请类型、申请平台或申请链接。任务开始后，你先完成稳定启动阶段，再按默认流程逐步执行，不要等待顾问一步一步指挥。

默认流程：
1. 优先调用 OpenCode 内置 todowrite 创建 10 步计划，并在每个阶段更新进度；如果 todowrite 调用失败一次，用文字计划继续，不要阻塞工作区初始化。
2. 调用 application-agent_workspace 创建/刷新学校工作区。单校任务复制原始资料；选校批次先检查学生共享资料库角色。
3. 只有工具返回 ownerPreparation:true 或单校任务时，才调用 application-agent_materials extract_text 运行 PaddleOCR；reusedSharedDossier:true 时必须跳过。
4. 只有资料库负责人或单校任务调用 application-agent_materials classify；后续学校直接复用共享材料索引。
5. 使用 webfetch 读取申请链接；信息不足时用 websearch 查找官方学校/项目要求，并调用 application-agent_requirements 落盘。
6. 资料库负责人生成只含学生事实的 student_profile.md；后续学校只读复用，不得重新生成。
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
- application-agent_risk：高风险动作识别和硬拦截。
- application-agent_requirements：保存学校、项目、平台要求，生成 application_requirements.json/md，并把确定缺失项同步到 missing_items.json。

工具调用硬性约束：
- 启动阶段只做 todowrite、application-agent_workspace initialize 和 application-agent_state 状态同步；todowrite 如果失败一次，用文字计划继续，不要阻塞工作区初始化；选校批次必须依据 workspace 返回值删去重复准备步骤；不要在启动阶段调用 webfetch、websearch、application-agent_requirements 或 ego-browser。
- 后续阶段中，学校、项目、专业、申请平台要求必须优先用 webfetch 读取已知链接；链接信息不足时用 websearch 查找官方页面。抓取结果必须调用 application-agent_requirements 落盘。
- 默认流程中的工作区创建、材料分类、状态更新、文档生成、ego-browser 填表状态记录和高风险识别，必须调用对应的 application-agent_* Custom Tool。
- 客户端已随包提供 ripgrep 和 OCR，不要下载工具、不要用 Python，也不要用 bash 读写状态 JSON。文件读取使用 OpenCode 内置 read/glob/grep；扫描材料调用 application-agent_materials 的 extract_text；状态更新只调用申请专用工具。
- bash 只允许用于官方 ego-browser skill 指定的 ego-browser nodejs heredoc 浏览器操作，以及有限诊断；不得用普通 bash 临时脚本替代申请专用工具链。
- 每次调用申请专用 Custom Tool 后，工具会写入 03_state/agent_execution_audit.json。任务总结前必须检查该审计文件，确认关键工具链已经执行。
- 如果某个 Custom Tool 调用失败，先记录失败原因并告知顾问，再决定是否用普通命令做有限兜底；不能无声绕过工具链。
- ego-browser skill 和 ego lite 浏览器都是 Terra-Edu 随软件打包的固定快照。每次运行 ego-browser heredoc 必须使用 \`PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs <<'EOF'\`，命中 .opencode/bin/ego-browser wrapper；不能调用系统 PATH 中的 ego-browser，不能自动更新、替换、下载或从 ego lite 应用中重新复制。
- 完整浏览器协议见 \`.opencode/skills/ego-browser/TERRA_POLICY.md\`；进入填表前必须 read。同区块 3–8 个纯文本字段一批填写；日期用 fillDatePickerByClicks，两种策略失败即 handoff；编号字段禁猜；截图仅导航/保存/语义不足时使用。
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

const DEFAULT_APPLICATION_REFILL_PROMPT = `你是 Terra-Edu 重新填写 Agent，服务对象是留学顾问。你只负责基于当前申请工作区中已经整理并确认的内容，重新启动一个干净的申请平台填表过程。

当前会话不得执行材料准备工作：不得初始化/刷新工作区，不得复制材料，不得 OCR 或分类，不得重新抓取申请要求，不得生成顾问文档，不得生成或改写 student_profile.md。首次只读载入 task_state.json、materials_index.json、student_profile.md、application_requirements.json、missing_items.json 和 material_review.json；暂停、继续或浏览器填表阶段还可只读载入 task_control.json、当前 application_progress.json 和 agent_execution_audit.json，但不得读取 03_state/filling_attempts 下的旧进度归档。必须使用 OpenCode 内置 read 读取这些文件，read 被权限规则拒绝时立即报告系统权限异常并停止，严禁改用 bash、cat、sed、Python、子代理或 skill 绕过。如果这些产物缺失或不可信，清楚报告并停止，不做兜底。

浏览器操作只能使用随包 ego-browser skill 和 application-agent_cua。每次新会话必须使用启动消息给出的唯一 taskSpaceName 创建独立 task space，不得复用、接管或猜测旧空间。严格执行“先 pageInfo 观察 → 一个逻辑动作组 → 再观察”的协议；对动态字段、原生弹窗、保存验证和顾问接管遵守 ego-browser skill 与启动消息中的全部约束。

只填写结构化档案和已确认材料能够证明的信息；不确定字段询问顾问，不猜填。不得自动最终提交、付款、发送不可逆推荐信邀请、保存账号密码或执行不可逆确认。选校批次始终只处理当前学校，不并发打开其他学校。`

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
    description: "创建学校隔离工作区；选校批次检查并复用学生共享资料库。",
    body: `执行步骤：
1. 调用 application-agent_workspace，action 使用 initialize。
2. 检查工具返回的 reusedSharedDossier 和 ownerPreparation。reusedSharedDossier:true 时必须删除计划中的 OCR、分类和学生档案生成步骤；ownerPreparation:true 时才执行一次共享材料准备。
3. 单校任务确认本地标准目录；批次任务确认共享材料只在 shared 目录，学校目录只保存学校状态和兼容快照。
4. 调用 application-agent_state：首次整理更新为“正在读取文件”，复用共享档案更新为“正在检查缺失内容”。

输出要求：
- 告诉顾问学校工作区、学生共享资料库以及本次是首次整理还是直接复用。
- 如果复制失败，记录失败文件和原因，不要继续假装完成。`,
  },
  {
    name: "material-organization",
    description: "按身份、学术、语言、文书、推荐、财务、平台相关、其他、待确认分类材料。",
    body: `执行步骤：
1. 调用 application-agent_materials，先用 extract_text 生成扫描材料文字，再用 classify 对 00_original_backup 中的文件分类。
2. 如果 application-agent_workspace 已返回 reusedSharedDossier:true，禁止执行本 skill；直接读取同步后的 materials_index 和共享档案。
3. 优先结合文件名、共享资料库 03_state/extracted_text/ 中的文字和文件内容判断用途。
4. 分类目录必须覆盖 identity、academic、language、essays、recommendation、financial、platform_related、other、needs_review。
5. 不确定材料进入 needs_review，并在 missing_items.json 中加入“待确认材料用途”。
6. 分类完成后调用 application-agent_state 更新为“正在生成学生资料”。

输出要求：
- 汇报已分类数量、主要材料类型、待确认数量。
- 不要移动或覆盖原始学生文件夹。`,
  },
  {
    name: "student-profile-generation",
    description: "根据已有材料生成结构化 student_profile.md，作为后续填表核心资料库。",
    body: `执行步骤：
1. 读取 03_state/materials_index.json、文本/OCR 提取结果、已有缺失项和任务输入。
2. 如果 application-agent_workspace 已返回 reusedSharedDossier:true，禁止重新生成或改写 student_profile.md；只读使用工具同步的共享档案快照。
3. 只有资料库负责人生成或更新 02_generated/student_profile.md。档案只包含可跨学校复用的学生事实：基本信息、联系方式、家庭信息、教育经历、成绩、语言成绩、活动、奖项、推荐人事实和材料证据路径。
4. 学校、项目、截止日期、学校特定文书观点、学校问题答案、学校缺失项和浏览器状态严禁写入学生核心档案；它们分别保存在 task_input、application_requirements、missing_items 和 application_progress。
5. 对无法确认的字段写“待确认”，不要编造。
6. 生成后调用 application-agent_state 更新为“正在检查缺失内容”。

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
2. 完整浏览器协议只维护在 \`.opencode/skills/ego-browser/TERRA_POLICY.md\` 与 ego-browser skill 中；本 skill 不再重复粘贴全文。填表时必须先 read 该协议，并遵守其中的回合制、dialog、保存证据、日期选择器与截图节制规则。任何可能打开弹窗的动作必须用 observePageAction（先启动动作但不 await，同时轮询 pageInfo）；原生 dialog 仅允许 Page.handleJavaScriptDialog 处理。
3. 首轮先得到 task.id 和无 dialog 的页面观察，再以 taskSpaceId、当前 URL、标题和证据调用 record_observation。后续只依据 student_profile.md 与材料原文中可确认的信息填写；不确定信息记录为缺失，不猜填。编号/注册号/appointment number 只能来自材料或顾问确认，禁止用分数推断。
4. 同一可见区块内 3–8 个普通纯文本字段在一个 heredoc 内连续 fillInput+Tab，最后统一读回；选择/日期/上传/保存各自单独复查。日期优先 fillDatePickerByClicks；平台要求 date picker icon 时禁止盲打，两种策略失败即 handoff，最多 2 个日期 heredoc。
5. 默认用 snapshotText；仅当语义不足、保存前后或导航后需要视觉证据时才截图并 read。不要对稳定表单每字段截图。
6. alert、离页确认、未知确认或顾问接管均按 TERRA_POLICY 处理。交接前确认 handOffTaskSpace 返回 done:true；登录交接调用 handoff_to_consultant 时标记 handoffType: login，其他浏览器接管标记 handoffType: browser_takeover。顾问接管期间保持静默，不要空转观察；绝不自动抢回控制，只有顾问明确回复继续后才可 takeOverTaskSpace/claimTaskSpace。
7. 保存前完成动态表单复查并调用 begin_save_attempt 取得 saveAttemptId 与源页面上下文；以 observePageAction 执行真实保存，将同一 requestId 的 request/response 精简证据交给 record_save_verified 校验。保存后记录目标页面的新观察与 readbackValue；Save & Continue 跳页是允许的，但源页面上下文和目标页面观察不可混用。GET、非 2xx、旧事件或只有页面文字都不得算保存成功。
8. 上传材料用 ego-browser uploadFile；上传后在新的无 dialog 观察中确认文件名或状态，再调用 record_upload。
9. 每次准备执行最终提交、付款、推荐信邀请或其他不可逆确认前，必须先调用 application-agent_risk；命中 BLOCKED 就停止。
10. 只有整个浏览器阶段确实结束时才可 completeTaskSpace(taskSpaceId, { keep: true })；不得因为当前页面完成而关闭或完成 task space，也不得使用 keep:false。

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
model: ${APPLICATION_AGENT_MODEL}
---

${command[2]}
`
}

function renderApplicationAgentTools() {
  return String.raw`import { createHash, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { cp, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join, relative, resolve } from "node:path"
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const EGO_OBSERVE_PAGE_ACTION_SOURCE = ${JSON.stringify(EGO_OBSERVE_PAGE_ACTION_SOURCE)}
const EGO_INITIAL_NAVIGATION_SOURCE = ${JSON.stringify(EGO_INITIAL_NAVIGATION_SOURCE)}

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

function rejectPreparationMutationForRefill(ctx: ToolContext, operation: string) {
  if (ctx.agent !== "application-refill-agent") return
  throw new Error(
    "REFILL_PREPARATION_LOCKED: 重新填写会话只允许复用已确认产物并操作申请平台，已拒绝 " + operation + "。请不要初始化工作区、复制/OCR/分类材料、重写申请要求、student_profile 或顾问文档。",
  )
}

function materialReviewTrustPath(workspace: string) {
  return join(workspace, "03_state", ".desktop_material_review_trust.json")
}

function materialReviewPrepareError(review: Record<string, any> | null | undefined, trust: Record<string, any> | null | undefined) {
  if (!review || review.status !== "approved") {
    return "材料确认或补充内容同步尚未完成。请停止，不要启动 ego-browser；等待 material_review.json 记录 preparationCompleteAt。"
  }
  if (!String(review.reviewId || "").trim() || !String(review.mode || "").trim() || !String(review.submittedAt || "").trim()) {
    return "MATERIAL_REVIEW_UNTRUSTED: material_review.json 缺少桌面审核 schema（reviewId/mode/submittedAt），疑似非桌面写入。"
  }
  if (!trust?.reviewId || trust.reviewId !== review.reviewId || trust.approvedBy !== "desktop_submitApplicationMaterialReview") {
    return "MATERIAL_REVIEW_UNTRUSTED: 材料审核未通过桌面授权记录校验。Agent 不得自行伪造 material_review.json；请顾问在材料确认面板重新确认。"
  }
  return undefined
}

async function materialReviewPreparationComplete(workspace: string, materialReview: Record<string, any>) {
  if (Date.parse(String(materialReview.preparationCompleteAt || ""))) return true
  if (materialReview.mode === "skip") return true
  if (!Date.parse(String(materialReview.submittedAt || ""))) return false
  if (materialReview.mode === "note") {
    // Note mode: consultant already authorized start. Complete when profile was updated after
    // approval, or when there was no prior profile hash (common for school-local first notes).
    const profile = materialReview.scope === "student"
      ? String(materialReview.sharedProfileCandidatePath || "")
      : join(workspace, "02_generated", "student_profile.md")
    const before = String(materialReview.scope === "student" ? materialReview.sharedProfileSha256Before || "" : materialReview.profileSha256Before || "")
    if (before && profile && existsSync(profile)) return before !== await hashFile(profile)
    if (Date.parse(String(materialReview.noteAppliedAt || ""))) return true
    return existsSync(join(workspace, "03_state", "missing_items.json"))
  }
  if (!existsSync(join(workspace, "02_generated", "student_profile.md")) || !existsSync(join(workspace, "03_state", "missing_items.json"))) return false
  if (materialReview.mode !== "supplement_folder") return false
  const expected = Array.isArray(materialReview.sourceManifest)
    ? materialReview.sourceManifest.map((item: any) => String(item?.sha256 || "")).filter(Boolean)
    : []
  const applied = new Set(Array.isArray(materialReview.appliedSourceHashes) ? materialReview.appliedSourceHashes.map(String) : [])
  return expected.length > 0 && expected.every((hash: string) => applied.has(hash))
}

async function stampMaterialReviewPreparationComplete(workspace: string, materialReview: Record<string, any>) {
  if (materialReview.status !== "approved" || Date.parse(String(materialReview.preparationCompleteAt || ""))) return materialReview
  if (!(await materialReviewPreparationComplete(workspace, materialReview))) return materialReview
  const next = { ...materialReview, preparationCompleteAt: new Date().toISOString(), noteAppliedAt: materialReview.noteAppliedAt || new Date().toISOString() }
  await writeJson(join(workspace, "03_state", "material_review.json"), next)
  return next
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

async function writeAtomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const staged = join(dirname(path), "." + basename(path) + ".staged-" + process.pid + "-" + Date.now())
  await writeFile(staged, JSON.stringify(value, null, 2) + "\n", "utf8")
  await rename(staged, path)
}

function sharedStudentDossier(task: any) {
  const taskWorkspace = resolve(String(task.workspacePath || task.sessionDirectory || "").trim())
  const schools = dirname(taskWorkspace)
  if (basename(schools) !== "schools") return undefined
  const batchWorkspace = dirname(schools)
  const workspace = join(batchWorkspace, "shared")
  const configuredShared = String(task.input?.sharedWorkspacePath || "").trim()
  const configuredBatch = String(task.input?.batchWorkspacePath || "").trim()
  if (
    (configuredShared && resolve(configuredShared) !== workspace) ||
    (configuredBatch && resolve(configuredBatch) !== batchWorkspace)
  ) {
    throw new Error("STUDENT_DOSSIER_PATH_MISMATCH: 当前学校任务与学生共享资料库路径不一致，已拒绝跨学生读取。")
  }
  if (!existsSync(workspace) || !existsSync(join(batchWorkspace, "03_state", "batch_state.json"))) return undefined
  return {
    workspace,
    materials: join(workspace, "00_original_backup"),
    classified: join(workspace, "01_classified_materials"),
    generated: join(workspace, "02_generated"),
    state: join(workspace, "03_state"),
    profile: join(workspace, "02_generated", "student_profile.md"),
    materialsIndex: join(workspace, "03_state", "materials_index.json"),
    ocrIndex: join(workspace, "03_state", "ocr_index.json"),
    extractedText: join(workspace, "03_state", "extracted_text"),
    manifest: join(workspace, "03_state", "shared_dossier_state.json"),
  }
}

async function sharedDossierAccess(task: any) {
  const shared = sharedStudentDossier(task)
  if (!shared) return undefined
  const state = await readJson(shared.manifest, {})
  // Only "ready" with hashes is consumable by later schools. Forged statuses like
  // "published" must not unlock shared reuse.
  if (state.status === "ready" && state.hashes && typeof state.hashes === "object") {
    return { shared, state, role: "reader" as const }
  }
  if (String(state.ownerTaskId || "") === String(task.id || "")) {
    return { shared, state, role: "owner" as const }
  }
  throw new Error("STUDENT_DOSSIER_NOT_READY: 第一所学校尚未完成学生共享档案。请先完成批次第 1 所学校的材料整理和材料确认，再启动当前学校。")
}

async function hydrateSharedDossier(workspace: string, task: any, access: any) {
  if (access.role !== "reader") return
  const required = [access.shared.profile, access.shared.materialsIndex]
  if (!required.every(existsSync)) {
    throw new Error("STUDENT_DOSSIER_INCOMPLETE: 共享档案已标记完成，但学生档案或材料索引缺失。请暂停当前学校并修复学生共享资料库。")
  }
  const expectedHashes = access.state.hashes || {}
  if (
    !expectedHashes.studentProfileSha256 ||
    !expectedHashes.materialsIndexSha256 ||
    !expectedHashes.rawMaterialsSha256 ||
    !expectedHashes.classifiedMaterialsSha256 ||
    !expectedHashes.extractedTextSha256 ||
    (expectedHashes.studentProfileSha256 && expectedHashes.studentProfileSha256 !== await hashFile(access.shared.profile)) ||
    (expectedHashes.materialsIndexSha256 && expectedHashes.materialsIndexSha256 !== await hashFile(access.shared.materialsIndex)) ||
    (expectedHashes.ocrIndexSha256 && (!existsSync(access.shared.ocrIndex) || expectedHashes.ocrIndexSha256 !== await hashFile(access.shared.ocrIndex))) ||
    expectedHashes.rawMaterialsSha256 !== await hashTree(access.shared.materials) ||
    expectedHashes.classifiedMaterialsSha256 !== await hashTree(access.shared.classified) ||
    expectedHashes.extractedTextSha256 !== await hashTree(access.shared.extractedText)
  ) {
    throw new Error("STUDENT_DOSSIER_HASH_MISMATCH: 学生共享档案在发布后发生变化，已停止同步；请由顾问重新确认材料档案。")
  }
  const localProfile = join(workspace, "02_generated", "student_profile.md")
  const localMaterialsIndex = join(workspace, "03_state", "materials_index.json")
  const localOcrIndex = join(workspace, "03_state", "ocr_index.json")
  await cp(access.shared.profile, join(workspace, "02_generated", "shared_student_profile.md"), { force: true })
  await cp(access.shared.materialsIndex, join(workspace, "03_state", "shared_materials_index.json"), { force: true })
  if (!existsSync(localProfile)) await cp(access.shared.profile, localProfile, { force: true })
  if (!existsSync(localMaterialsIndex)) await cp(access.shared.materialsIndex, localMaterialsIndex, { force: true })
  if (existsSync(access.shared.ocrIndex)) {
    await cp(access.shared.ocrIndex, join(workspace, "03_state", "shared_ocr_index.json"), { force: true })
    if (!existsSync(localOcrIndex)) await cp(access.shared.ocrIndex, localOcrIndex, { force: true })
  }
  await writeJson(join(workspace, "03_state", "shared_dossier_snapshot.json"), {
    status: "ready",
    reusedSharedDossier: true,
    sharedWorkspacePath: access.shared.workspace,
    version: Number(access.state.version || 1),
    publishedAt: access.state.publishedAt || access.state.updatedAt || "",
    synchronizedAt: new Date().toISOString(),
  })
}

async function hashFile(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

async function hashTree(path: string) {
  const files = existsSync(path) ? await listFiles(path) : []
  const records = await Promise.all(
    files.sort().map(async (file) => relative(path, file).replaceAll("\\", "/") + "\\0" + await hashFile(file)),
  )
  return createHash("sha256").update(records.join("\n")).digest("hex")
}

async function publishSharedDossier(workspace: string, task: any, ready: boolean) {
  const access = await sharedDossierAccess(task)
  if (!access || access.role !== "owner") return undefined
  if (!ready && access.state.status === "prepared") {
    return { sharedWorkspacePath: access.shared.workspace, preparedAt: access.state.preparedAt || access.state.updatedAt || "", publishedAt: "", hashes: access.state.hashes || {} }
  }
  // Trust only when making the dossier consumable (ready). prepared (ready=false) runs
  // before consultant review and must stay ungated — documents tool calls it pre-approval.
  // Hashes below only detect post-publish tamper: they are computed from content just copied
  // in, so they cannot detect a forged pre-publish profile.
  if (ready) {
    const review = await readJson(join(workspace, "03_state", "material_review.json"), {})
    const trust = await readJson(materialReviewTrustPath(workspace), null)
    const untrusted = materialReviewPrepareError(review, trust)
    if (untrusted) throw new Error(untrusted)
  }
  const materialReview = ready ? await readJson(join(workspace, "03_state", "material_review.json"), {}) : {}
  const candidateProfile = ready && materialReview.scope === "student" && existsSync(String(materialReview.sharedProfileCandidatePath || ""))
    ? String(materialReview.sharedProfileCandidatePath)
    : ""
  const localProfile = join(workspace, "02_generated", "student_profile.md")
  const sharedProfile = access.shared.profile
  // Batch owner agents often write profile under shared/02_generated; accept that source when school-local is missing.
  const profileSource = existsSync(candidateProfile)
    ? candidateProfile
    : existsSync(localProfile)
      ? localProfile
      : existsSync(sharedProfile)
        ? sharedProfile
        : ""
  const localMaterialsIndex = join(workspace, "03_state", "materials_index.json")
  // Prefer already-published shared materials index; only seed it from school-local when missing.
  const materialsSource = existsSync(access.shared.materialsIndex)
    ? access.shared.materialsIndex
    : existsSync(localMaterialsIndex)
      ? localMaterialsIndex
      : ""
  if (!profileSource || !materialsSource) {
    throw new Error("STUDENT_DOSSIER_INCOMPLETE: 发布共享档案前必须生成 student_profile.md 和 materials_index.json。")
  }
  await mkdir(access.shared.generated, { recursive: true })
  const stagedProfile = join(access.shared.generated, ".student_profile.md.staged-" + process.pid + "-" + Date.now())
  await cp(profileSource, stagedProfile, { force: true })
  await rename(stagedProfile, access.shared.profile)
  if (!existsSync(access.shared.materialsIndex)) await cp(materialsSource, access.shared.materialsIndex, { force: true })
  if (!existsSync(access.shared.ocrIndex) && existsSync(join(workspace, "03_state", "ocr_index.json"))) {
    await cp(join(workspace, "03_state", "ocr_index.json"), access.shared.ocrIndex, { force: true })
  }
  const preparedAt = new Date().toISOString()
  const hashes = {
    studentProfileSha256: await hashFile(access.shared.profile),
    materialsIndexSha256: await hashFile(access.shared.materialsIndex),
    ocrIndexSha256: existsSync(access.shared.ocrIndex) ? await hashFile(access.shared.ocrIndex) : "",
    rawMaterialsSha256: await hashTree(access.shared.materials),
    classifiedMaterialsSha256: await hashTree(access.shared.classified),
    extractedTextSha256: await hashTree(access.shared.extractedText),
  }
  await writeAtomicJson(access.shared.manifest, {
    ...access.state,
    status: ready ? "ready" : "prepared",
    version: Math.max(1, Number(access.state.version || 0) + 1),
    ownerTaskId: task.id,
    profilePath: access.shared.profile,
    materialsIndexPath: access.shared.materialsIndex,
    ocrIndexPath: access.shared.ocrIndex,
    hashes,
    preparedAt,
    publishedAt: ready ? preparedAt : "",
    updatedAt: preparedAt,
  })
  await writeJson(join(workspace, "03_state", "shared_dossier_snapshot.json"), {
    status: ready ? "ready" : "prepared",
    ownerPreparation: true,
    sharedWorkspacePath: access.shared.workspace,
    version: Math.max(1, Number(access.state.version || 0) + 1),
    preparedAt,
    publishedAt: ready ? preparedAt : "",
    hashes,
  })
  return { sharedWorkspacePath: access.shared.workspace, preparedAt, publishedAt: ready ? preparedAt : "", hashes }
}

async function finalizePreparedSharedDossier(workspace: string, task: any) {
  const access = await sharedDossierAccess(task)
  if (!access || access.role !== "owner" || access.state.status !== "prepared") return undefined
  // Flipping prepared → ready makes the dossier consumable by later schools; require desktop trust.
  const review = await readJson(join(workspace, "03_state", "material_review.json"), {})
  const trust = await readJson(materialReviewTrustPath(workspace), null)
  const untrusted = materialReviewPrepareError(review, trust)
  if (untrusted) throw new Error(untrusted)
  const publishedAt = new Date().toISOString()
  await writeAtomicJson(access.shared.manifest, {
    ...access.state,
    status: "ready",
    publishedAt,
    updatedAt: publishedAt,
  })
  return { sharedWorkspacePath: access.shared.workspace, preparedAt: access.state.preparedAt || "", publishedAt, hashes: access.state.hashes || {} }
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
  if (progress?.egoBrowser?.rebindPending) {
    return "BROWSER_TASK_SPACE_REBIND_PENDING: the missing task space is awaiting the consultant-authorized retire-and-rebind flow."
  }
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
  return Array.isArray(progress?.savedPages) && progress.savedPages.some((page: any) => page?.serverConfirmed === true)
}

function browserSafetyStop(progress: any) {
  const stop = progress?.egoBrowser?.safetyStop
  if (!stop || typeof stop !== "object") return null
  if (stop.kind !== "cleanup_failed" && stop.kind !== "alert_evidence_lost") return null
  if (!String(stop.taskSpaceId || "").trim()) return null
  return stop
}

function activeBrowserSafetyStop(progress: any) {
  const stop = browserSafetyStop(progress)
  return stop && stop.active === true ? stop : null
}

function browserSafetyObservationRequired(progress: any) {
  const stop = browserSafetyStop(progress)
  return stop && stop.active !== true && stop.observationRequired === true ? stop : null
}

function browserSafetyMarker(kind: string) {
  return kind === "cleanup_failed" ? "TERRA_EGO_TASKSPACE_CONTAMINATED" : "TERRA_EGO_ALERT_EVIDENCE_LOST"
}

function browserSafetyGateError(progress: any, options: { allowObservation?: boolean; allowSafetyRecord?: boolean; allowSafetyResolve?: boolean } = {}) {
  const active = activeBrowserSafetyStop(progress)
  if (active) {
    if (options.allowSafetyRecord || options.allowSafetyResolve) return ""
    const marker = browserSafetyMarker(active.kind)
    return marker + ": browser safety stop is active for taskSpaceId " + String(active.taskSpaceId) + (active.decisionId ? " decisionId " + String(active.decisionId) : "") + ". " + (active.kind === "cleanup_failed"
      ? "This task space is contaminated and cannot be resumed; only consultant refill may create a replacement space."
      : "Consultant must authorize continue on the desktop or start refill before any browser action.")
  }
  const observation = browserSafetyObservationRequired(progress)
  if (observation && !options.allowObservation && !options.allowSafetyRecord) {
    return "BROWSER_SAFETY_OBSERVATION_REQUIRED: after alert_evidence_lost recovery, only record_observation is allowed until the first fresh observation for taskSpaceId " + String(observation.taskSpaceId) + "."
  }
  return ""
}

function safetyKindFromFailureDetail(detail: string) {
  if (detail.startsWith("TERRA_EGO_TASKSPACE_CONTAMINATED:")) return "cleanup_failed"
  if (detail.startsWith("TERRA_EGO_ALERT_EVIDENCE_LOST:")) return "alert_evidence_lost"
  return ""
}

function applyBrowserSafetyStop(progress: any, input: { kind: "cleanup_failed" | "alert_evidence_lost"; taskSpaceId: string; evidence?: unknown; detail?: string }) {
  const existing = browserSafetyStop(progress)
  if (existing && existing.active === true && existing.kind === input.kind && String(existing.taskSpaceId) === input.taskSpaceId && existing.decisionId) {
    progress.egoBrowser = {
      ...(progress.egoBrowser || {}),
      taskSpaceId: input.taskSpaceId,
      safetyStop: {
        ...existing,
        evidence: input.evidence ?? existing.evidence,
        detail: input.detail || existing.detail || "",
      },
    }
    return progress.egoBrowser.safetyStop
  }
  const recordedAt = new Date().toISOString()
  const safetyStop = {
    kind: input.kind,
    taskSpaceId: input.taskSpaceId,
    active: true,
    recordedAt,
    decisionId: randomUUID(),
    evidence: input.evidence ?? null,
    detail: input.detail || "",
    observationRequired: false,
    retired: false,
  }
  if (!Array.isArray(progress.retiredTaskSpaces)) progress.retiredTaskSpaces = []
  progress.egoBrowser = {
    ...(progress.egoBrowser || {}),
    taskSpaceId: input.taskSpaceId,
    safetyStop,
  }
  delete progress.pendingSaveAttempt
  progress.dynamicFormChecks = []
  return safetyStop
}

function browserUrlWithoutQuery(value: unknown) {
  const text = String(value || "").trim()
  if (!URL.canParse(text)) return ""
  const url = new URL(text)
  return url.origin + url.pathname
}

function browserCompletionGateError(progress: any, input: any) {
  const taskSpaceId = String(input.taskSpaceId || "").trim()
  const currentUrl = String(input.currentUrl || "").trim()
  const pageTitle = String(input.pageTitle || "").trim()
  const frameId = String(input.frameId || "").trim()
  const loaderId = String(input.loaderId || "").trim()
  const frameUrl = String(input.frameUrl || "").trim()
  const evidence = String(input.evidence || input.text || "").trim()
  const auditError =
    browserAuditError("complete_ego_task", { taskSpaceId, currentUrl, pageTitle, frameId, loaderId, frameUrl, evidence }) ||
    requireNumericTaskSpaceId(taskSpaceId) ||
    browserTaskSpaceMismatch(progress, taskSpaceId)
  if (auditError) return auditError
  if (input.confirmed !== true) return "BROWSER_COMPLETION_CONFIRMATION_REQUIRED: complete_ego_task requires confirmed:true."
  if (!["automation_complete", "manual_boundary_reached"].includes(input.completionDisposition)) {
    return "BROWSER_COMPLETION_DISPOSITION_REQUIRED: choose automation_complete or manual_boundary_reached."
  }
  if (!Array.isArray(input.remainingRequiredFields)) {
    return "BROWSER_COMPLETION_REQUIRED_FIELDS_SCAN_REQUIRED: complete_ego_task requires remainingRequiredFields, including [] when none remain."
  }
  const remaining = input.remainingRequiredFields.map((field: unknown) => String(field).trim()).filter(Boolean)
  if (remaining.length > 0 || (Array.isArray(progress.requiredEmptyFields) && progress.requiredEmptyFields.length > 0)) {
    return "BROWSER_COMPLETION_REQUIRED_FIELDS_REMAIN: visible required fields still need attention."
  }
  if (progress.pendingSaveAttempt) return "BROWSER_COMPLETION_SAVE_PENDING: a save attempt is still pending."
  if (hasPendingBrowserHandoff(progress) || progress.egoBrowser?.takeoverPending === true) {
    return "BROWSER_COMPLETION_HANDOFF_PENDING: browser control has not returned to the Agent and been freshly observed."
  }
  if (progress.egoBrowser?.rebindPending || progress.egoBrowser?.rebindObservationPending === true) {
    return "BROWSER_COMPLETION_REBIND_PENDING: the replacement task space has not been freshly observed."
  }
  const safetyError = browserSafetyGateError(progress)
  if (safetyError) return safetyError
  if (!hasVerifiedBrowserSave(progress)) return "UNVERIFIED_BROWSER_COMPLETION: no server-confirmed save exists."
  const latestSave = Array.isArray(progress.savedPages)
    ? progress.savedPages.findLast((page: any) => page?.serverConfirmed === true && page?.taskSpaceId === taskSpaceId)
    : undefined
  if (!latestSave) return "UNVERIFIED_BROWSER_COMPLETION: the active task space has no server-confirmed save."
  const latestSaveAt = Date.parse(latestSave.at || "")
  const observation = progress.lastBrowserObservation
  const observedAt = Date.parse(observation?.at || "")
  if (
    !Number.isFinite(latestSaveAt) ||
    !Number.isFinite(observedAt) ||
    observedAt <= latestSaveAt ||
    Date.now() - observedAt < 0 ||
    Date.now() - observedAt > 5 * 60_000 ||
    observation?.taskSpaceId !== taskSpaceId ||
    observation?.currentUrl !== currentUrl ||
    observation?.pageTitle !== pageTitle ||
    observation?.frameId !== frameId ||
    observation?.loaderId !== loaderId ||
    observation?.frameUrl !== frameUrl ||
    observation?.evidence !== evidence
  ) {
    return "BROWSER_COMPLETION_OBSERVATION_REQUIRED: record a fresh matching page/frame observation after the latest verified save and pass its evidence unchanged."
  }
  return ""
}

function appendLimited(progress: any, key: string, item: any, limit = 120) {
  if (!Array.isArray(progress[key])) progress[key] = []
  progress[key].push(item)
  if (progress[key].length > limit) progress[key] = progress[key].slice(progress[key].length - limit)
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
  const input = await readJson(join(workspace, "03_state/task_input.json"), {})
  const sharedMaterials = String(input.sharedWorkspacePath || "").trim()
    ? join(String(input.sharedWorkspacePath), "00_original_backup")
    : ""
  const totalFiles = (
    await Promise.all(
      [sharedMaterials || join(workspace, "00_original_backup"), join(workspace, "06_new_materials")]
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
  if (task?.input) {
    return { ...task, workspacePath: workspace, sessionDirectory: workspace }
  }
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
  const shared = sharedStudentDossier(task)
  if (shared) {
    return {
      outputDir: shared.extractedText,
      indexPath: shared.ocrIndex,
      sourceDir: shared.materials,
      layoutVersion: 2,
    }
  }
  const batchWorkspace = String(task.input?.batchWorkspacePath || "").trim()
  if (!batchWorkspace || !existsSync(batchWorkspace)) return undefined
  return {
    outputDir: join(batchWorkspace, "03_state", "shared_extracted_text"),
    indexPath: join(batchWorkspace, "03_state", "shared_ocr_index.json"),
    sourceDir: "",
    layoutVersion: 1,
  }
}

export const workspace = {
  description: "Create or refresh an isolated Terra-Edu school workspace. Single-school tasks copy source materials; selection-list tasks prepare or reuse one read-only student dossier shared by all school children.",
  args: inputArg({
    action: { type: "string", enum: ["initialize", "refresh"], description: "initialize creates directories and copies source materials; refresh only updates counts" },
    sourceFolder: { type: "string", description: "Optional source student folder. Defaults to task input sourceFolder." },
  }),
  async execute(args, ctx) {
    rejectPreparationMutationForRefill(ctx, "application-agent_workspace")
    const input = args.input || {}
    const workspace = root(ctx)
    await ensureTaskIsActive(workspace)
    for (const dir of workspaceDirs) await mkdir(join(workspace, dir), { recursive: true })
    const task = await loadTask(workspace)
    const action = input.action || "initialize"
    await appendAudit(workspace, "workspace", action, "started")
    const sharedAccess = await sharedDossierAccess(task)
    if (sharedAccess) {
      if (sharedAccess.role === "reader") {
        await hydrateSharedDossier(workspace, task, sharedAccess)
        await appendLog(workspace, "agent", "已同步学生共享资料库第 " + Number(sharedAccess.state.version || 1) + " 版；本校不再重复 OCR、分类或生成学生核心档案。")
        await saveTask(workspace, task, "正在检查缺失内容", "已复用学生共享档案；本校将直接研究申请要求并进入学校独立流程。")
        await appendAudit(workspace, "workspace", action, "completed", "reused shared student dossier v" + Number(sharedAccess.state.version || 1))
        return JSON.stringify({
          status: "completed",
          reusedSharedDossier: true,
          ownerPreparation: false,
          sharedWorkspacePath: sharedAccess.shared.workspace,
          sharedProfilePath: sharedAccess.shared.profile,
          version: Number(sharedAccess.state.version || 1),
          nextSteps: ["读取共享 student_profile 和 materials_index", "抓取当前学校要求", "生成本校缺失项和顾问文档"],
          skippedSteps: ["复制原始材料", "PaddleOCR", "材料分类", "重新生成学生核心档案"],
        }, null, 2)
      }
      await writeJson(join(workspace, "03_state", "shared_dossier_snapshot.json"), {
        status: "preparing",
        ownerPreparation: true,
        reusedSharedDossier: false,
        sharedWorkspacePath: sharedAccess.shared.workspace,
        sharedMaterialsPath: sharedAccess.shared.materials,
        updatedAt: new Date().toISOString(),
      })
      await appendLog(workspace, "agent", "当前为本选校批次的资料整理负责人。原始材料已在学生共享资料库中，只会执行一次 OCR、分类和学生核心档案生成。")
      await saveTask(workspace, task, "正在读取文件", "学生共享资料库已就绪；当前任务负责一次性完成材料整理。")
      await appendAudit(workspace, "workspace", action, "completed", "shared dossier owner preparation")
      return JSON.stringify({
        status: "completed",
        reusedSharedDossier: false,
        ownerPreparation: true,
        sharedWorkspacePath: sharedAccess.shared.workspace,
        sharedMaterialsPath: sharedAccess.shared.materials,
        sharedProfilePath: sharedAccess.shared.profile,
        nextSteps: ["一次性 PaddleOCR", "一次性材料分类", "生成纯学生事实档案", "发布共享档案"],
      }, null, 2)
    }
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
    rejectPreparationMutationForRefill(ctx, "application-agent_materials")
    const workspace = root(ctx)
    await ensureTaskIsActive(workspace)
    const task = await loadTask(workspace)
    const sharedAccess = await sharedDossierAccess(task)
    const action = String(args.input?.action || "")
    const materialReview = await readJson(join(workspace, "03_state/material_review.json"), {})
    const reviewedSupplementalFolder = String(materialReview.supplementalFolder || "").trim()
    const supplementalRoot = reviewedSupplementalFolder && existsSync(reviewedSupplementalFolder)
      ? reviewedSupplementalFolder
      : join(workspace, "06_new_materials")
    const hasSupplementalMaterials = materialReview.status === "approved" && materialReview.mode === "supplement_folder" && existsSync(supplementalRoot)
    const schoolOverlay = hasSupplementalMaterials && materialReview.scope !== "student"
    await appendAudit(workspace, "materials", action, "started")
    if (sharedAccess?.role === "reader" && !hasSupplementalMaterials) {
      await hydrateSharedDossier(workspace, task, sharedAccess)
      await appendAudit(workspace, "materials", action, "completed", "preparation locked; reused shared dossier v" + Number(sharedAccess.state.version || 1))
      return JSON.stringify({
        status: "completed",
        preparationLocked: true,
        reusedSharedDossier: true,
        version: Number(sharedAccess.state.version || 1),
        message: "学生材料已经统一整理完成；当前学校不得重复 OCR、分类或改写共享档案。",
      }, null, 2)
    }
    if (action === "extract_text") {
      const ocr = join(workspace, ".opencode", "bin", "terra-ocr")
      if (!existsSync(ocr)) throw new Error("Terra-Edu bundled OCR wrapper is missing: " + ocr)
      const shared = schoolOverlay ? undefined : sharedOcrState(task)
      const localOutputDir = join(workspace, "03_state", "extracted_text")
      if (shared && existsSync(shared.indexPath) && !hasSupplementalMaterials) {
        if (shared.layoutVersion === 1) {
          await cp(shared.outputDir, localOutputDir, { recursive: true, force: false, errorOnExist: false })
        }
        const results = await readJson(shared.indexPath, [])
        await writeJson(join(workspace, "03_state", "ocr_index.json"), results)
        await appendLog(workspace, "agent", "已复用选校批次共享的 PaddleOCR 提取结果，无需重复 OCR。")
        await saveTask(workspace, task, "正在读取文件", "已复用选校批次的扫描材料 OCR 结果。")
        await appendAudit(workspace, "materials", action, "completed", "reused shared ocr " + results.length, ctx)
        return JSON.stringify({ status: "completed", reusedSharedOcr: true, completed: results.length, files: results }, null, 2)
      }
      const outputDir = shared?.outputDir || localOutputDir
      await mkdir(outputDir, { recursive: true })
      const candidates = (await listFiles(hasSupplementalMaterials ? supplementalRoot : shared?.sourceDir || join(workspace, "00_original_backup"))).filter((file) => /\.(pdf|png|jpe?g|heic|tiff?)$/i.test(file))
      const overlayOcrPath = join(workspace, "03_state", "school_ocr_overlay.json")
      const resultStore = schoolOverlay ? overlayOcrPath : shared?.indexPath || join(workspace, "03_state", "ocr_index.json")
      const previous = await readJson<Array<{ file: string; output: string; textLength: number; error: string; sourceSha256?: string }>>(resultStore, [])
      const results = [...previous]
      const ocrStartedAt = Date.now()
      const totalCandidates = candidates.length
      const etaMinutes = Math.max(1, Math.ceil((totalCandidates * 20) / 60))
      await appendLog(
        workspace,
        "agent",
        "已启动随包 PaddleOCR，正在扫描 " + totalCandidates + " 份 PDF/图片材料。批量模式优先（模型只加载一次），预计约 " + etaMinutes + "–" + (etaMinutes + 2) + " 分钟；CPU 升高属正常，请保持应用打开。",
      )
      task.ocr = {
        phase: "running",
        current: 0,
        total: totalCandidates,
        startedAt: new Date(ocrStartedAt).toISOString(),
        avgSeconds: 20,
        etaAt: new Date(ocrStartedAt + totalCandidates * 20_000).toISOString(),
      }
      await saveTask(
        workspace,
        task,
        "正在读取文件",
        "PaddleOCR 正在扫描 0/" + totalCandidates + " 份材料（预计约 " + etaMinutes + " 分钟，CPU 高属正常）。",
      )
      let processedNew = 0
      const pending = []
      for (const [index, file] of candidates.entries()) {
        const sourceSha256 = await hashFile(file)
        if (results.some((item) => item.sourceSha256 === sourceSha256)) continue
        pending.push({ index, file, sourceSha256 })
      }
      const processOne = async (item, avgHint = 20) => {
        await ensureTaskIsActive(workspace)
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - ocrStartedAt) / 1000))
        const avgSeconds = processedNew > 0 ? Math.max(1, Math.round(elapsedSeconds / processedNew)) : avgHint
        const remaining = Math.max(1, pending.length - processedNew)
        task.ocr = {
          phase: "running",
          current: item.index + 1,
          total: totalCandidates,
          startedAt: new Date(ocrStartedAt).toISOString(),
          avgSeconds,
          etaAt: new Date(Date.now() + remaining * avgSeconds * 1000).toISOString(),
        }
        await saveTask(
          workspace,
          task,
          "正在读取文件",
          "PaddleOCR 正在扫描第 " + (item.index + 1) + "/" + totalCandidates + " 份材料（约 " + avgSeconds + " 秒/份，预计剩余 " + Math.max(1, Math.ceil((remaining * avgSeconds) / 60)) + " 分钟）。",
        )
        const output = join(outputDir, item.sourceSha256 + ".txt")
        const result = await execFileAsync(ocr, [item.file], { maxBuffer: 16 * 1024 * 1024 }).then(
          ({ stdout, stderr }) => ({ text: stdout.trim(), error: stderr.trim() }),
          (error) => ({ text: "", error: error instanceof Error ? error.message : String(error) }),
        )
        if (result.text) await writeFile(output, result.text + "\n", "utf8")
        results.push({
          file: shared?.layoutVersion === 2 ? item.file : relative(workspace, item.file),
          output: shared?.layoutVersion === 2 ? output : relative(workspace, output),
          textLength: result.text.length,
          error: result.error,
          sourceSha256: item.sourceSha256,
        })
        processedNew += 1
      }
      let usedBatch = false
      if (pending.length > 1) {
        await ensureTaskIsActive(workspace)
        await saveTask(workspace, task, "正在读取文件", "PaddleOCR 批量扫描 " + pending.length + " 份材料（模型只加载一次）。")
        usedBatch = await new Promise((resolve) => {
          const child = spawn(ocr, ["--jsonl", ...pending.map((item) => item.file)])
          let lineBuffer = ""
          let chain = Promise.resolve()
          let okCount = 0
          const consumeLine = (line) => {
            const trimmed = line.trim()
            if (!trimmed) return
            chain = chain.then(async () => {
              let payload
              try { payload = JSON.parse(trimmed) } catch { return }
              const match = pending.find((item) => item.file === payload.file) || pending[Number(payload.index || 0) - 1]
              if (!match || results.some((item) => item.sourceSha256 === match.sourceSha256)) return
              const output = join(outputDir, match.sourceSha256 + ".txt")
              const text = String(payload.text || "")
              if (text) await writeFile(output, text + "\n", "utf8")
              results.push({
                file: shared?.layoutVersion === 2 ? match.file : relative(workspace, match.file),
                output: shared?.layoutVersion === 2 ? output : relative(workspace, output),
                textLength: text.length,
                error: String(payload.error || ""),
                sourceSha256: match.sourceSha256,
              })
              processedNew += 1
              okCount += 1
              const avgSeconds = Math.max(1, Math.round((Date.now() - ocrStartedAt) / 1000 / Math.max(1, processedNew)))
              task.ocr = {
                phase: "running",
                current: Math.min(totalCandidates, match.index + 1),
                total: totalCandidates,
                startedAt: new Date(ocrStartedAt).toISOString(),
                avgSeconds,
                etaAt: new Date(Date.now() + Math.max(0, pending.length - okCount) * avgSeconds * 1000).toISOString(),
              }
              await saveTask(workspace, task, "正在读取文件", "PaddleOCR 批量进度 " + okCount + "/" + pending.length + "（约 " + avgSeconds + " 秒/份）。")
            })
          }
          child.stdout.on("data", (chunk) => {
            lineBuffer += String(chunk)
            const parts = lineBuffer.split(/\r?\n/)
            lineBuffer = parts.pop() || ""
            for (const line of parts) consumeLine(line)
          })
          child.on("error", () => resolve(false))
          child.on("close", async (code) => {
            if (lineBuffer.trim()) consumeLine(lineBuffer)
            try { await chain } catch { resolve(false); return }
            const complete = pending.every((item) => results.some((result) => result.sourceSha256 === item.sourceSha256))
            resolve(code === 0 && complete)
          })
        })
      }
      if (!usedBatch) {
        for (const item of pending) {
          if (results.some((result) => result.sourceSha256 === item.sourceSha256)) continue
          await processOne(item, pending.length > 1 ? 35 : 20)
        }
      }
      await writeJson(resultStore, results)
      const baseResults = schoolOverlay && sharedAccess ? await readJson(sharedAccess.shared.ocrIndex, []) : []
      const schoolOcrOverlay = !schoolOverlay ? await readJson(join(workspace, "03_state", "school_ocr_overlay.json"), []) : []
      const combinedResults = schoolOverlay ? [...baseResults, ...results] : [...results, ...schoolOcrOverlay]
      await writeJson(join(workspace, "03_state", "ocr_index.json"), combinedResults)
      if (schoolOverlay) {
        await writeJson(join(workspace, "03_state", "material_review.json"), {
          ...materialReview,
          ocrAppliedSourceHashes: results.map((item) => item.sourceSha256).filter(Boolean),
          ocrAppliedAt: new Date().toISOString(),
        })
      }
      const completed = combinedResults.filter((result: any) => result.textLength > 0)
      const failed = combinedResults.filter((result: any) => result.error || result.textLength === 0)
      task.ocr = {
        phase: "done",
        current: totalCandidates,
        total: totalCandidates,
        startedAt: new Date(ocrStartedAt).toISOString(),
        avgSeconds: processedNew > 0 ? Math.max(1, Math.round((Date.now() - ocrStartedAt) / 1000 / processedNew)) : 35,
        etaAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      }
      await appendLog(workspace, "agent", "已使用随包 PaddleOCR 提取或复用 " + completed.length + "/" + combinedResults.length + " 份扫描材料文字。")
      await saveTask(workspace, task, "正在读取文件", "已完成扫描材料 OCR：成功 " + completed.length + " 份，失败或无文字 " + failed.length + " 份。")
      await appendAudit(workspace, "materials", action, "completed", "ocr " + completed.length + "/" + combinedResults.length)
      return JSON.stringify({ status: "completed", completed: completed.length, failed: failed.length, files: combinedResults }, null, 2)
    }

    if (sharedAccess?.role === "owner" && existsSync(sharedAccess.shared.materialsIndex) && !hasSupplementalMaterials) {
      const records = await readJson(sharedAccess.shared.materialsIndex, [])
      await writeJson(join(workspace, "03_state/materials_index.json"), records)
      if (existsSync(join(sharedAccess.shared.generated, "materials_index.md"))) {
        await cp(join(sharedAccess.shared.generated, "materials_index.md"), join(workspace, "02_generated/materials_index.md"), { force: true })
      }
      await saveTask(workspace, task, "正在生成学生资料", "已复用当前学生资料库中已完成的材料分类结果。")
      await appendAudit(workspace, "materials", action, "completed", "reused owner classification " + records.length)
      return JSON.stringify({ status: "completed", reusedSharedClassification: true, files: records.length }, null, 2)
    }

    const sharedMaterialsRoot = sharedAccess?.shared.materials || join(workspace, "00_original_backup")
    const files = (
      await Promise.all(
        (hasSupplementalMaterials ? [supplementalRoot] : [sharedMaterialsRoot]).filter(existsSync).map((directory) => listFiles(directory)),
      )
    ).flat()
    const overlayIndexPath = join(workspace, "03_state", "school_materials_overlay.json")
    const baseRecords = schoolOverlay && sharedAccess ? await readJson(sharedAccess.shared.materialsIndex, []) : []
    const records = schoolOverlay
      ? await readJson(overlayIndexPath, [])
      : hasSupplementalMaterials && sharedAccess
        ? await readJson(sharedAccess.shared.materialsIndex, [])
        : []
    for (const file of files) {
      const fileName = basename(file)
      const sourceSha256 = await hashFile(file)
      if (records.some((item: any) => item.sourceSha256 === sourceSha256 || resolve(String(item.originalPath || "")) === resolve(file))) continue
      const [category, reason] = categoryFor(fileName)
      const targetDir = join(schoolOverlay ? join(workspace, "01_classified_materials") : sharedAccess?.shared.classified || join(workspace, "01_classified_materials"), category)
      await mkdir(targetDir, { recursive: true })
      const target = hasSupplementalMaterials
        ? join(targetDir, sourceSha256.slice(0, 12) + "-" + fileName)
        : await uniquePath(join(targetDir, fileName))
      if (!existsSync(target)) await cp(file, target, { force: false, errorOnExist: false })
      records.push({
        originalPath: file,
        backupPath: schoolOverlay ? relative(workspace, file) : sharedAccess ? file : relative(workspace, file),
        classifiedPath: schoolOverlay ? relative(workspace, target) : sharedAccess ? target : relative(workspace, target),
        fileName,
        sourceSha256,
        extension: extname(fileName).toLowerCase(),
        category,
        confidence: category === "needs_review" ? "needs_review" : category === "other" ? "medium" : "high",
        reason,
      })
    }
    const existingSchoolOverlay = !schoolOverlay ? await readJson(overlayIndexPath, []) : []
    const combinedRecords = schoolOverlay ? [...baseRecords, ...records] : [...records, ...existingSchoolOverlay]
    await writeJson(join(workspace, "03_state/materials_index.json"), combinedRecords)
    if (schoolOverlay) await writeJson(overlayIndexPath, records)
    if (sharedAccess && !schoolOverlay) await writeJson(sharedAccess.shared.materialsIndex, records)
    const md = ["# 材料目录", "", "学生共享原始材料目录：" + sharedMaterialsRoot, ""]
    for (const item of combinedRecords) md.push("- " + item.fileName + " -> " + item.classifiedPath + "（" + item.category + "，" + item.reason + "）")
    await writeFile(join(workspace, "02_generated/materials_index.md"), md.join("\n") + "\n", "utf8")
    if (sharedAccess && !schoolOverlay) {
      const sharedMd = ["# 材料目录", "", "学生共享原始材料目录：" + sharedMaterialsRoot, ""]
      for (const item of records) sharedMd.push("- " + item.fileName + " -> " + item.classifiedPath + "（" + item.category + "，" + item.reason + "）")
      await writeFile(join(sharedAccess.shared.generated, "materials_index.md"), sharedMd.join("\n") + "\n", "utf8")
    }
    if (hasSupplementalMaterials) {
      const appliedSourceHashes = records.map((item: any) => String(item.sourceSha256 || "")).filter(Boolean)
      const expectedSourceHashes = Array.isArray(materialReview.sourceManifest)
        ? materialReview.sourceManifest.map((item: any) => String(item?.sha256 || "")).filter(Boolean)
        : []
      await writeJson(join(workspace, "03_state", "material_review.json"), {
        ...materialReview,
        appliedSourceHashes,
        appliedAt: expectedSourceHashes.length > 0 && expectedSourceHashes.every((hash: string) => appliedSourceHashes.includes(hash))
          ? new Date().toISOString()
          : undefined,
      })
    }
    await appendLog(workspace, "agent", "已完成材料分类或复用，共 " + combinedRecords.length + " 个文件。")
    await saveTask(workspace, task, "正在生成学生资料", "材料已分类完成，materials_index 已更新。")
    await appendAudit(workspace, "materials", action, "completed", "classified " + combinedRecords.length + " files")
    return "已分类或复用 " + combinedRecords.length + " 个文件。无法确认用途的文件会留在 needs_review。"
  },
}

export const state = {
  description: "Update Terra-Edu task_state.json using the unified desktop schema, including status, progress, generated files, and missing item counts.",
  args: inputArg({
    status: { type: "string", enum: statusValues, description: "Current task status" },
    message: { type: "string", description: "Human-readable progress message for the consultant" },
  }, ["status", "message"]),
  async execute(args, ctx) {
    rejectPreparationMutationForRefill(ctx, "application-agent_state")
    const input = args.input || {}
    const workspace = root(ctx)
    await ensureTaskIsActive(workspace)
    const task = await loadTask(workspace)
    await appendAudit(workspace, "state", String(input.status || "update"), "started", input.message || "")
    const progress = ensureCuaProgress(await readJson(join(workspace, "03_state/application_progress.json"), {}))
    const materialReview = await readJson(join(workspace, "03_state/material_review.json"), {})
    // Keep the desktop material-review panel sticky until the consultant clicks it.
    if (materialReview.status === "pending" && input.status && input.status !== "等待顾问确认材料" && input.status !== "已暂停") {
      await appendAudit(workspace, "state", String(input.status), "failed", "material review still pending", ctx)
      throw new Error("MATERIAL_REVIEW_PANEL_REQUIRED: 材料确认面板仍在等待顾问点击，不能把状态改成 " + input.status + "。请保持“等待顾问确认材料”，并提醒顾问使用桌面确认面板。")
    }
    if (input.status === "阶段性完成" && progress.egoBrowser?.preparedAt && !progress.egoBrowser?.completedAt) {
      await appendAudit(workspace, "state", String(input.status), "failed", "browser completion without successful complete_ego_task", ctx)
      throw new Error("BROWSER_COMPLETION_GATE_REQUIRED: ego-browser 已启动，但 complete_ego_task 尚未通过最新保存、页面/frame 观察、必填项和控制权门槛。不得仅凭历史 record_save_verified 把阶段标记为完成。")
    }
    const nextStatus = materialReview.status === "pending" ? "等待顾问确认材料" : input.status
    await saveTask(workspace, task, nextStatus, input.message)
    if (materialReview.status === "approved") await stampMaterialReviewPreparationComplete(workspace, materialReview)
    await appendLog(workspace, "agent", input.message)
    await appendAudit(workspace, "state", String(nextStatus || "update"), "completed", input.message || "")
    return "状态已更新：" + nextStatus
  },
}

export const documents = {
  description: "Generate consultant/student-facing forms, Word missing-material checklist, and task summary from 03_state/missing_items.json.",
  args: inputArg({
    action: { type: "string", enum: ["generate_forms", "generate_word", "generate_summary", "generate_all"], description: "Which document set to generate" },
  }),
  async execute(args, ctx) {
    rejectPreparationMutationForRefill(ctx, "application-agent_documents")
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
      const lines = [
        "# " + title + " 申请任务总结",
        "",
        "## 已完成",
        "",
        "- 已创建学校隔离申请工作区。",
        sharedStudentDossier(task)
          ? "- 已只读复用学生共享资料库；本校没有重复 OCR、分类或生成学生核心档案。"
          : "- 已复制原始材料副本，未修改原始文件夹。",
        "- 已整理或复用材料 " + materials.length + " 个。",
        "- 已生成或更新本校缺失项清单和顾问可转发文档。",
        "",
        "## 仍需处理",
        "",
      ]
      if (missing.length === 0) lines.push("- 暂无仍需补充的缺失项。")
      for (const item of missing) lines.push("- " + item.name + "：" + item.whyNeeded)
      lines.push("", "## 人工处理事项", "", "- 最终提交申请、付款、不可逆推荐信邀请和账号密码输入必须由顾问人工确认。")
      await writeFile(join(workspace, "02_generated/task_summary.md"), lines.join("\n") + "\n", "utf8")
    }
    const materialReview = await readJson(join(workspace, "03_state/material_review.json"), {})
    const reviewComplete = materialReview.status === "approved" && await materialReviewPreparationComplete(workspace, materialReview)
    let sharedPublication: Awaited<ReturnType<typeof publishSharedDossier>> | Awaited<ReturnType<typeof finalizePreparedSharedDossier>> | undefined
    let publishWarning = ""
    try {
      sharedPublication = materialReview.status !== "approved"
        ? await publishSharedDossier(workspace, task, false)
        : reviewComplete && materialReview.scope === "student"
          ? await publishSharedDossier(workspace, task, true)
          : reviewComplete
            ? await finalizePreparedSharedDossier(workspace, task)
            : undefined
    } catch (error) {
      // Document generation already succeeded above; do not swallow that success into a tool failure.
      publishWarning = error instanceof Error ? error.message : String(error)
    }
    let reviewAfterDocs = materialReview
    if (materialReview.status === "approved") {
      reviewAfterDocs = await stampMaterialReviewPreparationComplete(workspace, {
        ...materialReview,
        noteAppliedAt: materialReview.noteAppliedAt || new Date().toISOString(),
      })
    }
    const reviewCompleteAfter = reviewAfterDocs.status === "approved" && await materialReviewPreparationComplete(workspace, reviewAfterDocs)
    // Never clear an existing approved review back to pending. Sticky pending only when never approved.
    const needsMaterialReview = !progress.egoBrowser?.preparedAt && reviewAfterDocs.status !== "approved"
    const reviewAwaitingApplication = reviewAfterDocs.status === "approved" && !reviewCompleteAfter
    if (needsMaterialReview) {
      const previousPending = reviewAfterDocs.status === "pending" ? reviewAfterDocs : {}
      await writeJson(join(workspace, "03_state/material_review.json"), {
        ...previousPending,
        status: "pending",
        requestedAt: previousPending.requestedAt || new Date().toISOString(),
        summary: "材料、缺失项和顾问文档已生成。等待顾问决定补充文件夹、文字补充或暂不补充。",
        updatedAt: new Date().toISOString(),
      })
    }
    await appendLog(workspace, "agent", "已根据 missing_items.json 生成申请文档。")
    await saveTask(
      workspace,
      task,
      needsMaterialReview ? "等待顾问确认材料" : reviewAwaitingApplication ? "正在检查缺失内容" : !progress.egoBrowser?.preparedAt ? "可继续申请" : missing.some((item: any) => item.blocksProgress) ? "等待补充材料" : progress.egoBrowser?.completedAt ? "阶段性完成" : "正在填写申请平台",
      needsMaterialReview
        ? "材料整理、缺失项和阶段总结已完成。请在申请 Agent 的材料确认面板决定是否补充，再进入浏览器。"
        : reviewAwaitingApplication
          ? "补充内容尚未通过应用校验，暂不启动浏览器。"
          : publishWarning
            ? "已生成信息表、材料表、Word 缺失清单和阶段总结；共享档案发布未成功：" + publishWarning
            : "已生成信息表、材料表、Word 缺失清单和阶段总结。",
    )
    await appendAudit(
      workspace,
      "documents",
      action,
      "completed",
      publishWarning
        ? "generated documents; shared dossier publish warning: " + publishWarning
        : sharedPublication
          ? materialReview.status === "approved"
            ? "generated school documents and published shared student dossier"
            : "generated school documents and prepared shared student dossier for consultant review"
          : "generated documents from missing_items.json",
    )
    return JSON.stringify({
      status: "completed",
      documentsGenerated: true,
      publishOk: !publishWarning,
      publishWarning: publishWarning || undefined,
      sharedPublication: sharedPublication || undefined,
      message: needsMaterialReview
        ? "文档已生成到 02_generated，任务已停在材料确认关口。请等待顾问在桌面应用选择补充文件夹、填写文字补充或确认暂不补充；不要启动 ego-browser。"
        : publishWarning
          ? "文档已生成到 02_generated，但共享档案发布失败：" + publishWarning + "。请顾问修复共享档案后再进入后续学校。"
          : "文档已生成到 02_generated。Word 清单基于 03_state/missing_items.json。",
    }, null, 2)
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
    rejectPreparationMutationForRefill(ctx, "application-agent_runtime")
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
    rejectPreparationMutationForRefill(ctx, "application-agent_requirements")
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

export const cua = {
  description: "Coordinate ego-browser / ego lite application-platform filling. This tool does not directly control Chrome or call cua-driver. Use the official ego-browser skill for browser actions, then call this tool to record task space, observations, verified fields, verified saves, uploads, blockers, failures, and audit state.",
  args: inputArg({
    action: { type: "string", enum: ["prepare_ego_task", "resume_ego", "retire_and_rebind_ego_task", "record_observation", "record_field_verified", "record_select_verified", "record_dynamic_form_verified", "begin_save_attempt", "record_save_verified", "record_blocker", "handoff_to_consultant", "complete_ego_task", "record_browser_safety_stop", "resolve_browser_safety_stop", "record_failure", "record_saved", "record_upload", "block_high_risk"], description: "ego-browser coordination action. Browser control itself must be done through the official ego-browser skill, not this tool." },
    applicationUrl: { type: "string", description: "Application platform URL, defaults to task input." },
    taskSpaceName: { type: "string", description: "ego-browser task space name for this application task." },
    taskSpaceId: { type: "string", description: "String form of the numeric ego-browser task.id returned by useOrCreateTaskSpace." },
    taskSpaceObservedName: { type: "string", description: "Exact task-space name returned by listTaskSpaces after the fresh space was created." },
    taskSpaceOwnership: { type: "string", enum: ["agent", "agentDelegatedToUser", "user"], description: "Exact ownership returned by listTaskSpaces for taskSpaceId." },
    replacementTaskSpaceId: { type: "string", description: "For retire_and_rebind_ego_task only: consultant-selected or newly created replacement numeric task-space ID." },
    rebindMode: { type: "string", enum: ["existing", "new"], description: "For retire_and_rebind_ego_task only: reuse a consultant-selected existing space or create a new replacement after explicit confirmation." },
    missingTaskSpaceConfirmed: { type: "boolean", description: "For retire_and_rebind_ego_task only: true only after listTaskSpaces proved the saved numeric ID no longer exists." },
    currentUrl: { type: "string", description: "Top-level current URL reported by the most recent unobstructed ego-browser pageInfo. Never pass an iframe dialog URL here." },
    dialogUrl: { type: "string", description: "For record_blocker only: the native dialog source URL from pageInfo().dialog.url, which may be an iframe URL." },
    dialogFrameId: { type: "string", description: "For record_blocker only: the native dialog frameId from pageInfo().dialog.frameId." },
    pageTitle: { type: "string", description: "Current page title reported by ego-browser pageInfo or snapshot." },
    frameId: { type: "string", description: "CDP frameId of the frame that contains the active application form; use the main frame when the form is not in an iframe." },
    loaderId: { type: "string", description: "Current CDP loaderId of frameId from Page.getFrameTree." },
    frameUrl: { type: "string", description: "Current URL of frameId. This may differ from currentUrl when the form lives in an iframe." },
    fieldLabel: { type: "string", description: "Human-readable field label, such as State, Institution, Current Title." },
    text: { type: "string", description: "Field value, selected option, page summary, or observation text." },
    expectedText: { type: "string", description: "Expected visible value after ego-browser verification." },
    optionLabel: { type: "string", description: "Selected option label for record_select_verified." },
    optionValue: { type: "string", description: "Selected option value for record_select_verified." },
    evidence: { type: "string", description: "Short verification evidence from snapshotText/pageInfo/screenshot/readback." },
    interactionMethod: { type: "string", description: "Real interaction chain used for field/select verification, such as fillInput+Tab+readback, cdp-key-events+Tab+readback, or click+snapshot+click-option+reobserve." },
    readbackValue: { type: "string", description: "Fresh visible/accessibility readback after the interaction or save." },
    remainingRequiredFields: { type: "array", items: { type: "string" }, description: "Required for record_dynamic_form_verified, including [] when the dynamic-form rescan found no visible empty required fields." },
    confirmed: { type: "boolean", description: "Required true for record_save_verified and complete_ego_task after their independent evidence gates pass." },
    completionDisposition: { type: "string", enum: ["automation_complete", "manual_boundary_reached"], description: "Required for complete_ego_task: all automatable sections are complete, or the next step is an explicitly documented manual/high-risk boundary." },
    saveAttemptId: { type: "string", description: "ID returned by begin_save_attempt and required by record_save_verified." },
    networkEvidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        taskSpaceId: { type: "string", description: "Task-space ID used for both network events." },
        sourceUrl: { type: "string", description: "Save attempt source page origin+pathname only; query and hash are forbidden." },
        sourceTitle: { type: "string", description: "Save attempt source page title." },
        sourceFrameId: { type: "string", description: "Source form frameId frozen by begin_save_attempt." },
        sourceLoaderId: { type: "string", description: "Source form loaderId frozen by begin_save_attempt." },
        sourceFrameUrl: { type: "string", description: "Source form-frame origin+pathname only; query and hash are forbidden." },
        actionStartedAt: { type: "string", description: "ISO timestamp recorded immediately before the one real save action." },
        eventsDrainedAt: { type: "string", description: "ISO timestamp recorded after the bounded post-action event drain." },
        request: {
          type: "object",
          additionalProperties: false,
          properties: {
            requestId: { type: "string", description: "CDP requestId from Network.requestWillBeSent." },
            method: { type: "string", description: "HTTP method from Network.requestWillBeSent." },
            url: { type: "string", description: "Request origin+pathname only; query and hash are forbidden." },
            observedAt: { type: "string", description: "ISO timestamp when the request event was observed." },
            frameId: { type: "string", description: "CDP frameId from Network.requestWillBeSent." },
            loaderId: { type: "string", description: "CDP loaderId from Network.requestWillBeSent." },
          },
          required: ["requestId", "method", "url", "observedAt", "frameId", "loaderId"],
        },
        response: {
          type: "object",
          additionalProperties: false,
          properties: {
            requestId: { type: "string", description: "CDP requestId from Network.responseReceived; must equal request.requestId." },
            status: { type: "number", description: "Observed final response status." },
            url: { type: "string", description: "Response or final redirect origin+pathname only; query and hash are forbidden." },
            resourceType: { type: "string", enum: ["xhr", "fetch", "document"], description: "Normalized Network.responseReceived resource type." },
            observedAt: { type: "string", description: "ISO timestamp when the response event was observed." },
            frameId: { type: "string", description: "Optional CDP frameId from Network.responseReceived. Omit when the event does not provide it; when present it must match the same requestId's request frameId." },
            loaderId: { type: "string", description: "Optional CDP loaderId from Network.responseReceived. Omit when the compact event does not provide it; when present it must match the same requestId's request loaderId." },
            redirected: { type: "boolean", description: "Required true when an intervening requestWillBeSent carried redirectResponse for this same document requestId before the final 2xx response." },
          },
          required: ["requestId", "status", "url", "resourceType", "observedAt"],
        },
      },
      required: ["taskSpaceId", "sourceUrl", "sourceTitle", "sourceFrameId", "sourceLoaderId", "sourceFrameUrl", "actionStartedAt", "eventsDrainedAt", "request", "response"],
      description: "Compact source page/frame/loader, save-action window, and request/response evidence for record_save_verified. Headers, body, postData, cookies, query, and hash are not accepted.",
    },
    safetyKind: { type: "string", enum: ["cleanup_failed", "alert_evidence_lost"], description: "For record_browser_safety_stop / resolve_browser_safety_stop: structured hard-stop kind bound to taskSpaceId." },
    decisionId: { type: "string", description: "For resolve_browser_safety_stop: the decisionId returned when the safety stop was recorded." },
    safetyEvidence: { type: "object", description: "Optional structured evidence for record_browser_safety_stop (cleanupError, capturedAlerts, topLevelAlerts, info)." },
    safetyResolution: { type: "string", enum: ["consultant_continue_same_space", "consultant_refill"], description: "For resolve_browser_safety_stop only. consultant_continue_same_space requires a prior desktop authorization; cleanup_failed cannot continue the same space." },
    consultantConfirmed: { type: "boolean", description: "Required true after the consultant explicitly chose to resume a handed-off task space, or to resolve an old workspace that has no saved taskSpaceId. Alone it never clears browser safetyStop." },
    blockerDisposition: { type: "string", enum: ["resolved", "handoff"], description: "Required for record_blocker: resolved after a safe dialog response, or handoff after control was given to the consultant." },
    handoffType: { type: "string", enum: ["login", "browser_takeover"], description: "For handoff_to_consultant: login only for an observed login/authentication need; browser_takeover for dialogs, user takeover, or other manual intervention." },
    controlLossKind: { type: "string", enum: ["deliberate_handoff", "unexpected_control_loss"], description: "Whether the Agent deliberately completed handOffTaskSpace(done:true), or Ego unexpectedly reported user/inactive/not-assigned control loss." },
    detail: { type: "string", description: "Operation detail, failure reason, saved page, upload material, or high-risk action" },
  }, ["action"]),
  async execute(args, ctx) {
    const input = args.input || {}
    const workspace = root(ctx)
    const task = await loadTask(workspace)
    const progress = await readJson(join(workspace, "03_state/application_progress.json"), { currentPage: "", completedPages: [], savedPages: [], uploadedMaterials: [], failedActions: [], highRiskBlocks: [] })
    const auditAction = String(input.action || "unknown")
    const activeRefillSessionID = String(progress.refillAttempt?.sessionID || "").trim()
    if (progress.refillAttempt && (!activeRefillSessionID || ctx?.sessionID !== activeRefillSessionID)) {
      const error = "REFILL_SESSION_MISMATCH: 当前学校已经切换到全新的重新填写对话；旧对话或其他子代理不得再操作本次浏览器状态。"
      await appendAudit(workspace, "cua", auditAction, "failed", error, ctx)
      throw new Error(error)
    }
    await appendAudit(workspace, "cua", auditAction, "started", input.detail || "")
    if (progress.egoBrowser?.completionHelperFailedAt) {
      const error = "BROWSER_TASK_FINALIZATION_FAILED: 最终 completeTaskSpace helper 回合已经失败，当前会话的浏览器任务已终态锁定，禁止继续观察、填写、保存、接管、重绑或完成。请顾问点击“重新填写”创建全新对话和 task space。"
      await appendAudit(workspace, "cua", auditAction, "failed", error, ctx)
      return error
    }
    if (progress.egoBrowser?.completedAt) {
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const savedTaskSpaceId = numericTaskSpaceId(progress.egoBrowser.taskSpaceId)
      const detail = String(input.detail || "").trim()
      const finalHelperFailure =
        input.action === "record_failure" &&
        taskSpaceId === savedTaskSpaceId &&
        detail.startsWith("TERRA_EGO_COMPLETION_HELPER_FAILED:")
      if (!finalHelperFailure) {
        const error = "BROWSER_TASK_ALREADY_COMPLETED: 当前浏览器任务已完成，禁止继续观察、填写、保存、阻塞、接管或重绑。需要再次填写时，请顾问点击“重新填写”创建全新对话和 task space。只有紧随 complete_ego_task 的独立 completeTaskSpace(..., { keep: true }) helper 回合真实失败时，才可用相同 taskSpaceId 调用 record_failure，并以 TERRA_EGO_COMPLETION_HELPER_FAILED: 开头原样记录错误。"
        await appendAudit(workspace, "cua", auditAction, "failed", error, ctx)
        return error
      }
      const failedAt = new Date().toISOString()
      appendLimited(progress, "completionFailures", {
        failedAt,
        taskSpaceId: savedTaskSpaceId,
        detail,
        archivedCompletion: {
          completedAt: progress.egoBrowser.completedAt,
          completionDetail: progress.egoBrowser.completionDetail || "",
          completionDisposition: progress.egoBrowser.completionDisposition || "",
          completionObservation: progress.egoBrowser.completionObservation || null,
        },
      })
      appendLimited(progress, "failedActions", { at: failedAt, action: auditAction, reason: detail, page: progress.currentPage || "" })
      progress.egoBrowser.completionHelperFailedAt = failedAt
      progress.egoBrowser.completionHelperFailureDetail = detail
      delete progress.egoBrowser.completedAt
      delete progress.egoBrowser.completionDetail
      delete progress.egoBrowser.completionDisposition
      delete progress.egoBrowser.completionObservation
      await writeAtomicJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "已归档并撤销未完成的 Ego task-space 终态：" + detail)
      await saveTask(workspace, task, "异常中断", "最终 completeTaskSpace helper 回合失败；已原子归档并撤销阶段完成状态。需要继续时请由顾问点击“重新填写”。")
      await appendAudit(workspace, "cua", auditAction, "failed", detail, ctx)
      return "BROWSER_COMPLETION_FINALIZATION_FAILED_RECORDED: 已归档并撤销假完成状态。不得在当前会话重试或继续浏览器动作；请顾问点击“重新填写”。"
    }
    if (![
      "record_observation",
      "record_field_verified",
      "record_select_verified",
      "record_dynamic_form_verified",
      "record_save_verified",
      "record_blocker",
      "handoff_to_consultant",
      "record_browser_safety_stop",
      "resolve_browser_safety_stop",
      "record_failure",
      "record_saved",
      "record_upload",
      "block_high_risk",
    ].includes(input.action)) await ensureTaskIsActive(workspace)
    const safetyRecordAction = input.action === "record_browser_safety_stop" || (input.action === "record_failure" && safetyKindFromFailureDetail(String(input.detail || "").trim()))
    const safetyResolveAction = input.action === "resolve_browser_safety_stop"
    const safetyGate = browserSafetyGateError(progress, {
      allowObservation: input.action === "record_observation",
      allowSafetyRecord: Boolean(safetyRecordAction),
      allowSafetyResolve: safetyResolveAction,
    })
    if (safetyGate && !safetyRecordAction && !safetyResolveAction) {
      await appendAudit(workspace, "cua", auditAction, "failed", safetyGate, ctx)
      return safetyGate
    }
    if (input.action === "block_high_risk") {
      return await risk.execute({ input: { action: input.detail || "high risk application action", page: progress.currentPage || "" } }, ctx as any)
    }
    if (input.action === "record_browser_safety_stop") {
      ensureCuaProgress(progress)
      const kind = input.safetyKind === "cleanup_failed" || input.safetyKind === "alert_evidence_lost" ? input.safetyKind : ""
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const evidence = input.safetyEvidence && typeof input.safetyEvidence === "object" ? input.safetyEvidence : (input.evidence || input.text || input.detail || null)
      const detail = String(input.detail || "").trim()
      const auditError =
        (!kind ? "BROWSER_SAFETY_KIND_REQUIRED: safetyKind must be cleanup_failed or alert_evidence_lost." : "") ||
        browserAuditError(auditAction, { taskSpaceId }) ||
        requireNumericTaskSpaceId(taskSpaceId) ||
        (numericTaskSpaceId(progress.egoBrowser?.taskSpaceId) && numericTaskSpaceId(progress.egoBrowser?.taskSpaceId) !== taskSpaceId
          ? "BROWSER_TASK_SPACE_MISMATCH: safety stop taskSpaceId does not match the saved ego-browser task space."
          : "")
      if (auditError) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: auditAction, reason: auditError, page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendAudit(workspace, "cua", auditAction, "failed", auditError, ctx)
        return auditError
      }
      const safetyStop = applyBrowserSafetyStop(progress, { kind, taskSpaceId, evidence, detail })
      appendLimited(progress, "failedActions", {
        at: safetyStop.recordedAt,
        action: auditAction,
        reason: browserSafetyMarker(kind) + ": " + (detail || kind),
        page: progress.currentPage || "",
        taskSpaceId,
        decisionId: safetyStop.decisionId,
      })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      const message = kind === "cleanup_failed"
        ? "浏览器 task space 已标记为污染（cleanup_failed）。所有浏览器动作已被 CUA 与 wrapper 阻断；只能由顾问点击“重新填写”创建新空间。"
        : "浏览器已进入 alert 证据丢失硬停止。所有浏览器动作已被阻断；顾问可在桌面选择“查看后继续当前空间”或“重新填写”。"
      await appendLog(workspace, "cua", message + " decisionId=" + safetyStop.decisionId)
      await saveTask(workspace, task, "异常中断", message)
      await appendAudit(workspace, "cua", auditAction, "completed", kind + " " + taskSpaceId + " " + safetyStop.decisionId, ctx)
      return JSON.stringify({
        recorded: true,
        marker: browserSafetyMarker(kind),
        safetyStop,
        next: kind === "cleanup_failed"
          ? "Do not resume, takeOver, rebind existing, fill, save, or complete this taskSpaceId. Ask the consultant to click 重新填写."
          : "Do not continue browser actions. The consultant must authorize continue on the desktop (decisionId must match) or click 重新填写. consultantConfirmed alone is rejected.",
      }, null, 2)
    }
    if (input.action === "resolve_browser_safety_stop") {
      ensureCuaProgress(progress)
      const stop = browserSafetyStop(progress)
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const decisionId = String(input.decisionId || "").trim()
      const resolution = String(input.safetyResolution || "").trim()
      if (!stop) {
        const error = "BROWSER_SAFETY_STOP_REQUIRED: no browser safetyStop is recorded for this school workspace."
        await appendAudit(workspace, "cua", auditAction, "failed", error, ctx)
        return error
      }
      if (stop.kind === "cleanup_failed" || resolution === "consultant_refill") {
        const error = stop.kind === "cleanup_failed"
          ? "TERRA_EGO_TASKSPACE_CONTAMINATED: cleanup_failed cannot be resolved for the same task space. Only consultant refill can archive it and bind a new taskSpaceId."
          : "BROWSER_SAFETY_REFILL_REQUIRED: choose the desktop 重新填写 action; resolve_browser_safety_stop does not create a replacement space."
        await appendAudit(workspace, "cua", auditAction, "failed", error, ctx)
        return error
      }
      if (stop.kind !== "alert_evidence_lost") {
        const error = "BROWSER_SAFETY_KIND_UNSUPPORTED: only alert_evidence_lost can continue the same task space."
        await appendAudit(workspace, "cua", auditAction, "failed", error, ctx)
        return error
      }
      if (String(stop.taskSpaceId) !== taskSpaceId) {
        const error = "BROWSER_TASK_SPACE_MISMATCH: resolve taskSpaceId does not match the active safetyStop."
        await appendAudit(workspace, "cua", auditAction, "failed", error, ctx)
        return error
      }
      if (!decisionId || String(stop.decisionId || "") !== decisionId) {
        const error = "BROWSER_SAFETY_DECISION_MISMATCH: decisionId does not match the recorded safetyStop decision."
        await appendAudit(workspace, "cua", auditAction, "failed", error, ctx)
        return error
      }
      if (resolution !== "consultant_continue_same_space") {
        const error = "BROWSER_SAFETY_RESOLUTION_REQUIRED: safetyResolution must be consultant_continue_same_space after desktop authorization, or use refill."
        await appendAudit(workspace, "cua", auditAction, "failed", error, ctx)
        return error
      }
      const desktop = stop.desktopAuthorization
      if (!desktop || desktop.authorizedBy !== "consultant_desktop_continue" || String(desktop.decisionId || "") !== decisionId || String(desktop.taskSpaceId || "") !== taskSpaceId || !desktop.authorizedAt) {
        const error = "BROWSER_SAFETY_DESKTOP_AUTHORIZATION_REQUIRED: alert_evidence_lost continue requires a one-time desktop authorization matching taskSpaceId and decisionId. consultantConfirmed:true is not accepted."
        await appendAudit(workspace, "cua", auditAction, "failed", error, ctx)
        return error
      }
      if (stop.active !== true && stop.observationRequired === true && stop.resolution === "consultant_continue_same_space") {
        await appendAudit(workspace, "cua", auditAction, "completed", "already authorized observation-required", ctx)
        return "BROWSER_SAFETY_OBSERVATION_REQUIRED: desktop already authorized continue. Next heredoc may only observe with pageInfo/list/snapshot, then record_observation for taskSpaceId " + taskSpaceId + "."
      }
      if (stop.active !== true) {
        const error = "BROWSER_SAFETY_STOP_INACTIVE: this safetyStop is no longer active."
        await appendAudit(workspace, "cua", auditAction, "failed", error, ctx)
        return error
      }
      if (stop.decisionConsumedAt) {
        const error = "BROWSER_SAFETY_DECISION_ALREADY_CONSUMED: this decisionId was already used."
        await appendAudit(workspace, "cua", auditAction, "failed", error, ctx)
        return error
      }
      const resolvedAt = new Date().toISOString()
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceId,
        safetyStop: {
          ...stop,
          active: false,
          observationRequired: true,
          resolution: "consultant_continue_same_space",
          resolvedAt,
          resumeAuthorizedAt: desktop.authorizedAt,
          resumeAuthorizedBy: "consultant_desktop_continue",
          decisionConsumedAt: resolvedAt,
        },
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "顾问桌面已授权 alert_evidence_lost 同空间继续，等待首次观察：" + taskSpaceId)
      await saveTask(workspace, task, "正在填写申请平台", "顾问已授权在当前 task space 继续；下一回合只能观察，不得填写或保存。")
      await appendAudit(workspace, "cua", auditAction, "completed", "authorized continue same space " + decisionId, ctx)
      return "BROWSER_SAFETY_OBSERVATION_REQUIRED: consultant desktop authorization accepted. Next heredoc may only observe with pageInfo/list/snapshot for taskSpaceId " + taskSpaceId + ", then call record_observation. Filling, saving, complete, and takeOver remain blocked until that observation succeeds."
    }
    if (input.action === "resume_ego") {
      ensureCuaProgress(progress)
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const savedTaskSpaceId = numericTaskSpaceId(progress.egoBrowser?.taskSpaceId)
      const auditError =
        browserSafetyGateError(progress) ||
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
        handoffPending: true,
        takeoverPending: true,
        resumeAuthorizedAt: new Date().toISOString(),
        resumedAt: undefined,
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "顾问已授权恢复 ego-browser，等待实际接管并观察：" + savedTaskSpaceId)
      await saveTask(workspace, task, "等待顾问接管浏览器", "顾问已授权 Agent 恢复；只有 takeOverTaskSpace 成功且首个 pageInfo 观察被记录后，才算真正恢复。")
      await appendAudit(workspace, "cua", auditAction, "completed", "consultant authorized ego-browser takeover")
      const recoveryCall = progress.egoBrowser?.controlLossKind === "unexpected_control_loss"
        ? "await claimTaskSpace(" + JSON.stringify(savedTaskSpaceId) + ")"
        : "await takeOverTaskSpace(" + JSON.stringify(savedTaskSpaceId) + ")"
      return "顾问已授权恢复，但 task space 尚未标记为已接管。下一轮 Bash heredoc先执行 " + recoveryCall + "；不要读取返回值，紧接着第一步只调用 pageInfo()。无 dialog 后用 Page.getFrameTree 记录实际表单 frame，再以真实顶层 URL/标题、frameId/loaderId/frameUrl 和证据调用 record_observation，届时才会清除 handoffPending。不得改用 useOrCreateTaskSpace。"
    }
    if (input.action === "retire_and_rebind_ego_task") {
      ensureCuaProgress(progress)
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const replacementTaskSpaceId = String(input.replacementTaskSpaceId || "").trim()
      const evidence = String(input.evidence || input.text || "").trim()
      const rebindMode = String(input.rebindMode || "").trim()
      const savedTaskSpaceId = numericTaskSpaceId(progress.egoBrowser?.taskSpaceId)
      const pendingRebind = progress.egoBrowser?.rebindPending
      const contaminated = activeBrowserSafetyStop(progress)?.kind === "cleanup_failed" || browserSafetyStop(progress)?.kind === "cleanup_failed"
      const auditError =
        browserSafetyGateError(progress) ||
        browserAuditError(auditAction, { taskSpaceId, evidence }) ||
        requireNumericTaskSpaceId(taskSpaceId) ||
        (!savedTaskSpaceId || savedTaskSpaceId !== taskSpaceId
          ? "BROWSER_TASK_SPACE_MISMATCH: only the currently saved numeric task space can be retired."
          : "") ||
        (contaminated
          ? "TERRA_EGO_TASKSPACE_CONTAMINATED: contaminated task spaces cannot be rebound; only consultant refill may create a replacement space."
          : "") ||
        (input.missingTaskSpaceConfirmed === true
          ? ""
          : "BROWSER_TASK_SPACE_MISSING_EVIDENCE_REQUIRED: listTaskSpaces must prove the saved numeric ID is absent.")
      if (auditError) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: auditAction, reason: auditError, page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendAudit(workspace, "cua", auditAction, "failed", auditError)
        return auditError
      }
      if (input.consultantConfirmed !== true) {
        progress.egoBrowser = {
          ...(progress.egoBrowser || {}),
          rebindPending: {
            phase: "consultant_confirmation",
            oldTaskSpaceId: taskSpaceId,
            detectedAt: new Date().toISOString(),
            evidence,
          },
        }
        progress.dynamicFormChecks = []
        delete progress.pendingSaveAttempt
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await saveTask(workspace, task, "等待顾问接管浏览器", "已确认保存的 Ego task-space ID 消失。原 ID 仍保留，等待顾问明确选择复用现有空间或新建替代空间。")
        await appendAudit(workspace, "cua", auditAction, "completed", "missing task space awaits consultant retire-and-rebind choice")
        return "TASK_SPACE_RETIRE_CONFIRMATION_REQUIRED: 原 taskSpaceId 尚未替换。请用 OpenCode question 向顾问展示 listTaskSpaces 结果，并让其明确选择“复用指定现有空间”或“新建替代空间”。收到选择后再调用本 action，传 consultantConfirmed:true 和 rebindMode。"
      }
      if (!pendingRebind || pendingRebind.oldTaskSpaceId !== taskSpaceId) {
        const error = "TASK_SPACE_RETIRE_DETECTION_REQUIRED: first record the missing saved ID and ask the consultant; one call cannot both discover and replace it."
        await appendAudit(workspace, "cua", auditAction, "failed", error)
        return error
      }
      if (!["existing", "new"].includes(rebindMode)) {
        const error = "TASK_SPACE_REBIND_MODE_REQUIRED: the consultant must choose existing or new."
        await appendAudit(workspace, "cua", auditAction, "failed", error)
        return error
      }
      if (rebindMode === "existing" && browserSafetyStop(progress)?.kind === "cleanup_failed") {
        const error = "TERRA_EGO_TASKSPACE_CONTAMINATED: cannot rebind an existing contaminated task space; use consultant refill only."
        await appendAudit(workspace, "cua", auditAction, "failed", error)
        return error
      }
      if (rebindMode === "new" && !replacementTaskSpaceId) {
        const replacementTaskSpaceName = String(pendingRebind.replacementTaskSpaceName || [
          progress.egoBrowser?.taskSpaceName || "Terra-Edu application",
          "replacement=" + randomUUID(),
        ].join(" / "))
        progress.egoBrowser = {
          ...(progress.egoBrowser || {}),
          rebindPending: {
            ...pendingRebind,
            phase: "replacement_creation_authorized",
            mode: "new",
            authorizedAt: new Date().toISOString(),
            authorizedSessionID: ctx?.sessionID || "",
            replacementTaskSpaceName,
          },
        }
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendAudit(workspace, "cua", auditAction, "completed", "consultant authorized a new replacement task space")
        return [
          "顾问已明确授权废弃消失的 ID 并新建替代空间。本回合只创建空间并返回身份，不得导航或填写。",
          "PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs <<'EOF'",
          "const task = await useOrCreateTaskSpace(" + JSON.stringify(replacementTaskSpaceName) + ")",
          "const spaces = await listTaskSpaces()",
          "const created = spaces.find((item) => String(item.id ?? item.taskId) === String(task.id))",
          "cliLog(JSON.stringify({ replacementTaskSpaceId: String(task.id), taskSpaceObservedName: created?.name ?? task.name, taskSpaceOwnership: created?.ownership ?? task.ownership }, null, 2))",
          "EOF",
          "将这三个字段原样传回 retire_and_rebind_ego_task，同时保留 consultantConfirmed:true、missingTaskSpaceConfirmed:true 和 rebindMode:new。",
        ].join("\\n")
      }
      const observedTaskSpaceName = String(input.taskSpaceObservedName || "").trim()
      const observedTaskSpaceOwnership = String(input.taskSpaceOwnership || "").trim()
      const replacementError =
        requireNumericTaskSpaceId(replacementTaskSpaceId) ||
        (replacementTaskSpaceId === taskSpaceId ? "TASK_SPACE_REBIND_REQUIRES_DIFFERENT_ID: the missing ID cannot replace itself." : "") ||
        (!observedTaskSpaceName ? "TASK_SPACE_REBIND_OBSERVED_NAME_REQUIRED: listTaskSpaces must identify the replacement name." : "") ||
        (!["agent", "agentDelegatedToUser", "user"].includes(observedTaskSpaceOwnership)
          ? "TASK_SPACE_REBIND_OWNERSHIP_REQUIRED: listTaskSpaces must identify replacement ownership."
          : "") ||
        (rebindMode === "new" && (
          pendingRebind.phase !== "replacement_creation_authorized" ||
          pendingRebind.authorizedSessionID !== (ctx?.sessionID || "") ||
          pendingRebind.replacementTaskSpaceName !== observedTaskSpaceName ||
          observedTaskSpaceOwnership !== "agent"
        )
          ? "TASK_SPACE_REBIND_NEW_SPACE_MISMATCH: only the replacement created by the authorized session and exact generated name may be bound."
          : "")
      if (replacementError) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: auditAction, reason: replacementError, page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendAudit(workspace, "cua", auditAction, "failed", replacementError)
        return replacementError
      }
      const reboundAt = new Date().toISOString()
      appendLimited(progress, "retiredTaskSpaces", {
        taskSpaceId,
        retiredAt: reboundAt,
        reason: "saved numeric task-space ID disappeared from listTaskSpaces",
        evidence,
        replacementTaskSpaceId,
        rebindMode,
      })
      progress.dynamicFormChecks = []
      progress.requiredEmptyFields = []
      progress.lastObservedAt = ""
      delete progress.lastBrowserObservation
      delete progress.pendingSaveAttempt
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceId: replacementTaskSpaceId,
        taskSpaceName: observedTaskSpaceName,
        rebindPending: undefined,
        rebindObservationPending: true,
        reboundAt,
        reboundFromTaskSpaceId: taskSpaceId,
        rebindMode,
        handoffPending: false,
        takeoverPending: true,
        resumeAuthorizedAt: reboundAt,
        resumedAt: undefined,
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "顾问已确认 retire-and-rebind：" + taskSpaceId + " -> " + replacementTaskSpaceId)
      await saveTask(workspace, task, "等待顾问接管浏览器", "替代 Ego task space 已绑定；必须先恢复控制并记录第一个 page/frame 观察。")
      await appendAudit(workspace, "cua", auditAction, "completed", "retired " + taskSpaceId + " and rebound " + replacementTaskSpaceId)
      const recoveryCall = observedTaskSpaceOwnership === "agent"
        ? "await useOrCreateTaskSpace(taskSpaceId)"
        : observedTaskSpaceOwnership === "agentDelegatedToUser"
          ? "await takeOverTaskSpace(taskSpaceId)"
          : "await claimTaskSpace(taskSpaceId)"
      return [
        "原数值 taskSpaceId 已按顾问明确选择写入废弃审计，替代 ID 已绑定。本回合只恢复并观察，不得导航、填写或保存。",
        "PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs <<'EOF'",
        "const taskSpaceId = " + JSON.stringify(replacementTaskSpaceId),
        recoveryCall,
        "const info = await pageInfo()",
        "const frameTree = info && typeof info === 'object' && !('dialog' in info) ? await cdp('Page.getFrameTree') : undefined",
        "const snapshot = info && typeof info === 'object' && !('dialog' in info) ? await snapshotText() : undefined",
        "cliLog(JSON.stringify({ taskSpaceId, info, frameTree, snapshot }, null, 2))",
        "EOF",
        "从 frameTree 选择真正承载表单的 frame，然后带替代 taskSpaceId、顶层 URL/标题、frameId、loaderId、frameUrl 和证据调用 record_observation；只有该观察成功才算 rebind 完成。",
      ].join("\\n")
    }
    if (input.action === "prepare_ego_task") {
      let materialReview = await readJson(join(workspace, "03_state/material_review.json"), {})
      const materialReviewTrust = await readJson(materialReviewTrustPath(workspace), null)
      const untrustedReview = materialReviewPrepareError(materialReview, materialReviewTrust)
      if (untrustedReview) {
        await appendAudit(workspace, "cua", auditAction, "failed", untrustedReview, ctx)
        throw new Error(untrustedReview)
      }
      materialReview = await stampMaterialReviewPreparationComplete(workspace, materialReview)
      if (!(await materialReviewPreparationComplete(workspace, materialReview))) {
        await appendAudit(workspace, "cua", auditAction, "failed", "material review has not been approved and fully applied", ctx)
        throw new Error("材料确认或补充内容同步尚未完成。请停止，不要启动 ego-browser；等待 material_review.json 记录 preparationCompleteAt。")
      }
      ensureCuaProgress(progress)
      const prepareSafetyError = browserSafetyGateError(progress)
      if (prepareSafetyError) {
        await saveTask(workspace, task, "异常中断", prepareSafetyError)
        await appendAudit(workspace, "cua", auditAction, "failed", prepareSafetyError, ctx)
        return prepareSafetyError
      }
      if (progress.egoBrowser?.rebindPending) {
        await saveTask(workspace, task, "等待顾问接管浏览器", "原 Ego task space 已消失，retire-and-rebind 尚未完成。不得重新准备或静默创建空间。")
        await appendAudit(workspace, "cua", auditAction, "failed", "task-space retire-and-rebind is pending")
        return "BROWSER_TASK_SPACE_REBIND_PENDING: 只能继续 retire_and_rebind_ego_task 的顾问确认/绑定流程，不得调用 prepare_ego_task 替换空间。"
      }
      const refillAttemptId = String(progress.refillAttempt?.id || "").trim()
      const refillTaskSpaceName = String(progress.egoBrowser?.taskSpaceName || "").trim()
      const refillApplicationUrl = String(progress.egoBrowser?.applicationUrl || task.input?.applicationUrl || "").trim()
      const isRefillAgent = ctx?.agent === "application-refill-agent"
      const requestedUrl = String(input.applicationUrl || task.input?.applicationUrl || "").trim()
      const url = isRefillAgent ? refillApplicationUrl : requestedUrl
      if (!url) throw new Error("applicationUrl is required for prepare_ego_task")
      const requestedTaskSpaceName = String(input.taskSpaceName || "").trim()
      const isolatedTaskSpaceName = [
        requestedTaskSpaceName || ["Terra-Edu", task.input?.studentName, task.input?.school, task.input?.program].filter(Boolean).join(" / "),
        "task=" + String(task.id || basename(workspace)),
      ].filter(Boolean).join(" / ")
      const taskSpaceName = isRefillAgent
        ? refillTaskSpaceName
        : String(progress.egoBrowser?.taskSpaceName || isolatedTaskSpaceName).trim()
      const savedTaskSpaceId = numericTaskSpaceId(progress.egoBrowser?.taskSpaceId)
      const suppliedTaskSpaceId = String(input.taskSpaceId || "").trim()
      const observedTaskSpaceName = String(input.taskSpaceObservedName || "").trim()
      const observedTaskSpaceOwnership = String(input.taskSpaceOwnership || "").trim()
      const refillAuthorizationError = isRefillAgent
        ? !refillAttemptId || progress.egoBrowser?.refillAttemptId !== refillAttemptId || !progress.egoBrowser?.freshTaskSpaceAuthorizedAt || progress.egoBrowser?.freshTaskSpaceAuthorizedBy !== "consultant_refill_click"
          ? "REFILL_FRESH_TASK_SPACE_NOT_AUTHORIZED: 本会话没有桌面端持久化的重新填写授权，已拒绝创建或绑定浏览器空间。"
          : !refillTaskSpaceName
            ? "REFILL_TASK_SPACE_NAME_REQUIRED: 本次重新填写记录缺少独立 taskSpaceName。"
            : requestedTaskSpaceName && requestedTaskSpaceName !== refillTaskSpaceName
              ? "REFILL_TASK_SPACE_NAME_MISMATCH: 不得覆盖本次重新填写的独立 taskSpaceName。"
              : requestedUrl && requestedUrl !== refillApplicationUrl
                ? "REFILL_APPLICATION_URL_MISMATCH: 不得在重新填写会话中替换当前学校的申请平台链接。"
                : suppliedTaskSpaceId && !progress.egoBrowser?.freshTaskSpaceCreationIssuedAt
                  ? "REFILL_CREATE_TASK_SPACE_FIRST: 首轮必须先调用 prepare_ego_task 取得创建独立空间脚本，不得直接绑定现有 taskSpaceId。"
                  : suppliedTaskSpaceId && progress.egoBrowser?.freshTaskSpaceCreationIssuedForSessionID !== ctx?.sessionID
                    ? "REFILL_CREATE_TASK_SPACE_SESSION_MISMATCH: 只有取得本次创建脚本的新对话可以绑定 taskSpaceId。"
                    : suppliedTaskSpaceId && observedTaskSpaceName !== refillTaskSpaceName
                      ? "REFILL_TASK_SPACE_OBSERVED_NAME_MISMATCH: listTaskSpaces 返回的空间名称与本次唯一 taskSpaceName 不一致。"
                      : suppliedTaskSpaceId && observedTaskSpaceOwnership !== "agent"
                        ? "REFILL_TASK_SPACE_OWNERSHIP_MISMATCH: 新空间必须由 Agent 持有控制权，不能绑定用户或已交接空间。"
                  : ""
        : ""
      const taskSpaceError = refillAuthorizationError ||
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
        freshTaskSpaceCreationIssuedAt: progress.egoBrowser?.freshTaskSpaceCreationIssuedAt || (isRefillAgent && !suppliedTaskSpaceId ? new Date().toISOString() : undefined),
        freshTaskSpaceCreationIssuedForSessionID: progress.egoBrowser?.freshTaskSpaceCreationIssuedForSessionID || (isRefillAgent && !suppliedTaskSpaceId ? ctx?.sessionID : undefined),
        freshTaskSpaceBoundAt: progress.egoBrowser?.freshTaskSpaceBoundAt || (isRefillAgent && selectedFreshTaskSpaceId ? new Date().toISOString() : undefined),
        freshTaskSpaceBoundBySessionID: progress.egoBrowser?.freshTaskSpaceBoundBySessionID || (isRefillAgent && selectedFreshTaskSpaceId ? ctx?.sessionID : undefined),
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
            ? "已保存刚创建的数值 ego-browser taskSpaceId。现在按直接 Ego 观察协议在新回合打开申请网址。"
            : "已找到保存的数值 ego-browser taskSpaceId。正常回合只可复用这个 ID，不得按名称新建或匹配空间。",
          "PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs <<'EOF'",
          "const taskSpaceId = " + JSON.stringify(activeTaskSpaceId),
          "const expectedTaskSpaceName = " + JSON.stringify(isRefillAgent ? taskSpaceName : ""),
          "const spaces = await listTaskSpaces()",
          "const space = spaces.find((item) => String(item.id ?? item.taskId) === taskSpaceId)",
          "if (!space || space.ownership !== 'agent' || (expectedTaskSpaceName && space.name !== expectedTaskSpaceName)) {",
          "  cliLog(JSON.stringify({ taskSpaceId, expectedTaskSpaceName, actualTaskSpaceName: space?.name || 'missing', control: space?.ownership || 'missing' }, null, 2))",
          "} else {",
          "  const task = await useOrCreateTaskSpace(taskSpaceId)",
          "  const beforeNavigation = await pageInfo()",
          ...(selectedFreshTaskSpaceId
            ? [
                ...EGO_INITIAL_NAVIGATION_SOURCE.split("\n").map((line) => "  " + line),
                "  const navigation = beforeNavigation && typeof beforeNavigation === 'object' && 'dialog' in beforeNavigation",
                "    ? { kind: 'dialog', info: beforeNavigation }",
                "    : await navigateInitialPageCapturingAlerts(" + JSON.stringify(url) + ", { timeout: 30, settle: 1 })",
                "  if (navigation.kind === 'cleanup_failed') {",
                "    cliLog(JSON.stringify({ taskSpaceId: task.id, kind: 'cleanup_failed', contaminated: true, cleanupError: navigation.cleanupError, infoError: navigation.infoError, capturedAlerts: navigation.capturedAlerts, info: navigation.info, actionError: navigation.actionError, nextRound: 'hard stop; no navigation, filling, saving, or retry in this task space' }, null, 2))",
                "  } else if (navigation.kind === 'alert_evidence_lost') {",
                "    cliLog(JSON.stringify({ taskSpaceId: task.id, kind: 'alert_evidence_lost', cleanupError: navigation.cleanupError, infoError: navigation.infoError, capturedAlerts: navigation.capturedAlerts, topLevelAlerts: navigation.topLevelAlerts, info: navigation.info, actionError: navigation.actionError, nextRound: 'hard stop; iframe load-time alert text may be lost; the consultant decides how to recover' }, null, 2))",
                "  } else if (navigation.kind === 'dialog') {",
                "    const dialog = navigation.info.dialog",
                "    if (dialog.type === 'alert') await cdp('Page.handleJavaScriptDialog', { accept: true })",
                "    if (dialog.type === 'beforeunload') await cdp('Page.handleJavaScriptDialog', { accept: false })",
                "    if ((dialog.type === 'alert' || dialog.type === 'beforeunload') && navigation.actionPromise) await Promise.race([navigation.actionPromise, new Promise((resolve) => setTimeout(resolve, 2000))])",
                "    const handoff = dialog.type === 'confirm' || dialog.type === 'prompt' ? await handOffTaskSpace(task.id) : undefined",
                "    cliLog(JSON.stringify({ taskSpaceId: task.id, kind: 'dialog', dialog, capturedAlerts: navigation.capturedAlerts, cleanupError: navigation.cleanupError, infoError: navigation.infoError, handoff }, null, 2))",
                "  } else if (navigation.kind === 'alerts') {",
                "    cliLog(JSON.stringify({ taskSpaceId: task.id, kind: 'alerts', alerts: navigation.alerts, info: navigation.info, frameTree: navigation.frameTree, cleanupError: navigation.cleanupError, infoError: navigation.infoError }, null, 2))",
                "  } else if (navigation.kind === 'action') {",
                "    const info = navigation.info",
                "    const frameTree = navigation.frameTree",
                "    const snapshot = info && typeof info === 'object' && 'dialog' in info ? undefined : await snapshotText()",
                "    cliLog(JSON.stringify({ taskSpaceId: task.id, kind: 'action', info, frameTree, snapshot, cleanupError: navigation.cleanupError, infoError: navigation.infoError }, null, 2))",
                "  } else {",
                "    cliLog(JSON.stringify({ taskSpaceId: task.id, kind: navigation.kind, info: navigation.info, action: navigation.action, error: navigation.error, capturedAlerts: navigation.capturedAlerts, cleanupError: navigation.cleanupError, infoError: navigation.infoError, nextRound: 'pageInfo-only; do not retry navigation' }, null, 2))",
                "  }",
              ]
              : [
                "  const info = beforeNavigation",
                "  const frameTree = info && typeof info === 'object' && !('dialog' in info) ? await cdp('Page.getFrameTree') : undefined",
                "  const snapshot = info && typeof info === 'object' && 'dialog' in info ? undefined : await snapshotText()",
                "  cliLog(JSON.stringify({ taskSpaceId: task.id, info, frameTree, snapshot }, null, 2))",
              ]),
          "}",
          "EOF",
          ...(selectedFreshTaskSpaceId
            ? [
                "如果输出 kind:alerts，完整弹窗文字已经由直接 Ego CDP 记录并以等价“确定”语义关闭；本回合立即结束，不再 snapshot、填写或导航。调用 record_blocker（blockerDisposition: resolved）保存 alerts 证据，下一独立 heredoc 只复用同一 taskSpaceId 并调用 pageInfo。",
                "如果输出 kind:cleanup_failed（contaminated:true），临时注入的 alert 捕获无法确认已移除，该 task space 视为污染：立即硬停止，此后不得在该空间执行任何导航、填写、保存或重试清理，也不得把这次情况记为 record_blocker resolved。调用 application-agent_cua record_browser_safety_stop（safetyKind:cleanup_failed，taskSpaceId、evidence 原样保留 cleanupError/infoError/capturedAlerts/最后 info）；也可用 TERRA_EGO_TASKSPACE_CONTAMINATED: 前缀的 record_failure 兼容写入。污染空间只能由顾问点击“重新填写”换新 taskSpaceId，不得 resume/takeOver/rebind existing。",
                "如果输出 kind:alert_evidence_lost，注入已确认清理、空间本身未被污染，但事件队列失败使 iframe load-time alert 可能已被自动确认而文字丢失：同样立即硬停止，不得 snapshot、填写、保存或导航，不得记为 record_blocker resolved，也不得重试导航。调用 application-agent_cua record_browser_safety_stop（safetyKind:alert_evidence_lost，taskSpaceId、evidence 原样保留 topLevelAlerts/capturedAlerts/cleanupError/infoError/最后 info）；也可用 TERRA_EGO_ALERT_EVIDENCE_LOST: 前缀的 record_failure 兼容写入。顾问只能通过桌面“查看后继续当前空间”或“重新填写”决策；consultantConfirmed:true 不能解除；授权后第一回合只能观察。",
                "如果输出 kind:unknown 或 nextRound:pageInfo-only，本回合立即结束：这是结果未决，不是失败；不得调用 record_failure、不得交接、不得重试导航或刷新。下一独立 heredoc 只复用同一 taskSpaceId 并调用 pageInfo；只有该新观察明确证明动作失败或仍无法观察时，才记录失败或交接。",
              ]
            : []),
          "若空间仍存在但不是 agent ownership、显示 inactive，或命令报告 user is controlling，立即停止浏览器命令，并以保存的 taskSpaceId、当前 URL、标题和 helper stderr/listTaskSpaces 证据调用 handoff_to_consultant（handoffType: browser_takeover）。若 space 为 missing，不得当作普通交接；以 missingTaskSpaceConfirmed:true 和完整 listTaskSpaces 证据调用 retire_and_rebind_ego_task（consultantConfirmed:false），等待顾问明确选择后才可替换。",
        ].join("\\n")
      }
      if (selectedLegacyTaskSpaceId) {
        return [
          "顾问已明确选择旧空间。此回合只恢复控制并观察；不得导航、填写或保存。",
          "PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs <<'EOF'",
          "const taskSpaceId = " + JSON.stringify(selectedLegacyTaskSpaceId),
          "await claimTaskSpace(taskSpaceId)",
          "const info = await pageInfo()",
          "const frameTree = info && typeof info === 'object' && !('dialog' in info) ? await cdp('Page.getFrameTree') : undefined",
          "const snapshot = info && typeof info === 'object' && 'dialog' in info ? undefined : await snapshotText()",
          "cliLog(JSON.stringify({ taskSpaceId, info, frameTree, snapshot }, null, 2))",
          "EOF",
          "只在无 dialog 的观察完成后，带真实 taskSpaceId、顶层 URL/标题、表单 frameId/loaderId/frameUrl 和证据调用 record_observation。",
        ].join("\\n")
      }
      return [
        "ego-browser 填表任务已准备。下一步必须使用官方 ego-browser skill，不要调用 cua-driver。",
        "",
        "首轮只创建隔离 task space 并返回数值 ID、真实名称和 ownership；不得在同一回合打开学校网址。拿到结果后立刻再次调用 prepare_ego_task，并原样传 taskSpaceId、taskSpaceObservedName、taskSpaceOwnership；下一回合才会按直接 Ego 观察协议导航。",
        "PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs <<'EOF'",
        "const task = await useOrCreateTaskSpace(" + JSON.stringify(taskSpaceName) + ")",
        "const spaces = await listTaskSpaces()",
        "const created = spaces.find((item) => String(item.id ?? item.taskId) === String(task.id))",
        "const initialInfo = await pageInfo()",
        "cliLog(JSON.stringify({ taskSpaceId: task.id, taskSpaceObservedName: created?.name ?? task.name, taskSpaceOwnership: created?.ownership ?? task.ownership, info: initialInfo }, null, 2))",
        "EOF",
        "",
        "不要把这个空白 task space 记作学校页面观察。把输出中的三个 task-space 字段原样传给 application-agent_cua prepare_ego_task；不要按名称恢复或自行在本轮导航。",
      ].join("\n")
    }
    if (input.action === "record_observation") {
      ensureCuaProgress(progress)
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const currentUrl = String(input.currentUrl || "").trim()
      const pageTitle = String(input.pageTitle || "").trim()
      const frameId = String(input.frameId || "").trim()
      const loaderId = String(input.loaderId || "").trim()
      const frameUrl = String(input.frameUrl || "").trim()
      const evidence = String(input.evidence || input.text || "").trim()
      const auditError =
        browserAuditError(auditAction, { taskSpaceId, currentUrl, pageTitle, frameId, loaderId, frameUrl, evidence }) ||
        requireNumericTaskSpaceId(taskSpaceId) ||
        browserTaskSpaceMismatch(progress, taskSpaceId) ||
        (!URL.canParse(currentUrl) || !URL.canParse(frameUrl) ? "BROWSER_OBSERVATION_URL_REQUIRED: currentUrl and frameUrl must be valid observed URLs." : "")
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
      const takeoverCompleted =
        progress.egoBrowser?.takeoverPending === true &&
        progress.egoBrowser?.handoffPending === true &&
        Boolean(progress.egoBrowser?.resumeAuthorizedAt)
      const rebindCompleted =
        progress.egoBrowser?.takeoverPending === true &&
        progress.egoBrowser?.rebindObservationPending === true &&
        Boolean(progress.egoBrowser?.resumeAuthorizedAt)
      progress.lastBrowserObservation = {
        at: progress.lastObservedAt,
        taskSpaceId,
        currentUrl,
        pageTitle,
        frameId,
        loaderId,
        frameUrl,
        evidence,
      }
      const safetyObservation = browserSafetyObservationRequired(progress)
      const safetyObservationCompleted = Boolean(safetyObservation && String(safetyObservation.taskSpaceId) === taskSpaceId)
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceId,
        taskSpaceName: input.taskSpaceName || progress.egoBrowser?.taskSpaceName || "",
        lastSnapshotSummary: evidence,
        lastObservedAt: progress.lastObservedAt,
        ...(takeoverCompleted || rebindCompleted
          ? {
              handoffPending: false,
              takeoverPending: false,
              resumedAt: progress.lastObservedAt,
              ...(rebindCompleted ? { rebindObservationPending: false } : {}),
            }
          : {}),
        ...(safetyObservationCompleted
          ? {
              safetyStop: {
                ...safetyObservation,
                active: false,
                observationRequired: false,
                observationClearedAt: progress.lastObservedAt,
              },
            }
          : {}),
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", (takeoverCompleted || rebindCompleted ? "ego-browser 已实际恢复并记录首个页面/frame 观察：" : safetyObservationCompleted ? "alert_evidence_lost 恢复后的首次观察已记录，安全门已解除：" : "ego-browser 页面/frame 观察已记录：") + (progress.currentPage || "申请平台页面"))
      await saveTask(workspace, task, "正在填写申请平台", takeoverCompleted || rebindCompleted ? "已成功恢复 task space 并记录首个 page/frame 观察。" : safetyObservationCompleted ? "已完成恢复后的首次观察，可继续小步填写。" : "已通过 ego-browser snapshot/pageInfo/frameTree 观察当前页面，准备继续小步填写。")
      await appendAudit(workspace, "cua", auditAction, "completed", takeoverCompleted ? "completed authorized ego-browser takeover" : rebindCompleted ? "completed consultant-authorized task-space rebind" : safetyObservationCompleted ? "cleared safety observation gate" : "recorded ego-browser observation")
      return "ego-browser 页面观察已记录。基于这次观察完成一个逻辑动作组后必须再次 pageInfo()；无 dialog 时再 snapshotText 或截图验证并结束本回合。"
    }
    if (input.action === "record_field_verified" || input.action === "record_select_verified") {
      ensureCuaProgress(progress)
      const kind = input.action === "record_select_verified" ? "select" : "field"
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const currentUrl = String(input.currentUrl || "").trim()
      const pageTitle = String(input.pageTitle || "").trim()
      const label = String(input.fieldLabel || input.detail || "").trim()
      const value = String(input.optionLabel || input.optionValue || input.text || input.expectedText || "").trim()
      const expected = String(input.expectedText || input.optionLabel || input.text || input.optionValue || "").trim()
      const evidence = String(input.evidence || "").trim()
      const interactionMethod = String(input.interactionMethod || "").trim()
      const readbackValue = String(input.readbackValue || "").trim()
      const permittedMethod = kind === "select"
        ? interactionMethod === "click+snapshot+click-option+reobserve"
        : interactionMethod === "fillInput+Tab+readback" || interactionMethod === "cdp-key-events+Tab+readback"
      const latestObservationMatches =
        progress.lastBrowserObservation?.taskSpaceId === taskSpaceId &&
        progress.lastBrowserObservation?.currentUrl === currentUrl &&
        progress.lastBrowserObservation?.pageTitle === pageTitle &&
        Number.isFinite(Date.parse(progress.lastBrowserObservation?.at || ""))
      const auditError =
        browserAuditError(auditAction, { taskSpaceId, currentUrl, pageTitle, fieldLabel: label, evidence, interactionMethod, readbackValue }) ||
        requireNumericTaskSpaceId(taskSpaceId) ||
        browserTaskSpaceMismatch(progress, taskSpaceId) ||
        (!latestObservationMatches ? "FIELD_OBSERVATION_REQUIRED: verification must match the latest page observation for taskSpaceId, URL, and title." : "") ||
        (!permittedMethod ? "REAL_INTERACTION_REQUIRED: fields require fillInput+Tab+readback or per-key CDP+Tab+readback; selects require click+snapshot+click-option+reobserve." : "") ||
        (/vue|\$router|store|dom|setter|submit|requestsubmit/i.test(interactionMethod) ? "DIRECT_PAGE_WRITE_FORBIDDEN: framework internals, DOM setters, and scripted submit are not verification methods." : "") ||
        (expected && expected.replace(/\s+/g, " ").trim() !== readbackValue.replace(/\s+/g, " ").trim()
          ? "FIELD_READBACK_MISMATCH: fresh readbackValue does not equal the expected visible value."
          : "")
      if (auditError) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: auditAction, reason: auditError, page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "拒绝记录未完成真实交互读回的字段：" + auditError)
        await appendAudit(workspace, "cua", auditAction, "failed", auditError)
        return auditError
      }
      progress.dynamicFormChecks = []
      delete progress.pendingSaveAttempt
      appendLimited(progress, "filledFields", { at: new Date().toISOString(), kind, label, value, backend: "ego-browser", taskSpaceId, currentUrl, pageTitle, interactionMethod })
      appendLimited(progress, "verifiedFields", { at: new Date().toISOString(), kind, label, value, expected, readbackValue, evidence, interactionMethod, backend: "ego-browser", taskSpaceId, currentUrl, pageTitle, observedAt: progress.lastBrowserObservation.at })
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
      delete progress.pendingSaveAttempt
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
      return "动态表单已复查通过。现在先调用 begin_save_attempt 获取 saveAttemptId；任何其他页面动作都会使本次复查失效。"
    }
    if (input.action === "begin_save_attempt") {
      ensureCuaProgress(progress)
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const currentUrl = String(input.currentUrl || "").trim()
      const pageTitle = String(input.pageTitle || "").trim()
      const evidence = String(input.evidence || input.text || "").trim()
      const sourceFrameId = String(progress.lastBrowserObservation?.frameId || "").trim()
      const sourceLoaderId = String(progress.lastBrowserObservation?.loaderId || "").trim()
      const sourceFrameUrl = String(progress.lastBrowserObservation?.frameUrl || "").trim()
      const dynamicCheck = progress.dynamicFormChecks.findLast((check: { taskSpaceId?: string; url?: string; page?: string }) =>
        check.taskSpaceId === taskSpaceId && check.url === currentUrl && check.page === pageTitle,
      )
      const dynamicCheckedAt = Date.parse(dynamicCheck?.at || "")
      const latestObservationMatches =
        progress.lastBrowserObservation?.taskSpaceId === taskSpaceId &&
        progress.lastBrowserObservation?.currentUrl === currentUrl &&
        progress.lastBrowserObservation?.pageTitle === pageTitle &&
        progress.lastBrowserObservation?.at === dynamicCheck?.observedAt
      const auditError =
        browserAuditError(auditAction, { taskSpaceId, currentUrl, pageTitle, evidence }) ||
        requireNumericTaskSpaceId(taskSpaceId) ||
        browserTaskSpaceMismatch(progress, taskSpaceId) ||
        (!dynamicCheck ? "UNVERIFIED_DYNAMIC_FORM: begin_save_attempt requires the latest matching dynamic-form check." : "") ||
        (!latestObservationMatches ? "SAVE_ATTEMPT_OBSERVATION_REQUIRED: the dynamic check must match the latest observation for this task space, URL, and title." : "") ||
        (!sourceFrameId || !sourceLoaderId || !URL.canParse(sourceFrameUrl)
          ? "SAVE_ATTEMPT_FRAME_CONTEXT_REQUIRED: record_observation must include the active form frameId, loaderId, and frameUrl."
          : "") ||
        (!Number.isFinite(dynamicCheckedAt) || Date.now() - dynamicCheckedAt < 0 || Date.now() - dynamicCheckedAt > 5 * 60_000
          ? "STALE_DYNAMIC_FORM: the save attempt must begin within five minutes of the matching dynamic check."
          : "") ||
        (progress.pendingSaveAttempt ? "SAVE_ATTEMPT_ALREADY_PENDING: finish or record failure for the current save attempt before beginning another." : "")
      if (auditError) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: auditAction, reason: auditError, page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendAudit(workspace, "cua", auditAction, "failed", auditError)
        return auditError
      }
      const saveAttemptId = randomUUID()
      progress.pendingSaveAttempt = {
        id: saveAttemptId,
        beganAt: new Date().toISOString(),
        taskSpaceId,
        currentUrl,
        pageTitle,
        evidence,
        dynamicCheckedAt: dynamicCheck.at,
        dynamicFormEvidence: dynamicCheck.evidence || "",
        observedAt: progress.lastBrowserObservation.at,
        sourceFrameId,
        sourceLoaderId,
        sourceFrameUrl,
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "已开始可审计保存尝试：" + saveAttemptId)
      await appendAudit(workspace, "cua", auditAction, "completed", "save attempt " + saveAttemptId)
      return JSON.stringify({
        saveAttemptId,
        beganAt: progress.pendingSaveAttempt.beganAt,
        nextAction: "Network.enable; drain old events; record actionStartedAt immediately before one real observePageAction save interaction; settle briefly; drain new events and record eventsDrainedAt. Join requestWillBeSent and responseReceived by the same requestId/frameId/loaderId into compact request/response parts without headers/postData/body/query/hash. XHR/fetch must retain the source frame+loader. A document POST may use the new navigation loader but must stay in the source frame; retain the original write request, final 2xx response, and redirected:true only for a real same-ID redirect chain. Then record a fresh top-level and form-frame destination observation/readback before record_save_verified.",
      }, null, 2)
    }
    if (input.action === "record_blocker") {
      ensureCuaProgress(progress)
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const currentUrl = String(input.currentUrl || progress.currentUrl || "").trim()
      const dialogUrl = String(input.dialogUrl || "").trim()
      const dialogFrameId = String(input.dialogFrameId || "").trim()
      const pageTitle = String(input.pageTitle || progress.currentPage || "").trim()
      const evidence = String(input.evidence || input.text || "").trim()
      const disposition = input.blockerDisposition === "resolved" || input.blockerDisposition === "handoff" ? input.blockerDisposition : ""
      const auditError =
        browserAuditError(auditAction, { taskSpaceId, currentUrl, pageTitle, evidence, blockerDisposition: disposition }) ||
        requireNumericTaskSpaceId(taskSpaceId) ||
        browserTaskSpaceMismatch(progress, taskSpaceId)
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
        dialogUrl,
        dialogFrameId,
        pageTitle,
        detail: input.detail || input.text || "ego-browser blocker",
        evidence,
        backend: "ego-browser",
      })
      progress.currentUrl = currentUrl
      progress.currentPage = pageTitle
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceId,
        lastBlockerUrl: currentUrl,
        lastDialogUrl: dialogUrl,
        lastDialogFrameId: dialogFrameId,
        lastBlockerTitle: pageTitle,
        lastBlockerEvidence: evidence,
        handoffPending: disposition === "handoff",
        takeoverPending: false,
        resumeAuthorizedAt: disposition === "handoff" ? undefined : progress.egoBrowser?.resumeAuthorizedAt,
        ...(disposition === "handoff"
          ? {
              handoffAt: new Date().toISOString(),
              handoffReason: input.detail || input.text || "浏览器阻塞需要顾问处理。",
              handoffType: "browser_takeover",
              controlLossKind: "deliberate_handoff",
            }
          : {}),
      }
      // A dialog response or handoff can reveal new required fields or leave
      // the page in a different state. Never let pre-dialog observations or
      // dynamic-form checks satisfy a later save gate.
      delete progress.lastBrowserObservation
      progress.lastObservedAt = ""
      progress.dynamicFormChecks = []
      delete progress.pendingSaveAttempt
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
      const controlLossKind = input.controlLossKind === "unexpected_control_loss" || /TERRA_EGO_TASKSPACE_CONTROL_LOST/.test(evidence + " " + String(input.detail || ""))
        ? "unexpected_control_loss"
        : "deliberate_handoff"
      progress.currentUrl = currentUrl
      progress.currentPage = pageTitle
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceId,
        handoffAt: new Date().toISOString(),
        handoffPending: true,
        takeoverPending: false,
        resumeAuthorizedAt: undefined,
        handoffReason: input.detail || "需要顾问接管 ego-browser Space。",
        handoffType,
        controlLossKind,
      }
      delete progress.pendingSaveAttempt
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "已交接 ego-browser task space 给顾问：" + (input.detail || "需要人工登录/验证。"))
      await saveTask(
        workspace,
        task,
        handoffType === "login" ? "等待顾问登录" : "等待顾问接管浏览器",
        input.detail || (handoffType === "login" ? "请顾问在 ego lite Space 中完成登录后回复继续。" : "请顾问在 ego lite Space 中处理当前浏览器状态后回复继续。"),
      )
      await appendAudit(workspace, "cua", auditAction, "completed", "handoff to consultant")
      return controlLossKind === "unexpected_control_loss"
        ? "已记录意外控制丢失。不得调用 handOffTaskSpace 或自动接管；顾问明确继续后，使用保存的 taskSpaceId 调用 resume_ego（consultantConfirmed:true），再按官方 API 用 claimTaskSpace 恢复并先 pageInfo。"
        : "已记录顾问接管。确认 ego-browser 脚本中的 handOffTaskSpace(task.id) 已返回 done:true；顾问明确继续后，使用保存的 taskSpaceId 调用 resume_ego（consultantConfirmed:true），再 await takeOverTaskSpace(savedID)（不读取返回）并先 pageInfo。"
    }
    if (input.action === "record_save_verified") {
      ensureCuaProgress(progress)
      const taskSpaceId = String(input.taskSpaceId || "").trim()
      const currentUrl = String(input.currentUrl || "").trim()
      const pageTitle = String(input.pageTitle || "").trim()
      const evidence = String(input.evidence || input.text || "").trim()
      const saveAttemptId = String(input.saveAttemptId || "").trim()
      const readbackValue = String(input.readbackValue || "").trim()
      const networkEvidence = input.networkEvidence && typeof input.networkEvidence === "object" ? input.networkEvidence : undefined
      const auditError =
        browserAuditError(auditAction, { taskSpaceId, currentUrl, pageTitle, evidence, saveAttemptId, readbackValue }) ||
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
        return "UNVERIFIED_SAVE_RECORDED: record_save_verified requires confirmed:true plus a matching saveAttemptId, structured 2xx server response, and fresh post-save readback."
      }
      const attempt = progress.pendingSaveAttempt
      const attemptBeganAt = Date.parse(attempt?.beganAt || "")
      if (
        !attempt ||
        attempt.id !== saveAttemptId ||
        attempt.taskSpaceId !== taskSpaceId ||
        !Number.isFinite(attemptBeganAt) ||
        Date.now() - attemptBeganAt < 0 ||
        Date.now() - attemptBeganAt > 5 * 60_000
      ) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: "record_save_verified", reason: "missing, stale, or mismatched save attempt", page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendAudit(workspace, "cua", auditAction, "failed", "missing, stale, or mismatched save attempt")
        return "SAVE_ATTEMPT_REQUIRED: call begin_save_attempt after a fresh dynamic check, then use its exact ID for this same task space. The attempt keeps the source URL/title; record_save_verified currentUrl/pageTitle describe the freshly observed destination after saving."
      }
      const requestEvidence = networkEvidence?.request && typeof networkEvidence.request === "object" ? networkEvidence.request : undefined
      const responseEvidence = networkEvidence?.response && typeof networkEvidence.response === "object" ? networkEvidence.response : undefined
      const requestObservedAt = Date.parse(requestEvidence?.observedAt || "")
      const responseObservedAt = Date.parse(responseEvidence?.observedAt || "")
      const requestId = String(requestEvidence?.requestId || "").trim()
      const responseRequestId = String(responseEvidence?.requestId || "").trim()
      const method = String(requestEvidence?.method || "").toUpperCase()
      const status = Number(responseEvidence?.status)
      const resourceType = String(responseEvidence?.resourceType || "").toLowerCase()
      const sourceUrl = String(networkEvidence?.sourceUrl || "").trim()
      const sourceFrameId = String(networkEvidence?.sourceFrameId || "").trim()
      const sourceLoaderId = String(networkEvidence?.sourceLoaderId || "").trim()
      const sourceFrameUrl = String(networkEvidence?.sourceFrameUrl || "").trim()
      const actionStartedAt = Date.parse(networkEvidence?.actionStartedAt || "")
      const eventsDrainedAt = Date.parse(networkEvidence?.eventsDrainedAt || "")
      const requestUrl = String(requestEvidence?.url || "").trim()
      const responseUrl = String(responseEvidence?.url || "").trim()
      const requestFrameId = String(requestEvidence?.frameId || "").trim()
      const requestLoaderId = String(requestEvidence?.loaderId || "").trim()
      const responseFrameId = String(responseEvidence?.frameId || "").trim()
      const responseLoaderId = String(responseEvidence?.loaderId || "").trim()
      const compactEvidenceOnly =
        Boolean(networkEvidence) &&
        Object.keys(networkEvidence).every((key) => ["taskSpaceId", "sourceUrl", "sourceTitle", "sourceFrameId", "sourceLoaderId", "sourceFrameUrl", "actionStartedAt", "eventsDrainedAt", "request", "response"].includes(key)) &&
        Boolean(requestEvidence) &&
        Object.keys(requestEvidence).every((key) => ["requestId", "method", "url", "observedAt", "frameId", "loaderId"].includes(key)) &&
        Boolean(responseEvidence) &&
        Object.keys(responseEvidence).every((key) => ["requestId", "status", "url", "resourceType", "observedAt", "frameId", "loaderId", "redirected"].includes(key))
      const networkUrlsSafe = [sourceUrl, sourceFrameUrl, requestUrl, responseUrl].every((url) =>
        URL.canParse(url) && !new URL(url).search && !new URL(url).hash,
      )
      const attemptSourceUrl = browserUrlWithoutQuery(attempt.currentUrl)
      const attemptSourceFrameUrl = browserUrlWithoutQuery(attempt.sourceFrameUrl)
      const postSaveObservation = progress.lastBrowserObservation
      const postSaveFrameUrl = browserUrlWithoutQuery(postSaveObservation?.frameUrl)
      const actionWindowMatches =
        Number.isFinite(actionStartedAt) &&
        Number.isFinite(eventsDrainedAt) &&
        actionStartedAt >= attemptBeganAt &&
        eventsDrainedAt >= actionStartedAt &&
        eventsDrainedAt - actionStartedAt <= 2 * 60_000 &&
        requestObservedAt >= actionStartedAt &&
        responseObservedAt >= requestObservedAt &&
        responseObservedAt <= eventsDrainedAt &&
        Date.now() - eventsDrainedAt >= 0 &&
        Date.now() - eventsDrainedAt <= 5 * 60_000
      const responseIdentityMatchesRequest =
        (!responseFrameId || responseFrameId === requestFrameId) &&
        (!responseLoaderId || responseLoaderId === requestLoaderId)
      const xhrOrFetchContextMatches =
        networkUrlsSafe &&
        ["xhr", "fetch"].includes(resourceType) &&
        requestFrameId === attempt.sourceFrameId &&
        requestLoaderId === attempt.sourceLoaderId &&
        responseIdentityMatchesRequest &&
        new URL(requestUrl).origin === new URL(responseUrl).origin &&
        new URL(requestUrl).origin === new URL(sourceFrameUrl).origin
      const documentContextMatches =
        networkUrlsSafe &&
        resourceType === "document" &&
        requestFrameId === attempt.sourceFrameId &&
        Boolean(requestLoaderId) &&
        responseIdentityMatchesRequest &&
        postSaveObservation?.frameId === attempt.sourceFrameId &&
        postSaveObservation?.loaderId === requestLoaderId &&
        responseUrl === postSaveFrameUrl
      const serverConfirmed =
        compactEvidenceOnly &&
        Boolean(requestId) &&
        requestId === responseRequestId &&
        ["POST", "PUT", "PATCH"].includes(method) &&
        Number.isInteger(status) && status >= 200 && status < 300 &&
        (xhrOrFetchContextMatches || documentContextMatches) &&
        networkUrlsSafe &&
        networkEvidence?.taskSpaceId === taskSpaceId &&
        sourceUrl === attemptSourceUrl &&
        networkEvidence?.sourceTitle === attempt.pageTitle &&
        sourceFrameId === attempt.sourceFrameId &&
        sourceLoaderId === attempt.sourceLoaderId &&
        sourceFrameUrl === attemptSourceFrameUrl &&
        Number.isFinite(requestObservedAt) &&
        Number.isFinite(responseObservedAt) &&
        actionWindowMatches
      if (!serverConfirmed) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: "record_save_verified", reason: "missing or invalid server confirmation", page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendAudit(workspace, "cua", auditAction, "failed", "missing or invalid server confirmation")
        return "SERVER_SAVE_CONFIRMATION_REQUIRED: accept only a POST/PUT/PATCH 2xx XHR/fetch bound to the source frame+loader and save-action window, or a same-frame ordinary/redirected document POST whose final frame URL+loader were freshly observed. GET, background/stale, frame/loader/time-mismatched, non-2xx, or absent evidence is rejected."
      }
      const postSaveObservedAt = Date.parse(postSaveObservation?.at || "")
      if (
        !Number.isFinite(postSaveObservedAt) ||
        postSaveObservedAt <= responseObservedAt ||
        postSaveObservation?.taskSpaceId !== taskSpaceId ||
        postSaveObservation?.currentUrl !== currentUrl ||
        postSaveObservation?.pageTitle !== pageTitle ||
        postSaveObservation?.frameId !== attempt.sourceFrameId ||
        (["xhr", "fetch"].includes(resourceType) && postSaveObservation?.loaderId !== attempt.sourceLoaderId)
      ) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: "record_save_verified", reason: "missing post-save observation", page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "拒绝记录保存：动态表单复查后没有新的页面观察证据。")
        await appendAudit(workspace, "cua", auditAction, "failed", "missing post-save observation")
        return "UNVERIFIED_POST_SAVE_OBSERVATION: record_observation and readbackValue must be newer than this attempt's matching server response."
      }
      const pageName = String(input.detail || pageTitle || progress.currentPage || "申请页面")
      progress.currentPage = pageTitle
      progress.currentUrl = currentUrl
      if (!Array.isArray(progress.savedPages)) progress.savedPages = []
      progress.savedPages.push({
        at: new Date().toISOString(),
        page: pageName,
        url: currentUrl,
        frameId: postSaveObservation.frameId,
        loaderId: postSaveObservation.loaderId,
        frameUrl: postSaveObservation.frameUrl,
        backend: "ego-browser",
        taskSpaceId,
        evidence,
        readbackValue,
        saveAttemptId,
        networkEvidence: {
          taskSpaceId,
          sourceUrl,
          sourceTitle: String(networkEvidence.sourceTitle),
          sourceFrameId,
          sourceLoaderId,
          sourceFrameUrl,
          actionStartedAt: String(networkEvidence.actionStartedAt),
          eventsDrainedAt: String(networkEvidence.eventsDrainedAt),
          request: {
            requestId,
            method,
            url: requestUrl,
            observedAt: String(requestEvidence.observedAt),
            frameId: requestFrameId,
            loaderId: requestLoaderId,
          },
          response: {
            requestId: responseRequestId,
            status,
            resourceType,
            url: responseUrl,
            observedAt: String(responseEvidence.observedAt),
            ...(responseFrameId ? { frameId: responseFrameId } : {}),
            ...(responseLoaderId ? { loaderId: responseLoaderId } : {}),
            ...(responseEvidence.redirected === true ? { redirected: true } : {}),
          },
        },
        serverConfirmed: true,
        dynamicFormEvidence: attempt.dynamicFormEvidence || "",
      })
      progress.dynamicFormChecks = []
      delete progress.pendingSaveAttempt
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
      const completionError = browserCompletionGateError(progress, input)
      if (completionError) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: auditAction, reason: completionError, page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendAudit(workspace, "cua", auditAction, "failed", completionError, ctx)
        return completionError
      }
      const completedAt = new Date().toISOString()
      const taskSpaceId = String(input.taskSpaceId).trim()
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceId,
        completedAt,
        completionDetail: input.detail || "",
        completionDisposition: input.completionDisposition,
        completionObservation: {
          ...progress.lastBrowserObservation,
          confirmedAt: completedAt,
        },
      }
      appendLimited(progress, "completedPages", {
        at: completedAt,
        page: input.pageTitle,
        url: input.currentUrl,
        frameId: input.frameId,
        loaderId: input.loaderId,
        frameUrl: input.frameUrl,
        evidence: input.evidence || input.text,
        taskSpaceId,
        completionDisposition: input.completionDisposition,
        backend: "ego-browser",
      })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "ego-browser task space 完成：" + (input.detail || "本轮填表阶段完成。"))
      await saveTask(workspace, task, "阶段性完成", input.detail || "本轮 ego-browser 填表阶段已完成。")
      await appendAudit(workspace, "cua", auditAction, "completed", "completed ego-browser task")
      return "ego-browser 阶段完成状态已通过最新保存、页面/frame 观察、必填项和控制权门槛，并已进入终态。现在只可在独立最终 heredoc 调用 completeTaskSpace(taskSpaceId, { keep: true })；其他 CUA 动作会被拒绝。若该 helper 回合失败，只可按协议用 record_failure 归档并撤销假完成；不得在单个页面完成后调用，不得使用 keep:false 关闭窗口。"
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
      delete progress.pendingSaveAttempt
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
    const safetyKind = safetyKindFromFailureDetail(String(detail).trim())
    const failureTaskSpaceId = numericTaskSpaceId(input.taskSpaceId) || numericTaskSpaceId(progress.egoBrowser?.taskSpaceId)
    let recordedSafetyStop = null as any
    if (safetyKind && failureTaskSpaceId) {
      recordedSafetyStop = applyBrowserSafetyStop(progress, {
        kind: safetyKind,
        taskSpaceId: failureTaskSpaceId,
        evidence: input.safetyEvidence && typeof input.safetyEvidence === "object" ? input.safetyEvidence : { detail },
        detail: String(detail),
      })
    }
    progress.failedActions.push({ at: new Date().toISOString(), action: input.action, reason: detail, page: progress.currentPage || "", taskSpaceId: failureTaskSpaceId || undefined, decisionId: recordedSafetyStop?.decisionId })
    delete progress.pendingSaveAttempt
    await writeJson(join(workspace, "03_state/application_progress.json"), progress)
    await appendLog(workspace, "cua", "已记录 CUA 失败：" + detail + (recordedSafetyStop ? "；已写入 browser safetyStop decisionId=" + recordedSafetyStop.decisionId : ""))
    if (recordedSafetyStop) {
      const message = recordedSafetyStop.kind === "cleanup_failed"
        ? "浏览器 task space 已标记为污染。CUA 与 wrapper 已阻断后续浏览器动作；只能由顾问点击“重新填写”。"
        : "浏览器已进入 alert 证据丢失硬停止。CUA 与 wrapper 已阻断后续动作；请顾问在桌面授权继续或重新填写。"
      await saveTask(workspace, task, "异常中断", message)
      await appendAudit(workspace, "cua", auditAction, "failed", detail + " safetyStop=" + recordedSafetyStop.decisionId)
      return browserSafetyMarker(recordedSafetyStop.kind) + ": safety stop recorded for taskSpaceId " + recordedSafetyStop.taskSpaceId + " decisionId " + recordedSafetyStop.decisionId + ". " + message
    }
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
  const included = items.filter((item: any) => item.addedToWordList !== false)
  return {
    title: studentName + " 补充材料清单",
    school: String(input.school || ""),
    program: String(input.program || ""),
    intro: "请按以下要求补充材料或信息。补齐后请发给顾问，或放入指定补充材料文件夹。",
    rows: included.map((item: any, index: number) => ({
      index: String(index + 1),
      name: String(item.name || ""),
      whyNeeded: String(item.whyNeeded || ""),
      prepareFrom: String(item.prepareFrom || ""),
      formatRequirement: String(item.formatRequirement || ""),
    })),
    footer: "说明：最终提交申请、付款和推荐信邀请需由顾问人工确认完成。",
  }
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

function paragraphXml(text: string, bold = false) {
  const run = bold
    ? "<w:r><w:rPr><w:b/></w:rPr><w:t xml:space=\"preserve\">" + escapeXml(text) + "</w:t></w:r>"
    : "<w:r><w:t xml:space=\"preserve\">" + escapeXml(text) + "</w:t></w:r>"
  return "<w:p>" + run + "</w:p>"
}

function cellXml(text: string, width: number, header = false) {
  return "<w:tc><w:tcPr><w:tcW w:w=\"" + width + "\" w:type=\"dxa\"/>" + (header ? "<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"E8F0E9\"/>" : "") + "</w:tcPr>" + paragraphXml(text, header) + "</w:tc>"
}

function makeDocx(checklist: any) {
  const data = typeof checklist === "string"
    ? { title: "补充材料清单", school: "", program: "", intro: checklist, rows: [], footer: "" }
    : checklist
  const widths = [700, 2200, 2800, 2800, 2200]
  const headers = ["序号", "缺失项", "为什么需要", "如何准备", "文件格式"]
  let table = "<w:tbl><w:tblPr><w:tblW w:w=\"10700\" w:type=\"dxa\"/><w:tblBorders><w:top w:val=\"single\" w:sz=\"4\" w:color=\"B7C8B8\"/><w:left w:val=\"single\" w:sz=\"4\" w:color=\"B7C8B8\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:color=\"B7C8B8\"/><w:right w:val=\"single\" w:sz=\"4\" w:color=\"B7C8B8\"/><w:insideH w:val=\"single\" w:sz=\"4\" w:color=\"B7C8B8\"/><w:insideV w:val=\"single\" w:sz=\"4\" w:color=\"B7C8B8\"/></w:tblBorders></w:tblPr><w:tr>" + headers.map((header, index) => cellXml(header, widths[index], true)).join("") + "</w:tr>"
  if (!data.rows || data.rows.length === 0) {
    table += "<w:tr>" + cellXml("—", widths[0]) + cellXml("当前没有需要补充的材料或信息。", widths[1] + widths[2] + widths[3] + widths[4]) + "</w:tr>"
  } else {
    for (const row of data.rows) {
      table += "<w:tr>" + [
        cellXml(row.index, widths[0]),
        cellXml(row.name, widths[1]),
        cellXml(row.whyNeeded, widths[2]),
        cellXml(row.prepareFrom, widths[3]),
        cellXml(row.formatRequirement, widths[4]),
      ].join("") + "</w:tr>"
    }
  }
  table += "</w:tbl>"
  const body = [
    paragraphXml(data.title || "补充材料清单", true),
    paragraphXml("申请学校：" + (data.school || "")),
    paragraphXml("申请项目：" + (data.program || "")),
    paragraphXml(data.intro || ""),
    paragraphXml(""),
    table,
    paragraphXml(""),
    paragraphXml(data.footer || "说明：最终提交申请、付款和推荐信邀请需由顾问人工确认完成。"),
  ].join("")
  const documentXml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>" + body + "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1080\" w:right=\"1080\" w:bottom=\"1080\" w:left=\"1080\"/></w:sectPr></w:body></w:document>"
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

function authoritativeEditDenyPatterns(workspacePath: string, relativePaths: string[]) {
  // Deny relative, **/prefixed, and absolute forms. Non-git workspaces may match
  // permission checks against either workspace-relative or absolute-looking paths.
  const entries = relativePaths.flatMap((relativePath) => {
    const normalized = relativePath.replaceAll("\\", "/")
    const absolute = join(workspacePath, normalized).replaceAll("\\", "/")
    return [
      [normalized, "deny"] as const,
      ["**/" + normalized, "deny"] as const,
      [absolute, "deny"] as const,
    ]
  })
  return Object.fromEntries(entries)
}

export async function writeOpenCodeConfig(workspacePath: string, overrides?: OpenCodeResourceOverrides) {
  const base = join(workspacePath, ".opencode")
  // OpenCode routes write/edit/patch through permission.edit. These files are
  // authoritative tool/UI state, so the ordinary Agent may read but not forge them.
  const authoritativeStateEditPermissions = authoritativeEditDenyPatterns(workspacePath, [
    ".opencode/**",
    "03_state/application_progress.json",
    "03_state/task_state.json",
    "03_state/task_control.json",
    "03_state/agent_execution_audit.json",
    "03_state/material_review.json",
    "03_state/.desktop_material_review_trust.json",
    "03_state/task_input.json",
  ])
  const sharedReadPattern = overrides?.sharedWorkspacePath && existsSync(overrides.sharedWorkspacePath)
    ? relative(workspacePath, overrides.sharedWorkspacePath).replaceAll("\\", "/") + "/**"
    : ""
  const sharedExternalPattern = overrides?.sharedWorkspacePath && existsSync(overrides.sharedWorkspacePath)
    ? overrides.sharedWorkspacePath.replaceAll("\\", "/") + "/**"
    : ""
  const sharedEditDeny = overrides?.sharedWorkspacePath && existsSync(overrides.sharedWorkspacePath)
    ? {
        // Deny the shared authoritative files only by their absolute shared path.
        // The relative/glob forms (e.g. "02_generated/student_profile.md" and
        // "**/02_generated/student_profile.md") are intentionally NOT used here:
        // they would also match the school-local copy, which the owner school
        // must be able to write. sharedReadPattern ("../../shared/**") already
        // covers every relative access into the shared workspace.
        [overrides.sharedWorkspacePath.replaceAll("\\", "/") + "/03_state/shared_dossier_state.json"]: "deny",
        [overrides.sharedWorkspacePath.replaceAll("\\", "/") + "/02_generated/student_profile.md"]: "deny",
        [overrides.sharedWorkspacePath.replaceAll("\\", "/") + "/03_state/materials_index.json"]: "deny",
        ...(sharedReadPattern ? { [sharedReadPattern]: "deny" } : {}),
      }
    : {}
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
  await rm(join(base, "bin", ["terra", "dialog", "guard"].join("-")), { force: true })
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
        ...authoritativeStateEditPermissions,
        ...sharedEditDeny,
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
        "*": "deny",
        "PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs*": "allow",
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
        edit: {
          "*": "allow",
          ...authoritativeStateEditPermissions,
          ...sharedEditDeny,
          "../*": "deny",
        },
        external_directory: sharedExternalPattern
          ? { "*": "deny", [sharedExternalPattern]: "allow" }
          : { "*": "deny" },
        glob: "allow",
        grep: "allow",
        bash: {
          "*": "deny",
          "PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs*": "allow",
        },
        question: "allow",
        skill: { "*": "allow" },
        todowrite: "allow",
        webfetch: "allow",
        websearch: "allow",
        },
      },
      "application-refill-agent": {
        description: "Terra-Edu 重新填写 Agent，只读复用已确认材料与档案，在全新对话和独立 Ego task space 中重新填表。",
        mode: "primary",
          model: APPLICATION_AGENT_MODEL,
          prompt: "{file:./prompts/application-refill-agent.md}",
          permission: {
            "*": "allow",
            read: {
              "*": "deny",
              "00_original_backup/**": "allow",
              "01_classified_materials/**": "allow",
              "02_generated/student_profile.md": "allow",
              "03_state/task_state.json": "allow",
              "03_state/task_control.json": "allow",
              "03_state/agent_execution_audit.json": "allow",
              "03_state/materials_index.json": "allow",
              "03_state/ocr_index.json": "allow",
              "03_state/extracted_text/**": "allow",
              "03_state/application_requirements.json": "allow",
              "03_state/missing_items.json": "allow",
              "03_state/material_review.json": "allow",
              "03_state/application_progress.json": "allow",
              "05_screenshots/**": "allow",
              "06_new_materials/**": "allow",
              ...(sharedReadPattern ? { [sharedReadPattern]: "allow" } : {}),
              "*.env": "deny",
              "*.env.*": "deny",
            },
            glob: "allow",
            grep: "deny",
          edit: {
            "*": "deny",
            "00_original_backup/**": "deny",
            "01_classified_materials/**": "deny",
            "02_generated/student_profile.md": "deny",
            "02_generated/application_requirements.md": "deny",
            "03_state/materials_index.json": "deny",
            "03_state/application_requirements.json": "deny",
            "03_state/missing_items.json": "deny",
            "03_state/material_review.json": "deny",
            "03_state/application_progress.json": "deny",
            "03_state/task_state.json": "deny",
            "06_new_materials/**": "deny",
            ...authoritativeStateEditPermissions,
            ...sharedEditDeny,
          },
          external_directory: sharedExternalPattern
            ? { "*": "deny", [sharedExternalPattern]: "allow" }
            : { "*": "deny" },
          bash: {
            "*": "deny",
            "PATH=\"$PWD/.opencode/bin:$PATH\" ego-browser nodejs*": "allow",
          },
          question: "allow",
          task: "deny",
          skill: {
            "*": "allow",
            "task-initialization": "deny",
            "workspace-building": "deny",
            "student-file-reading": "deny",
            "material-organization": "deny",
            "student-profile-generation": "deny",
            "application-target-analysis": "deny",
            "missing-content-recording": "deny",
            "word-checklist-generation": "deny",
            "continue-after-supplement": "deny",
          },
          todowrite: "allow",
          webfetch: "deny",
          websearch: "deny",
          "application-agent_workspace": "deny",
          "application-agent_state": "deny",
          "application-agent_materials": "deny",
          "application-agent_documents": "deny",
          "application-agent_requirements": "deny",
          "application-agent_runtime": "deny",
          "cua_final_submit": "deny",
          "cua_payment": "deny",
          "cua_recommendation_invite": "deny",
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
  await writeGeneratedFile(join(base, "prompts/application-refill-agent.md"), DEFAULT_APPLICATION_REFILL_PROMPT)
  await writeGeneratedFile(
    join(base, "agents/application-agent.md"),
    `---
description: Terra-Edu 留学申请 Agent，服务留学顾问完成申请资料整理、缺失项识别、Word 清单和 ego-browser 填表。
mode: primary
model: ${APPLICATION_AGENT_MODEL}
permission:
  "*": allow
  read:
    "*": allow
    "*.env": deny
    "*.env.*": deny
    "*.env.example": allow
${sharedReadPattern ? `    "${sharedReadPattern}": allow\n` : ""}  edit:
    "*": allow
    ".opencode/**": deny
    "03_state/application_progress.json": deny
    "03_state/task_state.json": deny
    "03_state/task_control.json": deny
    "03_state/agent_execution_audit.json": deny
    "03_state/material_review.json": deny
    "03_state/.desktop_material_review_trust.json": deny
    "03_state/task_input.json": deny
    "../*": deny
${sharedReadPattern ? `    "${sharedReadPattern}": deny\n` : ""}  external_directory:
    "*": deny
${sharedExternalPattern ? `    "${sharedExternalPattern}": allow\n` : ""}  glob: allow
  grep: allow
  bash:
    "*": deny
    'PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs*': allow
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
  await writeGeneratedFile(
    join(base, "agents/application-refill-agent.md"),
    `---
description: Terra-Edu 重新填写 Agent，只读复用已确认材料与档案，在全新对话和独立 Ego task space 中重新填表。
mode: primary
model: ${APPLICATION_AGENT_MODEL}
permission:
  "*": allow
  read:
    "*": deny
    "00_original_backup/**": allow
    "01_classified_materials/**": allow
    "02_generated/student_profile.md": allow
    "03_state/task_state.json": allow
    "03_state/task_control.json": allow
    "03_state/agent_execution_audit.json": allow
    "03_state/materials_index.json": allow
    "03_state/ocr_index.json": allow
    "03_state/extracted_text/**": allow
    "03_state/application_requirements.json": allow
    "03_state/missing_items.json": allow
    "03_state/material_review.json": allow
    "03_state/application_progress.json": allow
    "05_screenshots/**": allow
    "06_new_materials/**": allow
${sharedReadPattern ? `    "${sharedReadPattern}": allow\n` : ""}    "*.env": deny
    "*.env.*": deny
  glob: allow
  grep: deny
  edit:
    "*": deny
    "00_original_backup/**": deny
    "01_classified_materials/**": deny
    "02_generated/student_profile.md": deny
    "02_generated/application_requirements.md": deny
    "03_state/materials_index.json": deny
    "03_state/application_requirements.json": deny
    "03_state/missing_items.json": deny
    "03_state/material_review.json": deny
    "03_state/application_progress.json": deny
    "03_state/task_state.json": deny
    "06_new_materials/**": deny
${sharedReadPattern ? `    "${sharedReadPattern}": deny\n` : ""}  external_directory:
    "*": deny
${sharedExternalPattern ? `    "${sharedExternalPattern}": allow\n` : ""}  bash:
    "*": deny
    'PATH="$PWD/.opencode/bin:$PATH" ego-browser nodejs*': allow
  question: allow
  task: deny
  skill:
    "*": allow
    task-initialization: deny
    workspace-building: deny
    student-file-reading: deny
    material-organization: deny
    student-profile-generation: deny
    application-target-analysis: deny
    missing-content-recording: deny
    word-checklist-generation: deny
    continue-after-supplement: deny
  todowrite: allow
  webfetch: deny
  websearch: deny
  application-agent_workspace: deny
  application-agent_state: deny
  application-agent_materials: deny
  application-agent_documents: deny
  application-agent_requirements: deny
  application-agent_runtime: deny
  cua_final_submit: deny
  cua_payment: deny
  cua_recommendation_invite: deny
---

${DEFAULT_APPLICATION_REFILL_PROMPT}
`,
  )
  for (const skill of SKILL_DEFINITIONS) {
    const dir = join(base, "skills", skill.name)
    await mkdir(dir, { recursive: true })
    await writeGeneratedFile(join(dir, "SKILL.md"), renderSkill(skill))
  }
  await writeEgoBrowserSkill(base, overrides)
  await writeEgoBrowserWrapper(base, overrides)
  await writeTerraPaddleOcrWrapper(base)
  for (const command of COMMAND_DEFINITIONS) {
    await writeGeneratedFile(join(base, "commands", `${command[0]}.md`), renderCommand(command))
  }
  await writeGeneratedFile(join(base, "tools/application-agent.ts"), renderApplicationAgentTools())
}
