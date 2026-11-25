import { readWebPage } from "@/lib/research/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorJson(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function GET() {
  return Response.json({ ok: true, message: "POST a public http(s) URL to retrieve its readable text.", maxBytes: 1200000, timeoutMs: 9000 });
}

/** Retrieve a real webpage as sanitised text. The page's code is never executed. */
export async function POST(request: Request): Promise<Response> {
  let body: { url?: unknown; online?: unknown; offline?: unknown };
  try { body = await request.json(); } catch { return errorJson("bad_request", "A JSON body is required.", 400); }
  const offline = request.headers.get("x-davidai-online") === "false" || body.online === false || body.offline === true;
  if (offline) {
    return Response.json({
      ok: false, offline: true,
      error: { code: "offline", message: "The device is offline. No webpage was opened and no web research is claimed." },
    }, { status: 503 });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url || url.length > 2048) return errorJson("bad_request", "Provide a URL under 2048 characters.", 400);
  try {
    const page = await readWebPage(url, request.signal);
    return Response.json({ ok: true, page });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const message = error instanceof Error ? error.message : "Webpage could not be read.";
    return errorJson("read_failed", message, /not allowed|only http|Invalid URL|resolve|ports|credentials/i.test(message) ? 400 : 502);
  }
}
