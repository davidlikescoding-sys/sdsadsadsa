import { deleteKnowledge, getBrainDb, listKnowledge, updateKnowledge } from "@/lib/brain/db";
import { BRAIN_CATEGORIES, type BrainCategory, type VerificationStatus } from "@/lib/brain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERIFICATIONS: VerificationStatus[] = ["unverified", "user-reported", "sourced", "disputed", "outdated"];

export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? "";
    const category = url.searchParams.get("category") ?? "all";
    const limit = Number(url.searchParams.get("limit") ?? 200);
    const entries = listKnowledge(getBrainDb(), {
      search: search || undefined,
      category: BRAIN_CATEGORIES.includes(category as BrainCategory) || category === "all" ? category : undefined,
      limit: Number.isFinite(limit) ? limit : 200,
    });
    return Response.json({ ok: true, entries });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not list knowledge." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: unknown; patch?: unknown };
    if (typeof body.id !== "string" || !body.patch || typeof body.patch !== "object") {
      return Response.json({ ok: false, error: "Provide an id and a patch object." }, { status: 400 });
    }
    const raw = body.patch as Record<string, unknown>;
    const patch: Parameters<typeof updateKnowledge>[2] = {};
    if (typeof raw.title === "string") patch.title = raw.title;
    if (typeof raw.content === "string") patch.content = raw.content;
    if (typeof raw.category === "string" && BRAIN_CATEGORIES.includes(raw.category as BrainCategory)) patch.category = raw.category;
    if (Array.isArray(raw.keywords)) patch.keywords = raw.keywords.filter((value): value is string => typeof value === "string");
    if (typeof raw.confidence === "number" && Number.isFinite(raw.confidence)) patch.confidence = Math.max(0, Math.min(1, raw.confidence));
    if (typeof raw.verification === "string" && VERIFICATIONS.includes(raw.verification as VerificationStatus)) patch.verification = raw.verification;
    const entry = updateKnowledge(getBrainDb(), body.id, patch);
    if (!entry) return Response.json({ ok: false, error: "Knowledge entry not found." }, { status: 404 });
    return Response.json({ ok: true, entry });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the knowledge entry.";
    return Response.json({ ok: false, error: message }, { status: /already has this exact content/.test(message) ? 409 : 500 });
  }
}

export function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return Response.json({ ok: false, error: "Provide a knowledge id." }, { status: 400 });
    const deleted = deleteKnowledge(getBrainDb(), id);
    return Response.json({ ok: true, deleted });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not delete the knowledge entry." }, { status: 500 });
  }
}
