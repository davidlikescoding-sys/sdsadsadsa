import type { ChatTurn, ChatUsage } from "@/lib/chat";

export type LlmProvider = "openai-compatible" | "anthropic" | "gemini";

export interface LlmConfig {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface LlmCompletion {
  text: string;
  provider: LlmProvider;
  model: string;
  usage?: ChatUsage;
}

export type LlmErrorCode =
  | "not_configured"
  | "bad_request"
  | "auth"
  | "rate_limit"
  | "unavailable"
  | "timeout"
  | "invalid_response";

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly status: number;

  constructor(message: string, code: LlmErrorCode, status = 502) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.status = status;
  }
}

type Env = Record<string, string | undefined>;

function first(...values: Array<string | undefined>): string {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}

function numberValue(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function isLocalUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
  } catch {
    return false;
  }
}

export function getLlmConfig(env: Env = process.env): LlmConfig {
  const providerValue = first(env.DAVIDAI_LLM_PROVIDER, env.LLM_PROVIDER, "openai-compatible").toLowerCase();
  const provider: LlmProvider =
    providerValue === "anthropic" || providerValue === "gemini" || providerValue === "openai-compatible"
      ? providerValue
      : "openai-compatible";

  const baseUrl = first(
    env.DAVIDAI_LLM_BASE_URL,
    provider === "openai-compatible" ? first(env.OPENAI_BASE_URL, env.OPENAI_API_BASE) : "",
    provider === "anthropic" ? env.ANTHROPIC_BASE_URL : "",
    provider === "gemini" ? first(env.GEMINI_BASE_URL, env.GOOGLE_API_BASE_URL) : "",
    provider === "openai-compatible" ? "https://api.openai.com/v1" : "",
    provider === "anthropic" ? "https://api.anthropic.com" : "",
    "https://generativelanguage.googleapis.com",
  ).replace(/\/+$/, "");

  const apiKey = first(
    env.DAVIDAI_LLM_API_KEY,
    provider === "openai-compatible" ? env.OPENAI_API_KEY : "",
    provider === "anthropic" ? env.ANTHROPIC_API_KEY : "",
    provider === "gemini" ? first(env.GEMINI_API_KEY, env.GOOGLE_GENERATIVE_AI_API_KEY, env.GOOGLE_API_KEY) : "",
  );

  if (!apiKey && !isLocalUrl(baseUrl)) {
    throw new LlmError(
      `No API key configured for ${provider}. Set DAVIDAI_LLM_API_KEY (or the provider-specific key) on the server.`,
      "not_configured",
      503,
    );
  }

  const defaultModel =
    provider === "openai-compatible" ? "gpt-4o-mini" : provider === "anthropic" ? "claude-3-5-haiku-latest" : "gemini-2.0-flash";
  const model = first(
    env.DAVIDAI_LLM_MODEL,
    provider === "openai-compatible" ? env.OPENAI_MODEL : "",
    provider === "anthropic" ? env.ANTHROPIC_MODEL : "",
    provider === "gemini" ? env.GEMINI_MODEL : "",
    defaultModel,
  );

  return {
    provider,
    baseUrl,
    apiKey,
    model,
    temperature: numberValue(first(env.DAVIDAI_LLM_TEMPERATURE, "0.4"), 0.4, 0, 2),
    maxTokens: Math.floor(numberValue(first(env.DAVIDAI_LLM_MAX_TOKENS, "600"), 600, 1, 8192)),
    timeoutMs: Math.floor(numberValue(first(env.DAVIDAI_LLM_TIMEOUT_MS, "60000"), 60000, 5000, 300000)),
  };
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function cleanDetail(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function providerError(status: number, detail: string): LlmError {
  const code: LlmErrorCode =
    status === 401 || status === 403 ? "auth" : status === 429 ? "rate_limit" : status >= 500 ? "unavailable" : "bad_request";
  return new LlmError(detail || `The model provider returned HTTP ${status}.`, code, status);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const relay = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) relay();
  else externalSignal?.addEventListener("abort", relay, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (!externalSignal?.aborted && controller.signal.aborted) {
      throw new LlmError("The model request timed out. Try again or reduce the response length.", "timeout", 504);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", relay);
  }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new LlmError("The model provider returned an unreadable response.", "invalid_response");
  }
}

function checkedText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new LlmError("The model returned an empty response.", "invalid_response");
  return trimmed;
}

