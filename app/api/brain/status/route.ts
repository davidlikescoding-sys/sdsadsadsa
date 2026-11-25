import { publicErrorMessage } from "@/lib/api-error";
import { getBrainStatus } from "@/lib/brain/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    return Response.json({ ok: true, status: getBrainStatus(fresh) });
  } catch (error) {
    return Response.json({ ok: false, error: publicErrorMessage(error, "Brain status failed.") }, { status: 500 });
  }
}
