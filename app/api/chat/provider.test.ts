import { afterEach, describe, expect, it, vi } from "vitest";
import { completeChat, getLlmConfig, LlmError } from "./provider";

type CapturedCall = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("server LLM configuration", () => {
  it("reads server-only env vars and rejects a missing remote key", () => {
    const config = getLlmConfig({
      DAVIDAI_LLM_PROVIDER: "openai-compatible",
      DAVIDAI_LLM_API_KEY: "sk-test",
      DAVIDAI_LLM_BASE_URL: "https://api.example.com/v1/",
      DAVIDAI_LLM_MODEL: "test-model",
    });
    expect(config).toMatchObject({
      provider: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "test-model",
    });

    expect(() => getLlmConfig({ DAVIDAI_LLM_BASE_URL: "https://api.example.com/v1" })).toThrowError(LlmError);
  });

  it("allows a keyless local OpenAI-compatible endpoint", () => {
    const config = getLlmConfig({
      DAVIDAI_LLM_BASE_URL: "http://localhost:11434/v1",
      DAVIDAI_LLM_MODEL: "llama3.2",
    });
    expect(config.apiKey).toBe("");
    expect(config.model).toBe("llama3.2");
  });
});

describe("OpenAI-compatible provider", () => {
  it("sends the system prompt and returns the model text", async () => {
    const calls: CapturedCall[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({
        choices: [{ message: { content: "Hello from the real model." } }],
        usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
      });
    }));

    const config = getLlmConfig({
      DAVIDAI_LLM_API_KEY: "sk-test",
      DAVIDAI_LLM_BASE_URL: "https://api.example.com/v1/",
      DAVIDAI_LLM_MODEL: "test-model",
    });
    const result = await completeChat(config, "You are DavidAI.", [{ role: "user", content: "Hi" }]);

    expect(result).toMatchObject({ text: "Hello from the real model.", provider: "openai-compatible", model: "test-model" });
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 6, totalTokens: 18 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example.com/v1/chat/completions");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "You are DavidAI." },
      { role: "user", content: "Hi" },
    ]);
  });

  it("maps provider failures to safe structured errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { message: "Invalid API key" } }, 401)));
    const config = getLlmConfig({ DAVIDAI_LLM_API_KEY: "bad", DAVIDAI_LLM_BASE_URL: "https://api.example.com/v1" });
    await expect(completeChat(config, "sys", [{ role: "user", content: "Hi" }])).rejects.toMatchObject({
      code: "auth",
      status: 401,
      message: "Invalid API key",
    });
  });

  it("rejects empty model output", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ choices: [{ message: { content: "   " } }] })));
    const config = getLlmConfig({ DAVIDAI_LLM_API_KEY: "key", DAVIDAI_LLM_BASE_URL: "https://api.example.com/v1" });
    await expect(completeChat(config, "sys", [{ role: "user", content: "Hi" }])).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});

describe("other provider adapters", () => {
  it("uses the Anthropic messages API without leaking a bearer header", async () => {
    const calls: CapturedCall[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({ content: [{ type: "text", text: "Anthropic answer" }], usage: { input_tokens: 8, output_tokens: 4 } });
    }));
    const config = getLlmConfig({
      DAVIDAI_LLM_PROVIDER: "anthropic",
      DAVIDAI_LLM_API_KEY: "sk-ant-test",
      DAVIDAI_LLM_MODEL: "claude-test",
    });
    const result = await completeChat(config, "sys", [
      { role: "user", content: "First" },
      { role: "assistant", content: "Reply" },
      { role: "user", content: "Second" },
    ]);
    expect(result.text).toBe("Anthropic answer");
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(calls[0].init.body as string).system).toBe("sys");
  });

  it("uses the Gemini generateContent API", async () => {
    const calls: CapturedCall[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({ candidates: [{ content: { parts: [{ text: "Gemini answer" }] } }] });
    }));
    const config = getLlmConfig({
      DAVIDAI_LLM_PROVIDER: "gemini",
      DAVIDAI_LLM_API_KEY: "gemini-test",
      DAVIDAI_LLM_MODEL: "gemini-test-model",
    });
    const result = await completeChat(config, "sys", [{ role: "user", content: "Hi" }]);
    expect(result.text).toBe("Gemini answer");
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.contents[0].role).toBe("user");
    expect(body.systemInstruction.parts[0].text).toBe("sys");
  });
});
