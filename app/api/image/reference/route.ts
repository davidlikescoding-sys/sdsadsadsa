import { fetchReferenceImage } from "@/lib/image/reference-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same-origin thumbnail proxy. Images are used only as research references. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url).searchParams.get("url") ?? "";
  if (!url) return Response.json({ error: "A reference URL is required." }, { status: 400 });
  try {
    const result = await fetchReferenceImage(url, request.signal);
    return new Response(result.bytes, {
      headers: {
        "content-type": result.contentType,
        "cache-control": "public, max-age=86400",
        "content-security-policy": "default-src 'none'; img-src data:; sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return Response.json({ error: error instanceof Error ? error.message : "Could not load the reference image." }, { status: 400 });
  }
}
