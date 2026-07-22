import { describe, expect, test } from "bun:test"

import {
  APPLICATION_AGENT_MODEL,
  APPLICATION_AGENT_MODEL_ID,
  APPLICATION_AGENT_MODELS,
  resolveApplicationAgentModel,
} from "./application-agent-model"

describe("application agent models", () => {
  test("keeps the built-in model as the provider-independent fallback", () => {
    expect(APPLICATION_AGENT_MODEL_ID).toBe("opencode-go/qwen3.7-plus")
    expect(APPLICATION_AGENT_MODEL).toBe("opencode-go/qwen3.7-plus")
    expect(resolveApplicationAgentModel("unknown")).toEqual({
      providerID: "opencode-go",
      modelID: "qwen3.7-plus",
      optionID: "opencode-go/qwen3.7-plus",
    })
  })

  test("routes Qwen 3.5 through Ollama Cloud by option id or model id", () => {
    expect(resolveApplicationAgentModel("ollama-cloud/qwen3.5:397b")).toEqual({
      providerID: "ollama-cloud",
      modelID: "qwen3.5:397b",
      optionID: "ollama-cloud/qwen3.5:397b",
    })
    expect(resolveApplicationAgentModel("qwen3.5:397b")).toEqual({
      providerID: "ollama-cloud",
      modelID: "qwen3.5:397b",
      optionID: "ollama-cloud/qwen3.5:397b",
    })
  })

  test("disambiguates same model id across OpenCode Go and Ollama Cloud", () => {
    expect(resolveApplicationAgentModel("kimi-k2.6", "opencode-go")).toEqual({
      providerID: "opencode-go",
      modelID: "kimi-k2.6",
      optionID: "opencode-go/kimi-k2.6",
    })
    expect(resolveApplicationAgentModel("kimi-k2.6", "ollama-cloud")).toEqual({
      providerID: "ollama-cloud",
      modelID: "kimi-k2.6",
      optionID: "ollama-cloud/kimi-k2.6",
    })
  })

  test("exposes subscription-labeled multimodal catalogs for both providers", () => {
    expect(APPLICATION_AGENT_MODELS.some((item) => item.subscription === "OpenCode Go 订阅" && item.modelID === "kimi-k2.6")).toBe(true)
    expect(APPLICATION_AGENT_MODELS.some((item) => item.subscription === "Ollama Cloud 订阅" && item.modelID === "minimax-m3")).toBe(true)
    expect(APPLICATION_AGENT_MODELS.some((item) => item.subscription === "Ollama Cloud 订阅" && item.modelID === "nemotron-3-super")).toBe(true)
    expect(APPLICATION_AGENT_MODELS.every((item) => item.id === `${item.providerID}/${item.modelID}`)).toBe(true)
  })
})
