export type ApplicationAgentModelOption = {
  /** Unique UI / resolve key: `${providerID}/${modelID}` */
  id: string
  /** Provider API model id */
  modelID: string
  providerID: "opencode-go" | "ollama-cloud"
  /** Shown at the top of the picker groups */
  subscription: "OpenCode Go 订阅" | "Ollama Cloud 订阅"
  label: string
  description: string
}

function model(
  providerID: ApplicationAgentModelOption["providerID"],
  modelID: string,
  label: string,
  description: string,
): ApplicationAgentModelOption {
  const subscription = providerID === "opencode-go" ? "OpenCode Go 订阅" : "Ollama Cloud 订阅"
  return {
    id: `${providerID}/${modelID}`,
    modelID,
    providerID,
    subscription,
    label,
    description,
  }
}

// Hard-coded multimodal (and explicitly requested) application models.
// Default stays the first OpenCode Go entry for installs without Ollama Cloud.
export const APPLICATION_AGENT_MODELS: ApplicationAgentModelOption[] = [
  // —— OpenCode Go 订阅（多模态）——
  model("opencode-go", "qwen3.7-plus", "千问 Qwen 3.7 Plus", "默认。多模态，综合能力强，填表质量稳。"),
  model("opencode-go", "qwen3.6-plus", "千问 Qwen 3.6 Plus", "多模态。上一代千问 Plus。"),
  model("opencode-go", "qwen3.5-plus", "千问 Qwen 3.5 Plus", "多模态。更早一代千问 Plus。"),
  model("opencode-go", "kimi-k2.6", "Kimi K2.6", "多模态。长程 Agent / 工具调用。"),
  model("opencode-go", "kimi-k2.5", "Kimi K2.5", "多模态。通用 Agent。"),
  model("opencode-go", "mimo-v2.5", "小米 MiMo V2.5", "多模态。上下文更长，长会话更稳。"),
  model("opencode-go", "mimo-v2.5-pro", "小米 MiMo V2.5 Pro", "更强 MiMo；目录以文本为主，附件能力保留。"),
  model("opencode-go", "mimo-v2-omni", "小米 MiMo V2 Omni", "多模态（图/音/PDF）。"),
  model("opencode-go", "mimo-v2-pro", "小米 MiMo V2 Pro", "MiMo Pro；目录以文本为主，附件能力保留。"),

  // —— Ollama Cloud 订阅（多模态 + 你点名的型号）——
  model("ollama-cloud", "qwen3.5:397b", "千问 Qwen 3.5 397B", "多模态。大参数千问云端。"),
  model("ollama-cloud", "qwen3-vl:235b", "千问 Qwen3-VL 235B", "多模态视觉专用。"),
  model("ollama-cloud", "qwen3-vl:235b-instruct", "千问 Qwen3-VL 235B Instruct", "多模态视觉 Instruct。"),
  model("ollama-cloud", "kimi-k2.6", "Kimi K2.6", "多模态。长程 Agent / 工具调用。"),
  model("ollama-cloud", "kimi-k2.5", "Kimi K2.5", "多模态。通用 Agent。"),
  model("ollama-cloud", "kimi-k2.7-code", "Kimi K2.7 Code", "多模态。偏长程写代码与工具调用。"),
  model("ollama-cloud", "minimax-m3", "MiniMax M3", "多模态。1M 上下文，Coding & Agentic。"),
  model("ollama-cloud", "gemini-3-flash-preview", "Gemini 3 Flash Preview", "多模态。偏快。"),
  model("ollama-cloud", "gemma4:31b", "Gemma 4 31B", "多模态。"),
  model("ollama-cloud", "gemma3:27b", "Gemma 3 27B", "多模态。"),
  model("ollama-cloud", "gemma3:12b", "Gemma 3 12B", "多模态。"),
  model("ollama-cloud", "gemma3:4b", "Gemma 3 4B", "多模态。更轻。"),
  model("ollama-cloud", "mistral-large-3:675b", "Mistral Large 3 675B", "多模态。生产向大模型。"),
  model("ollama-cloud", "ministral-3:14b", "Ministral 3 14B", "多模态。"),
  model("ollama-cloud", "ministral-3:8b", "Ministral 3 8B", "多模态。"),
  model("ollama-cloud", "ministral-3:3b", "Ministral 3 3B", "多模态。更轻。"),
  model("ollama-cloud", "devstral-small-2:24b", "Devstral Small 2 24B", "多模态。偏开发。"),
  // 英伟达：当前目录未标 vision，按你的要求仍加入可选
  model("ollama-cloud", "nemotron-3-super", "英伟达 Nemotron 3 Super", "英伟达云端 Agent。目录为文本（非视觉），适合多 Agent。"),
  model("ollama-cloud", "nemotron-3-ultra", "英伟达 Nemotron 3 Ultra", "英伟达云端高吞吐 Agent。目录为文本（非视觉）。"),
  model("ollama-cloud", "nemotron-3-nano:30b", "英伟达 Nemotron 3 Nano 30B", "英伟达轻量 Agent。目录为文本（非视觉）。"),
]

export const APPLICATION_AGENT_MODEL_ID = APPLICATION_AGENT_MODELS[0].id
export const APPLICATION_AGENT_MODEL = `${APPLICATION_AGENT_MODELS[0].providerID}/${APPLICATION_AGENT_MODELS[0].modelID}`

export function resolveApplicationAgentModel(
  modelId?: string,
  providerID?: string,
): { providerID: string; modelID: string; optionID: string } {
  const raw = (modelId || "").trim()
  const providerHint = (providerID || "").trim()
  const fallback = APPLICATION_AGENT_MODELS[0]

  const byOptionID = APPLICATION_AGENT_MODELS.find((option) => option.id === raw)
  if (byOptionID) {
    return { providerID: byOptionID.providerID, modelID: byOptionID.modelID, optionID: byOptionID.id }
  }

  const byModelID = APPLICATION_AGENT_MODELS.filter((option) => option.modelID === raw)
  const selected =
    (providerHint ? byModelID.find((option) => option.providerID === providerHint) : undefined) ||
    byModelID[0] ||
    (providerHint ? APPLICATION_AGENT_MODELS.find((option) => option.providerID === providerHint && option.id.endsWith("/" + raw)) : undefined)

  if (selected) {
    return { providerID: selected.providerID, modelID: selected.modelID, optionID: selected.id }
  }

  return { providerID: fallback.providerID, modelID: fallback.modelID, optionID: fallback.id }
}
