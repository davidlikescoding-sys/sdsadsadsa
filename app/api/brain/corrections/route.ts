import { publicErrorMessage } from "@/lib/api-error";
import { ftsTerms, getBrainDb, hashBrainText, insertCorrection, markDisputed, searchFts, upsertKnowledge } from "@/lib/brain/db";
import { classifyBrainCategory, tokenizeBrainText } from "@/lib/brain/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeId(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : "";
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const corrected = typeof body.correction === "string" ? body.correction.trim() : "";
    if (corrected.length < 3) return Response.json({ ok: false, error: "Provide a correction." }, { status: 400 });
    const userMessage = typeof body.userMessage === "string" ? body.userMessage : "";
    const assistantResponse = typeof body.assistantResponse === "string" ? body.assistantResponse : "";
    const conversationId = safeId(body.conversationId);
    const userMessageId = safeId(body.userMessageId);
    const assistantMessageId = safeId(body.assistantMessageId);
    // The assistant answer is the thing being corrected; keep the user message
    // as secondary provenance instead of mislabelling it as messageId.
    const correctedMessageId = assistantMessageId || userMessageId;
    const db = getBrainDb();
    const context = `${userMessage} ${assistantResponse} ${corrected}`;
    const query = ftsTerms(context);
    const prior = query ? searchFts(db, "brain_fts", query, 5).map((hit) => hit.id) : [];
    const disputed = markDisputed(db, prior);
    const keywords = tokenizeBrainText(context);
    const entry = upsertKnowledge(db, {
      title: `Correction: ${corrected.slice(0, 60)}`,
      content: `Correction from user: ${corrected.slice(0, 1200)}`,
      category: classifyBrainCategory(context),
      keywords,
      source: `conversation:${conversationId || "unknown"}`,
      sourceType: "user_correction",
      sourceId: correctedMessageId || userMessageId || undefined,
      confidence: 0.82,
      verification: "user-reported",
      relatedIds: prior,
      hash: hashBrainText(`user-correction:${corrected}`),
    });
    const correction = insertCorrection(db, {
      knowledgeId: entry?.id ?? prior[0] ?? "",
      conversationId,
      messageId: correctedMessageId,
      original: assistantResponse.slice(0, 1000) || userMessage.slice(0, 1000),
      corrected: corrected.slice(0, 1000),
      source: assistantMessageId ? "user feedback on assistant response" : "user feedback",
      confidence: 0.82,
    });
    return Response.json({ ok: true, correction, disputed, knowledgeId: entry?.id });
  } catch (error) {
    return Response.json({ ok: false, error: publicErrorMessage(error, "Could not save the correction.") }, { status: 500 });
  }
}
