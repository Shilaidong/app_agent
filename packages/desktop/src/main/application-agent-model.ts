export const APPLICATION_AGENT_MODEL_ID = "qwen3.7-plus"
export const APPLICATION_AGENT_MODEL = `opencode-go/${APPLICATION_AGENT_MODEL_ID}`

export type ApplicationAgentModelOption = {
  id: string
  label: string
  description: string
}

// All models route through opencode-go so the consultant never needs to
// configure a separate provider. Add new models here; the renderer picks
// from this list at task start.
export const APPLICATION_AGENT_MODELS: ApplicationAgentModelOption[] = [
  {
    id: "qwen3.7-plus",
    label: "Qwen 3.7 Plus",
    description: "默认。综合能力强，填表质量稳。",
  },
  {
    id: "mimo-v2.5",
    label: "MiMo 2.5",
    description: "小米 MiMo V2.5。上下文 1M，长会话更稳。",
  },
  {
    id: "mimo-v2.5-pro",
    label: "MiMo 2.5 Pro",
    description: "MiMo V2.5 Pro。更强，更贵。",
  },
]

export function resolveApplicationAgentModel(modelId?: string): { providerID: string; modelID: string } {
  const id = (modelId || "").trim()
  const known = APPLICATION_AGENT_MODELS.some((option) => option.id === id)
  return {
    providerID: "opencode-go",
    modelID: known ? id : APPLICATION_AGENT_MODEL_ID,
  }
}