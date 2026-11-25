import { runVisualResearch } from "@/lib/image/visual-research";
import { normalizeConcept } from "@/lib/image/visual-knowledge";
import type { VisualSubject } from "@/lib/image/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorJson(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: {
    prompt?: unknown; subjects?: unknown; concepts?: unknown; force?: unknown; maxReferences?: unknown;
  };
  try { body = await request.json(); } catch { return errorJson("A JSON body is required.", 400); }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1200) : "";
  if (prompt.length < 3) return errorJson("Describe the image you want before researching references.", 400);

  const subjects: VisualSubject[] = Array.isArray(body.subjects) ? body.subjects.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Partial<VisualSubject>;
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "";
    if (!name) return [];
    const category = typeof raw.category === "string" ? raw.category : "concept";
    const confidence = Number(raw.confidence);
    return [{
      name,
      category: category as VisualSubject["category"],
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.4,
      basis: Array.isArray(raw.basis) ? raw.basis.filter((entry): entry is string => typeof entry === "string").slice(0, 4) : [],
    }];
  }).slice(0, 6) : [];

  const concepts = Array.isArray(body.concepts) ? body.concepts.flatMap((item) => {
    const normalized = normalizeConcept(item);
    return normalized ? [normalized] : [];
  }).slice(0, 400) : [];

  if (!subjects.length) return errorJson("No visual subjects were identified in that request.", 422);

  try {
    const result = await runVisualResearch({
      prompt,
      subjects,
      concepts,
      force: Boolean(body.force),
      maxReferences: Math.max(1, Math.min(10, Number(body.maxReferences) || 6)),
      signal: request.signal,
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return errorJson(error instanceof Error ? error.message : "Visual research failed.", 500);
  }
}
