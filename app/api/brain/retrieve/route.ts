import { publicErrorMessage } from "@/lib/api-error";
import { searchBrain } from "@/lib/brain/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      question?: unknown; limit?: unknown; includeConversations?: unknown;
      includeDocuments?: unknown; includeCorrections?: unknown; useSemantic?: unknown;
    };
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (question.length < 2) return Response.json({ ok: false, error: "Provide a question." }, { status: 400 });
    const requestedLimit = typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : 8;
    const items = await searchBrain(question, {
      limit: Math.min(Math.max(Math.floor(requestedLimit), 1), 20),
      includeConversations: body.includeConversations !== false,
      includeDocuments: body.includeDocuments !== false,
      includeCorrections: body.includeCorrections !== false,
      useSemantic: body.useSemantic !== false,
      signal: request.signal,
    });
    return Response.json({ ok: true, question, items });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return Response.json({ ok: false, error: publicErrorMessage(error, "Retrieval failed.") }, { status: 500 });
  }
}
