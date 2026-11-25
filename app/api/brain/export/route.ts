import { exportBrainData } from "@/lib/brain/db";
import { exportTrainingDataset } from "@/lib/brain/documents";
import { getBrainDb } from "@/lib/brain/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    const kindParam = new URL(request.url).searchParams.get("kind") ?? "full";
    const kind = ["full", "knowledge", "conversations", "training"].includes(kindParam) ? kindParam : "full";
    if (kind === "training") {
      const text = exportTrainingDataset(getBrainDb());
      return new Response(text, {
        headers: {
          "content-type": "application/x-ndjson; charset=utf-8",
          "content-disposition": `attachment; filename="davidai-brain-training-${new Date().toISOString().slice(0, 10)}.jsonl"`,
        },
      });
    }
    const envelope = exportBrainData(getBrainDb(), kind as "full" | "knowledge" | "conversations");
    return Response.json(envelope, {
      headers: { "content-disposition": `attachment; filename="davidai-brain-${kind}-${new Date().toISOString().slice(0, 10)}.json"` },
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Export failed." }, { status: 500 });
  }
}
