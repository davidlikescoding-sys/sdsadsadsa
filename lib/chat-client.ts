import type { ChatRequestPayload, ChatResponsePayload } from "./chat";

export interface ChatStatus {
  configured: boolean;
  provider?: string;
  model?: string;
  code?: string;
}

export class ChatApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "request_failed", status = 502) {
    super(message);
    this.name = "ChatApiError";
    this.code = code;
    this.status = status;
  }
}

export async function getChatStatus(signal?: AbortSignal): Promise<ChatStatus> {
  const response = await fetch("/api/chat", { method: "GET", signal });
  if (!response.ok) return { configured: false, code: "status_unavailable" };
  return (await response.json()) as ChatStatus;
}

export async function requestChatCompletion(payload: ChatRequestPayload, signal?: AbortSignal): Promise<ChatResponsePayload> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  let data: ChatResponsePayload & { error?: { code?: string; message?: string } };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    throw new ChatApiError("DavidAI received an unreadable response from the server.", "invalid_response", response.status);
  }

  if (!response.ok) {
    throw new ChatApiError(
      data.error?.message ?? "DavidAI could not complete the request.",
      data.error?.code ?? "request_failed",
      response.status,
    );
  }
  return data;
}
