import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

type CapturedCall = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function post(body: unknown, signal?: AbortSignal): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

function configureOpenAiMock() {
  const calls: CapturedCall[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return jsonResponse({ choices: [{ message: { content: "DavidAI is online." } }] });
  }));
  vi.stubEnv("DAVIDAI_LLM_PROVIDER", "openai-compatible");
  vi.stubEnv("DAVIDAI_LLM_API_KEY", "test-key");
  vi.stubEnv("DAVIDAI_LLM_BASE_URL", "https://api.example.com/v1");
  vi.stubEnv("DAVIDAI_LLM_MODEL", "test-model");
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/chat", () => {
  it("reports configuration without exposing credentials", async () => {
    vi.stubEnv("DAVIDAI_LLM_API_KEY", "super-secret");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.configured).toBe(true);
    expect(JSON.stringify(body)).not.toContain("super-secret");
  });
});

describe("POST /api/chat", () => {
  it("returns a real provider response", async () => {
    configureOpenAiMock();
    const response = await POST(post({ messages: [{ role: "user", content: "Hello DavidAI" }] }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      text: "DavidAI is online.",
      provider: "openai-compatible",
      model: "test-model",
    });
    expect(body.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("passes uploaded context into the system prompt", async () => {
    const calls = configureOpenAiMock();
    await POST(post({
      messages: [{ role: "user", content: "What does the project notes say?" }],
      context: [{ title: "Project notes", type: "knowledge", content: "DavidAI uses a server-side model." }],
    }));
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.messages[0].content).toContain("Source 1: Project notes (knowledge)");
    expect(sent.messages[0].content).toContain("DavidAI uses a server-side model.");
  });

  it("tells the model when uploaded knowledge does not contain an answer", async () => {
    const calls = configureOpenAiMock();
    await POST(post({ messages: [{ role: "user", content: "What is in my files about quantum finance?" }] }));
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.messages[0].content).toContain("No uploaded excerpts were relevant");
    expect(sent.messages[0].content).toContain("Never invent file contents");
  });

  it("sends only the active conversation's recent messages", async () => {
    const calls = configureOpenAiMock();
    const messages = Array.from({ length: 24 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message ${index}`,
    }));
    await POST(post({ messages }));
    const sent = JSON.parse(calls[0].init.body as string);
    const history = sent.messages.slice(1);
    expect(history).toHaveLength(16);
    expect(history[0].content).toBe("message 8");
    expect(history.at(-1).content).toBe("message 23");
  });

  it("returns a safe error when the model provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { message: "Quota exceeded" } }, 429)));
    vi.stubEnv("DAVIDAI_LLM_API_KEY", "test-key");
    vi.stubEnv("DAVIDAI_LLM_BASE_URL", "https://api.example.com/v1");
    const response = await POST(post({ messages: [{ role: "user", content: "Hi" }] }));
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "rate_limit", message: "Quota exceeded" },
    });
  });

  it("rejects malformed requests before calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(post({ messages: [] }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports when no provider is configured", async () => {
    vi.stubEnv("DAVIDAI_LLM_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("DAVIDAI_LLM_BASE_URL", "https://api.example.com/v1");
    const response = await POST(post({ messages: [{ role: "user", content: "Hi" }] }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_configured" } });
  });
});
