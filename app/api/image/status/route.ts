import { getImageEngineStatus } from "@/lib/image/generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, status: getImageEngineStatus() });
}
