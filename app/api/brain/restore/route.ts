import { publicErrorMessage } from "@/lib/api-error";
import { restoreBrainBackup } from "@/lib/brain/db";
import { getBrainStatus } from "@/lib/brain/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { path?: unknown };
    if (typeof body.path !== "string" || !body.path.trim()) {
      return Response.json({ ok: false, error: "Select a local backup to restore." }, { status: 400 });
    }
    restoreBrainBackup(body.path.trim());
    return Response.json({ ok: true, status: getBrainStatus(true) });
  } catch (error) {
    return Response.json({ ok: false, error: publicErrorMessage(error, "Restore failed. Check the local brain status before retrying.") }, { status: 500 });
  }
}
