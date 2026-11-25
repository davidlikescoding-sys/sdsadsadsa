import { MAX_HISTORY_TURNS, type ChatContextSource, type ChatRequestPayload, type ChatTurn } from "@/lib/chat";
import { completeChat, getLlmConfig, LlmError } from "./provider";
import { buildSystemPrompt } from "./prompt";

export const runtime = "nodejs";

function limit(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function errorJson(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export function GET() {
  try {
    const config = getLlmConfig();
    return Response.json({ configured: true, provider: config.provider, model: config.model });
  } catch (error) {
    const code = error instanceof LlmError ? error.code : "not_configured";
    return Response.json({ configured: false, code });
  }
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  try {
    const body = (await request.json()) as Partial<ChatRequestPayload> | null;
    if (!body || typeof body !== "object" || !Array.isArray(body.messages)) {
      return errorJson("bad_request", "A messages array is required.", 400);
    }

    const turns: ChatTurn[] = [];
    for (const raw of body.messages.slice(0, 40)) {
      if (!raw || (raw.role !== "user" && raw.role !== "assistant") || typeof raw.content !== "string") continue;
      const content = raw.content.trim().slice(0, 12_000);
      if (content) turns.push({ role: raw.role, content });
    }
    if (!turns.length) return errorJson("bad_request", "No usable messages were provided.", 400);

    const context: ChatContextSource[] = Array.isArray(body.context)
      ? body.context.slice(0, 8).flatMap((item) => {
          if (!item || (item.type !== "dataset" && item.type !== "knowledge")) return [];
          const title = String(item.title ?? "Uploaded source").slice(0, 160);
          const content = String(item.content ?? "").slice(0, 8_000).trim();
          return content ? [{ title, type: item.type, content }] : [];
        })
      : [];

    let config;
    try {
      config = getLlmConfig();
    } catch (error) {
      if (error instanceof LlmError) return errorJson(error.code, error.message, error.status);
      throw error;
    }

    const completion = await completeChat(
      { ...config, temperature: limit(body.temperature, config.temperature, 0, 2), maxTokens: Math.floor(limit(body.maxTokens, config.maxTokens, 1, 4096)) },
      buildSystemPrompt(context),
      turns.slice(-MAX_HISTORY_TURNS),
      request.signal,
    );

    return Response.json({
      text: completion.text,
      provider: completion.provider,
      model: completion.model,
      elapsedMs: Date.now() - startedAt,
      usage: completion.usage,
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (error instanceof LlmError) return errorJson(error.code, error.message, error.status);
    console.error("Chat completion failed:", error);
    return errorJson("internal_error", "DavidAI could not complete the request. Check the server logs and provider configuration.", 500);
  }
}
