import { makeId } from "./storage";
import type { ChatMessage, Conversation } from "./types";

/** Only the active conversation is ever sent to the model. */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatContextSource {
  title: string;
  type: "dataset" | "knowledge";
  content: string;
}

export interface ChatRequestPayload {
  messages: ChatTurn[];
  context?: ChatContextSource[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatResponsePayload {
  text: string;
  provider: string;
  model: string;
  elapsedMs: number;
  usage?: ChatUsage;
}

export const MAX_HISTORY_TURNS = 16;

export function recentTurns(messages: ChatMessage[], limit = MAX_HISTORY_TURNS): ChatTurn[] {
  return messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim().length > 0)
    .slice(-Math.max(2, Math.min(limit, 40)))
    .map((m) => ({ role: m.role, content: m.content.trim() }));
}

export function titleFromMessage(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  return clean.length > 42 ? `${clean.slice(0, 42).trimEnd()}…` : clean;
}

export function createConversation(title = "New conversation"): Conversation {
  const timestamp = new Date().toISOString();
  return { id: makeId(), title, messages: [], createdAt: timestamp, updatedAt: timestamp };
}
