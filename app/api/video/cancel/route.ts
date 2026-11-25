import { cancelGeneration, getGenerationQueueStatus } from "@/lib/image/generation-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Video shares the single local render slot with the image lab. */
export async function POST(request: Request) {
  let id = "";
  const raw = await request.text().catch(() => "");
  if (raw) {
    try {
      const body = JSON.parse(raw) as { id?: unknown };
      id = typeof body.id === "string" ? body.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100) : "";
    } catch { /* no body keeps the legacy global scope */ }
  }
  const scope = cancelGeneration(id || undefined);
  return Response.json({ ok: true, cancelled: scope !== null, scope, queue: getGenerationQueueStatus() });
}
