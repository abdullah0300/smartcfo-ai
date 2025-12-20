import { createDeepSeek } from "@ai-sdk/deepseek";
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
      // DeepSeek-V3.2 for general chat
      "chat-model": deepseek("deepseek-chat"),
      // DeepSeek with thinking mode for complex reasoning
      "chat-model-reasoning": wrapLanguageModel({
        model: deepseek("deepseek-chat"),
        middleware: extractReasoningMiddleware({ tagName: "think" }),
      }),
      // DeepSeek for title generation (lighter tasks)
      "title-model": deepseek("deepseek-chat"),
      // DeepSeek for artifact generation
      "artifact-model": deepseek("deepseek-chat"),
    },
  });

