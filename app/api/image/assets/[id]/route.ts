import { deleteImageAsset, getImageAsset, imageAssetPath } from "@/lib/image/image-assets";
import { readFileSync } from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const path = imageAssetPath(id);
  if (!path || !getImageAsset(id)) return Response.json({ error: "Asset not found." }, { status: 404 });
  return new Response(readFileSync(path), {
    headers: { "content-type": "image/png", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  return Response.json({ ok: deleteImageAsset(id) });
}
