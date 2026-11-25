import { searchSources, sourcesForIntent } from "@/lib/research/sources";
import type { ResearchIntent } from "@/lib/research/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTENTS: ResearchIntent[] = ["general", "news", "tutorial", "technical", "comparison"];

function errorJson(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function GET() {
  return Response.json({ ok: true, sources: sourcesForIntent("general"), allSources: ["wikipedia", "duckduckgo", "google-news", "hacker-news", "arxiv"], requiresKey: false });
}

/** Real web search across several free services. Each source reports its own outcome. */
export async function POST(request: Request): Promise<Response> {
  let body: { query?: unknown; intent?: unknown; online?: unknown; offline?: unknown };
  try { body = await request.json(); } catch { return errorJson("bad_request", "A JSON body is required.", 400); }
  const offline = request.headers.get("x-davidai-online") === "false" || body.online === false || body.offline === true;
  if (offline) {
    return Response.json({
      ok: false, offline: true, results: [], hits: 0,
      error: { code: "offline", message: "The device is offline. No web search was attempted and no web research is claimed." },
    }, { status: 503 });
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 2 || query.length > 200) return errorJson("bad_request", "Provide a search query between 2 and 200 characters.", 400);
  const intent = INTENTS.includes(body.intent as ResearchIntent) ? body.intent as ResearchIntent : "general";
  try {
    const results = await searchSources([query], intent, request.signal);
    const hits = results.reduce((total, result) => total + result.hits.length, 0);
    return Response.json({ ok: true, query, intent, results, hits, fetchedAt: new Date().toISOString() });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return errorJson("internal_error", error instanceof Error ? error.message : "Search failed.", 500);
  }
}
