import { makeId } from "@/lib/storage";
import { readImageMetadata, writeImageMetadata } from "@/lib/image/generator";
import type { ImageFeedback } from "@/lib/image/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stores feedback beside the generated image. No model retraining is triggered. */
export async function POST(request: Request): Promise<Response> {
  let body: { imageId?: unknown; feedback?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "A JSON body is required." }, { status: 400 }); }
  const imageId = typeof body.imageId === "string" ? body.imageId.slice(0, 80) : "";
  if (!imageId) return Response.json({ error: "An image id is required." }, { status: 400 });
  const raw = body.feedback && typeof body.feedback === "object" ? body.feedback as Partial<ImageFeedback> : null;
  if (!raw || (raw.rating !== "like" && raw.rating !== "dislike")) {
    return Response.json({ error: "A valid like or dislike rating is required." }, { status: 400 });
  }
  const record = readImageMetadata(imageId);
  if (!record) return Response.json({ error: "Generated image metadata was not found." }, { status: 404 });

  const feedback: ImageFeedback = {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.slice(0, 80) : makeId(),
    rating: raw.rating,
    correction: typeof raw.correction === "string" ? raw.correction.trim().slice(0, 600) : "",
    kinds: Array.isArray(raw.kinds)
      ? raw.kinds.filter((kind): kind is ImageFeedback["kinds"][number] => kind === "preference" || kind === "visual-fact" || kind === "correction")
      : [],
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
  };
  writeImageMetadata({
    ...record,
    feedback: [...record.feedback.filter((item) => item.id !== feedback.id), feedback].slice(-20),
  });
  return Response.json({ ok: true, feedback });
}
