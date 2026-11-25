import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { documentsFromStore, retrieveContext } from "@/lib/rag";
import { recentTurns } from "@/lib/chat";
import type { ChatMessage, Dataset, KnowledgeEntry } from "@/lib/types";

type CapturedCall = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockProvider(reply = "The real model answered.") {
  const calls: CapturedCall[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return jsonResponse({ choices: [{ message: { content: reply } }] });
  }));
  vi.stubEnv("DAVIDAI_LLM_PROVIDER", "openai-compatible");
  vi.stubEnv("DAVIDAI_LLM_API_KEY", "test-key");
  vi.stubEnv("DAVIDAI_LLM_BASE_URL", "https://api.example.com/v1");
  vi.stubEnv("DAVIDAI_LLM_MODEL", "scenario-model");
  return calls;
}

function sentPrompt(calls: CapturedCall[]): string {
  return (JSON.parse(calls[0].init.body as string).messages[0] as { content: string }).content;
}

function dataset(id: string, name: string, content: string): Dataset {
  return {
    id, name, content, description: "", category: "Uploaded", hash: id,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function knowledge(id: string, title: string, content: string): KnowledgeEntry {
  return {
    id, title, content, category: "General",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("chat scenarios (mocked provider verifies request plumbing)", () => {
  it("greeting: uses the DavidAI identity and a real model reply", async () => {
    const calls = mockProvider("Hi! I'm DavidAI.");
    const response = await POST(post({ messages: [{ role: "user", content: "Hello, who are you?" }] }));
    expect(response.status).toBe(200);
    expect(sentPrompt(calls)).toContain("You are DavidAI");
    const body = await response.json();
    expect(body.text).toBe("Hi! I'm DavidAI.");
    expect(body.provider).toBe("openai-compatible");
  });

  it("general knowledge: forwards the question without local guessing", async () => {
    const calls = mockProvider("The capital of France is Paris.");
    const response = await POST(post({ messages: [{ role: "user", content: "What is the capital of France?" }] }));
    expect(response.status).toBe(200);
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.messages.at(-1)).toEqual({ role: "user", content: "What is the capital of France?" });
    expect(sent.messages[0].content).toContain("Admit uncertainty instead of guessing");
  });

  it("math: forwards the calculation to the model", async () => {
    const calls = mockProvider("17 * 24 = 408.");
    const response = await POST(post({ messages: [{ role: "user", content: "What is 17 times 24?" }] }));
    expect(response.status).toBe(200);
    expect(JSON.parse(calls[0].init.body as string).messages.at(-1).content).toBe("What is 17 times 24?");
  });

  it("multi-message conversation: keeps earlier turns in order", async () => {
    const calls = mockProvider();
    await POST(post({ messages: [
      { role: "user", content: "My name is Sam." },
      { role: "assistant", content: "Nice to meet you, Sam." },
      { role: "user", content: "What is my name?" },
    ] }));
    const history = JSON.parse(calls[0].init.body as string).messages.slice(1);
    expect(history).toEqual([
      { role: "user", content: "My name is Sam." },
      { role: "assistant", content: "Nice to meet you, Sam." },
      { role: "user", content: "What is my name?" },
    ]);
  });

  it("conversation memory: only recent turns are sent and empty turns dropped", async () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "user", content: "old message", timestamp: "2026-01-01T00:00:00.000Z" },
      { id: "2", role: "assistant", content: "", timestamp: "2026-01-01T00:00:00.000Z" },
      { id: "3", role: "user", content: "remember the code is blue", timestamp: "2026-01-01T00:00:00.000Z" },
      { id: "4", role: "assistant", content: "Noted: blue.", timestamp: "2026-01-01T00:00:00.000Z" },
      { id: "5", role: "user", content: "What color is the code?", timestamp: "2026-01-01T00:00:00.000Z" },
    ];
    expect(recentTurns(messages, 4)).toEqual([
      { role: "user", content: "old message" },
      { role: "user", content: "remember the code is blue" },
      { role: "assistant", content: "Noted: blue." },
      { role: "user", content: "What color is the code?" },
    ]);
  });

  it("uploaded dataset question: retrieved TXT/JSON content is injected as context", async () => {
    const calls = mockProvider();
    const documents = documentsFromStore(
      [dataset("d1", "spec.txt", "The deployment port is 8080."), dataset("d2", "config.json", '{"api": {"timeout": 30}}')],
      [],
    );
    const retrieval = retrieveContext("What is the deployment port in spec.txt?", documents);
    expect(retrieval.sources.length).toBeGreaterThan(0);
    expect(retrieval.sources[0].content).toContain("8080");

    const response = await POST(post({
      messages: [{ role: "user", content: "What is the deployment port in spec.txt?" }],
      context: retrieval.sources,
    }));
    expect(response.status).toBe(200);
    const prompt = sentPrompt(calls);
    expect(prompt).toContain("spec.txt");
    expect(prompt).toContain("8080");
    expect(prompt).toContain("Treat it as the highest authority");
  });

  it("uploaded knowledge question: knowledge entries are prioritized", async () => {
    const calls = mockProvider();
    const documents = documentsFromStore(
      [dataset("d1", "notes.txt", "General notes about training.")],
      [knowledge("k1", "Policy", "The refund window is 30 days.")],
    );
    const retrieval = retrieveContext("What is the refund window?", documents);
    await POST(post({
      messages: [{ role: "user", content: "What is the refund window?" }],
      context: retrieval.sources,
    }));
    const prompt = sentPrompt(calls);
    expect(prompt).toContain("Knowledge: Policy");
    expect(prompt).toContain("30 days");
  });

  it("unknown question: model is told when uploaded knowledge has no answer", async () => {
    const calls = mockProvider();
    const documents = documentsFromStore([], [knowledge("k1", "Policy", "The refund window is 30 days.")]);
    const retrieval = retrieveContext("What is the CEO's favorite color?", documents);
    expect(retrieval.sources).toEqual([]);

    const response = await POST(post({
      messages: [{ role: "user", content: "What is the CEO's favorite color?" }],
      context: retrieval.sources,
    }));
    expect(response.status).toBe(200);
    const prompt = sentPrompt(calls);
    expect(prompt).toContain("No uploaded excerpts were relevant");
    expect(prompt).toContain("Never invent file contents");
  });

  it("API failure: provider errors surface instead of a fallback answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { message: "Service unavailable" } }, 503)));
    vi.stubEnv("DAVIDAI_LLM_API_KEY", "test-key");
    vi.stubEnv("DAVIDAI_LLM_BASE_URL", "https://api.example.com/v1");
    const response = await POST(post({ messages: [{ role: "user", content: "Hello" }] }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unavailable", message: "Service unavailable" },
    });
  });
});
