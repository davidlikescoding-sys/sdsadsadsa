import { publicErrorMessage } from "@/lib/api-error";
import { getBrainDb, importBrainData } from "@/lib/brain/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { data?: unknown };
    if (body.data === undefined) return Response.json({ ok: false, error: "Provide a brain export envelope." }, { status: 400 });
    const stats = importBrainData(getBrainDb(), body.data);
    return Response.json({ ok: true, stats });
  } catch (error) {
    return Response.json({ ok: false, error: publicErrorMessage(error, "Import failed. Check the local brain status before retrying.") }, { status: 500 });
  }
}
