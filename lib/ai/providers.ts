import { createDeepSeek } from "@ai-sdk/deepseek";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from "ai";
import { isTestEnvironment } from "../constants";

// Initialize DeepSeek client with Beta endpoint for strict mode (fixes JSON format issues)
const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/beta",  // Strict mode - fixes UUID quoting issues
});

// Initialize Anthropic Claude client
const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const myProvider = isTestEnvironment
  ? (() => {
    const {
      artifactModel,
      chatModel,
      reasoningModel,
      titleModel,
    } = require("./models.mock");
    return customProvider({
      languageModels: {
        "chat-model": chatModel,
        "chat-model-reasoning": reasoningModel,
        "title-model": titleModel,
        "artifact-model": artifactModel,
      },
    });
  })()
  : customProvider({
    languageModels: {
      // SmartCFO Base - DeepSeek for general chat (cost-effective)
      "chat-model": deepseek("deepseek-chat"),
      // DeepSeek with thinking mode for complex reasoning
      "chat-model-reasoning": wrapLanguageModel({
        model: deepseek("deepseek-chat"),
        middleware: extractReasoningMiddleware({ tagName: "think" }),
      }),
      // SmartCFO Nexus - Claude for advanced reasoning and tool use
      "claude-chat": anthropic("claude-sonnet-4-20250514"),
      // DeepSeek for title generation (lighter tasks)
      "title-model": deepseek("deepseek-chat"),
      // DeepSeek for artifact generation
      "artifact-model": deepseek("deepseek-chat"),
    },
  });

