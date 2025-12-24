export const DEFAULT_CHAT_MODEL: string = "chat-model";

export type ChatModel = {
  id: string;
  name: string;
  description: string;
};

export const chatModels: ChatModel[] = [
  {
    id: "chat-model",
    name: "SmartCFO Base",
    description: "Fast and cost-effective for everyday financial tasks",
  },
  {
    id: "claude-chat",
    name: "SmartCFO Nexus",
    description: "Advanced reasoning and superior tool use for complex operations",
  },
];
