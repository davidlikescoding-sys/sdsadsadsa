import { listImageAssets, saveImageAsset } from "@/lib/image/image-assets";
import type { ImageAsset } from "@/lib/image/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind");
  const valid = kind === "reference" || kind === "edit" || kind === "mask" ? kind : undefined;
  return Response.json({ ok: true, assets: listImageAssets(valid) });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const kind = form.get("kind");
    if (!(file instanceof File)) return Response.json({ error: "Choose an image file first." }, { status: 400 });
    if (kind !== "reference" && kind !== "edit" && kind !== "mask") {
      return Response.json({ error: "Asset kind must be reference, edit or mask." }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const asset: ImageAsset = await saveImageAsset({ buffer, name: file.name, kind });
    return Response.json({ ok: true, asset });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
