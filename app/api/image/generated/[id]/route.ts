import { deleteGeneratedImage, imageFilePath, readImageMetadata } from "@/lib/image/generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  const path = imageFilePath(id);
  if (!path) return Response.json({ error: "Generated image not found." }, { status: 404 });
  const bytes = await import("node:fs/promises").then((fs) => fs.readFile(path));
  const download = new URL(request.url).searchParams.get("download") === "1";
  const metadata = readImageMetadata(id);
  const name = `davidai-${id}.png`;
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "content-length": String(bytes.byteLength),
      "cache-control": "private, max-age=3600",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "x-content-type-options": "nosniff",
      ...(metadata?.originalPrompt ? { "x-image-prompt": Buffer.from(metadata.originalPrompt.slice(0, 300)).toString("base64") } : {}),
    },
  });
}

export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  const removed = deleteGeneratedImage(id);
  return Response.json({ ok: removed });
}
