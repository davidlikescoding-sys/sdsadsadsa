import { deleteGeneratedVideo, posterFilePath, readVideoMetadata, videoFilePath } from "@/lib/video/generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  const poster = new URL(request.url).searchParams.get("poster") === "1";
  const path = poster ? posterFilePath(id) : videoFilePath(id);
  if (!path) return Response.json({ error: poster ? "Video poster not found." : "Generated video not found." }, { status: 404 });
  const bytes = await import("node:fs/promises").then((fs) => fs.readFile(path));
  const download = new URL(request.url).searchParams.get("download") === "1";
  const metadata = readVideoMetadata(id);
  const contentType = poster ? "image/png" : "video/webm";
  const extension = poster ? "png" : "webm";
  const name = `davidai-${id}.${extension}`;
  return new Response(bytes, {
    headers: {
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
      "cache-control": "private, max-age=3600",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "x-content-type-options": "nosniff",
      "accept-ranges": "bytes",
      ...(metadata?.originalPrompt ? { "x-video-prompt": Buffer.from(metadata.originalPrompt.slice(0, 300)).toString("base64") } : {}),
    },
  });
}

export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  const removed = deleteGeneratedVideo(id);
  return Response.json({ ok: removed });
}
