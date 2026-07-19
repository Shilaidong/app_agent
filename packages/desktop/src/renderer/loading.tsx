import { MetaProvider } from "@solidjs/meta"
import { render } from "solid-js/web"
import "@opencode-ai/app/index.css"
import { Font } from "@opencode-ai/ui/font"
import { Splash } from "@opencode-ai/ui/logo"
import { Progress } from "@opencode-ai/ui/progress"
import "./styles.css"
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { InitStep, SqliteMigrationProgress } from "../preload/types"

const root = document.getElementById("root")!
const stageText = {
  copying_legacy_data: "正在安全合并旧版 OpenCode 本机数据",
  migrating_data: "正在升级 OpenCode 数据结构",
  starting_server: "正在启动 OpenCode 服务",
}

const stageDetail = {
  copying_legacy_data: "首次升级通常需要 1–5 分钟；资料较多时会更久。此步骤会持续显示等待时间，请保持此窗口打开。",
  migrating_data: "正在逐项升级本机记录，进度条会随处理推进。",
  starting_server: "数据已就绪，正在完成最后启动。",
}

render(() => {
  const [step, setStep] = createSignal<InitStep | null>(null)
  const [percent, setPercent] = createSignal(0)
  const [stage, setStage] = createSignal<keyof typeof stageText>("starting_server")
  const [elapsed, setElapsed] = createSignal(0)

  const phase = createMemo(() => step()?.phase)

  const value = createMemo(() => {
    if (phase() === "done") return 100
    if (percent() > 0) return Math.max(10, Math.min(100, percent()))
    return phase() === "sqlite_waiting" ? 5 : 2
  })

  window.api.awaitInitialization((next) => setStep(next as InitStep)).catch(() => undefined)

  onMount(() => {
    setPercent(0)
    const startedAt = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)

    const listener = window.api.onSqliteMigrationProgress((progress: SqliteMigrationProgress) => {
      if (progress.type === "Stage") {
        setStage(progress.stage)
        if (progress.stage !== "migrating_data") setPercent(0)
      }
      if (progress.type === "InProgress") setPercent(Math.max(0, Math.min(100, progress.value)))
      if (progress.type === "Done") {
        setPercent(100)
        setStep({ phase: "done" })
      }
    })

    onCleanup(() => {
      listener()
      window.clearInterval(timer)
    })
  })

  createEffect(() => {
    if (phase() !== "done") return

    const timer = setTimeout(() => window.api.loadingWindowComplete(), 1000)
    onCleanup(() => clearTimeout(timer))
  })

  const status = createMemo(() => {
    if (phase() === "done") return "准备完成，正在打开申请 Agent"
    if (phase() === "sqlite_waiting") return stageText[stage()]
    return "正在启动 Terra-Edu 申请 Agent"
  })

  const detail = createMemo(() => {
    if (phase() === "done") return ""
    if (phase() === "sqlite_waiting") return stageDetail[stage()]
    return "首次启动正在准备本机服务。"
  })

  const elapsedText = createMemo(() => {
    const seconds = elapsed()
    return seconds < 60 ? `已等待 ${seconds} 秒` : `已等待 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
  })

  return (
    <MetaProvider>
      <div class="w-screen h-screen bg-background-base flex items-center justify-center">
        <Font />
        <div class="flex flex-col items-center gap-11">
          <Splash class="w-20 h-25 opacity-15" />
          <div class="w-80 flex flex-col items-center gap-3" aria-live="polite">
            <span class="w-full overflow-hidden text-center text-ellipsis whitespace-nowrap text-text-strong text-14-normal">
              {status()}
            </span>
            <span class="text-center text-text-weak text-12-normal">{detail()}</span>
            <Progress
              value={value()}
              class="w-20 [&_[data-slot='progress-track']]:h-1 [&_[data-slot='progress-track']]:border-0 [&_[data-slot='progress-track']]:rounded-none [&_[data-slot='progress-track']]:bg-surface-weak [&_[data-slot='progress-fill']]:rounded-none [&_[data-slot='progress-fill']]:bg-icon-warning-base"
              aria-label="Database migration progress"
              getValueLabel={({ value }) => `${Math.round(value)}%`}
            />
            <span class="text-text-weak text-12-normal">{percent() > 0 ? `数据结构升级 ${percent()}% · ` : ""}{elapsedText()}</span>
          </div>
        </div>
      </div>
    </MetaProvider>
  )
}, root)