function mergedTurns(turns: ChatTurn[]): ChatTurn[] {
  const merged: ChatTurn[] = [];
  for (const turn of turns) {
    const content = turn.content.trim();
    if (!content) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${content}`;
    else merged.push({ role: turn.role, content });
  }
  return merged;
}

async function openAiCompatible(config: LlmConfig, system: string, turns: ChatTurn[], signal?: AbortSignal): Promise<LlmCompletion> {
  const response = await fetchWithTimeout(
    joinUrl(config.baseUrl, "chat/completions"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: false,
        messages: [{ role: "system", content: system }, ...turns],
      }),
    },
    config.timeoutMs,
    signal,
  );

  const data = await responseJson(response);
  if (!response.ok) {
    const message = cleanDetail((data.error as { message?: unknown } | undefined)?.message) || cleanDetail(data.message);
    throw providerError(response.status, message);
  }
  const choices = data.choices as Array<{ message?: { content?: unknown }; text?: unknown }> | undefined;
  const content = choices?.[0]?.message?.content ?? choices?.[0]?.text;
  if (typeof content !== "string") throw new LlmError("The model response did not contain text.", "invalid_response");
  const usage = data.usage as Record<string, unknown> | undefined;
  return {
    text: checkedText(content),
    provider: config.provider,
    model: config.model,
    usage: usage ? {
      promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
      completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined,
      totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
    } : undefined,
  };
}

async function anthropic(config: LlmConfig, system: string, turns: ChatTurn[], signal?: AbortSignal): Promise<LlmCompletion> {
  const response = await fetchWithTimeout(
    joinUrl(config.baseUrl, "v1/messages"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system,
        messages: mergedTurns(turns),
      }),
    },
    config.timeoutMs,
    signal,
  );

  const data = await responseJson(response);
  if (!response.ok) {
    const message = cleanDetail((data.error as { message?: unknown } | undefined)?.message) || cleanDetail(data.message);
    throw providerError(response.status, message);
  }
  const blocks = data.content as Array<{ type?: string; text?: unknown }> | undefined;
  const text = (blocks ?? []).filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
  const usage = data.usage as Record<string, unknown> | undefined;
  return {
    text: checkedText(text),
    provider: config.provider,
    model: config.model,
    usage: usage ? {
      promptTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
      completionTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
    } : undefined,
  };
}

async function gemini(config: LlmConfig, system: string, turns: ChatTurn[], signal?: AbortSignal): Promise<LlmCompletion> {
  const url = joinUrl(config.baseUrl, `v1beta/models/${encodeURIComponent(config.model)}:generateContent`);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["x-goog-api-key"] = config.apiKey;
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((turn) => ({
          role: turn.role === "assistant" ? "model" : "user",
          parts: [{ text: turn.content }],
        })),
        generationConfig: {
          temperature: config.temperature,
          maxOutputTokens: config.maxTokens,
        },
      }),
    },
    config.timeoutMs,
    signal,
  );

  const data = await responseJson(response);
  if (!response.ok) {
    const message = cleanDetail((data.error as { message?: unknown } | undefined)?.message) || cleanDetail(data.message);
    throw providerError(response.status, message);
  }
  const blockReason = cleanDetail((data.promptFeedback as { blockReason?: unknown } | undefined)?.blockReason);
  if (blockReason) throw new LlmError(`The model blocked this request (${blockReason}).`, "bad_request", 400);
  const candidates = data.candidates as Array<{ content?: { parts?: Array<{ text?: unknown }> } }> | undefined;
  const text = (candidates?.[0]?.content?.parts ?? [])
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
  const usage = data.usageMetadata as Record<string, unknown> | undefined;
  return {
    text: checkedText(text),
    provider: config.provider,
    model: config.model,
    usage: usage ? {
      promptTokens: typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : undefined,
      completionTokens: typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : undefined,
      totalTokens: typeof usage.totalTokenCount === "number" ? usage.totalTokenCount : undefined,
    } : undefined,
  };
}

export async function completeChat(
  config: LlmConfig,
  system: string,
  turns: ChatTurn[],
  signal?: AbortSignal,
): Promise<LlmCompletion> {
  if (config.provider === "anthropic") return anthropic(config, system, turns, signal);
  if (config.provider === "gemini") return gemini(config, system, turns, signal);
  return openAiCompatible(config, system, turns, signal);
}
