import { persistResearchFinding } from "@/lib/brain/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.content !== "string" || body.content.trim().length < 24) {
      return Response.json({ ok: false, error: "Provide research content of at least 24 characters." }, { status: 400 });
    }
    const result = persistResearchFinding({
      title: typeof body.title === "string" ? body.title : undefined,
      content: body.content,
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : undefined,
      sourceTitle: typeof body.sourceTitle === "string" ? body.sourceTitle : undefined,
      sourceService: typeof body.sourceService === "string" ? body.sourceService.slice(0, 80) : undefined,
      retrievedAt: typeof body.retrievedAt === "string" ? body.retrievedAt : undefined,
      publishedAt: typeof body.publishedAt === "string" ? body.publishedAt : undefined,
      lastModified: typeof body.lastModified === "string" ? body.lastModified : undefined,
      etag: typeof body.etag === "string" ? body.etag.slice(0, 300) : undefined,
      keywords: Array.isArray(body.keywords) ? body.keywords.filter((value): value is string => typeof value === "string") : undefined,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not save research." }, { status: 500 });
  }
}
