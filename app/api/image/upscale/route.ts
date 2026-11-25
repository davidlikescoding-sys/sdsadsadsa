import { publicErrorMessage } from "@/lib/api-error";
import { makeId } from "@/lib/storage";
import {
  UPSCALER_NAME, UPSCALER_SCALE,
  getImageEngineStatus,
  inspectGeneratedImage,
  readImageMetadata,
  upscaleLocalImage,
  writeImageMetadata,
} from "@/lib/image/generator";
import {
  acquireGenerationSlot, getActiveSignal, getGenerationQueueStatus,
} from "@/lib/image/generation-queue";
import type { GeneratedImage, ImageActivity } from "@/lib/image/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorJson(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** Enhances a locally generated PNG with the installed offline restorer. */
export async function POST(request: Request): Promise<Response> {
  let body: { id?: unknown; jobId?: unknown };
  try { body = await request.json(); } catch { return errorJson("A JSON body is required.", 400); }
  const id = typeof body.id === "string" ? body.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) : "";
  if (!id) return errorJson("Select an image to enhance.", 400);
  const jobId = typeof body.jobId === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(body.jobId) ? body.jobId : makeId();

  const source = readImageMetadata(id);
  if (!source || !source.imageUrl) return errorJson("The selected image was not found.", 404);
  if (source.upscaleSourceId) {
    return errorJson("This image is already a 4× restoration. Enhance the original render instead.", 409);
  }
  // Restoration is its own offline tool. It must not require the diffusion
  // engine or a diffusion model to be installed.
  const status = getImageEngineStatus();
  if (!status.upscalerReady) return errorJson(`The local ${UPSCALER_NAME} upscaler is not installed. Run npm run setup:image once.`, 503);

  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const localAbort = new AbortController();
  const onRequestAbort = () => localAbort.abort();
  request.signal.addEventListener("abort", onRequestAbort, { once: true });
  let releaseSlot: (() => void) | null = null;
  const emit = (input: Omit<ImageActivity, "id" | "at">) => {
    if (!controllerRef) return;
    const activity: ImageActivity = { ...input, id: makeId(), at: new Date().toISOString() };
    try { controllerRef.enqueue(encoder.encode(`${JSON.stringify({ type: "activity", activity })}\n`)); }
    catch { /* the client disconnected */ }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      void (async () => {
        try {
          emit({ stage: "queued", status: "running", message: "Waiting for the local render slot", detail: `Queue: ${getGenerationQueueStatus().waiting} waiting.` });
          releaseSlot = await acquireGenerationSlot({
            id: jobId,
            label: `4× restoration of ${id.slice(0, 8)}`,
            signal: localAbort.signal,
            duplicateKey: `upscale:${id}`,
          });
          const activeSignal = getActiveSignal();
          activeSignal?.addEventListener("abort", () => localAbort.abort(), { once: true });
          emit({ stage: "queued", status: "ok", message: "Local upscaler slot reserved", detail: `Queue: ${getGenerationQueueStatus().waiting} waiting.` });

          emit({ stage: "preparing", status: "running", message: `Loading ${UPSCALER_NAME} weights`, detail: "4× super-resolution runs entirely on this machine." });
          const result = await upscaleLocalImage({
            sourceId: id,
            signal: localAbort.signal,
            onProgress: (progress, detail) => emit({
              stage: "generating",
              status: "running",
              message: detail ?? "Enhancing image",
              detail: `${UPSCALER_NAME} · CPU`,
              progress,
            }),
            onHeartbeat: (detail) => emit({
              stage: "generating",
              status: "running",
              message: detail,
              detail: `${UPSCALER_NAME} · CPU`,
            }),
          });
          const inspection = inspectGeneratedImage(result.id);
          if (!inspection.valid) throw new Error("The enhanced file failed PNG validation.");
          emit({ stage: "evaluating", status: "ok", message: "Enhanced image validated", detail: `${inspection.width}×${inspection.height} PNG · ${(inspection.bytes / 1024).toFixed(0)} KB.` });

          const prior = source.render;
          const record: GeneratedImage = {
            ...source,
            id: result.id,
            model: `${source.model} + ${UPSCALER_NAME}`,
            imageUrl: result.imageUrl,
            createdAt: new Date().toISOString(),
            durationMs: source.durationMs + result.durationMs,
            // The restored image is a derivative, so it keeps the original
            // feedback and research provenance instead of resetting them.
            feedback: [...source.feedback],
            upscaleSourceId: id,
            settings: source.settings,
            researchSummary: { ...source.researchSummary },
            render: {
              // Older records have no recorded diffusion facts. Never invent
              // them from current settings or engine state.
              ...(prior?.diffusion ? { diffusion: prior.diffusion } : {}),
              final: {
                width: inspection.width ?? source.settings.width,
                height: inspection.height ?? source.settings.height,
                source: "local-restorer",
                upscaler: {
                  name: result.upscalerName,
                  file: result.upscalerFile,
                  scale: result.scale ?? UPSCALER_SCALE,
                  durationMs: result.durationMs,
                  sourceId: id,
                },
              },
            },
          };
          writeImageMetadata(record);
          emit({ stage: "done", status: "ok", message: "Enhancement complete", detail: `${inspection.width}×${inspection.height} · ${(result.durationMs / 1000).toFixed(1)}s`, progress: 100 });
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "complete", image: record })}\n`));
          controller.close();
          controllerRef = null;
        } catch (error) {
          const message = publicErrorMessage(error, "The local restorer failed. The original image was kept.");
          emit({ stage: "error", status: "error", message: "Enhancement failed", detail: message });
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message })}\n`));
            controller.close();
          } catch { /* already closed */ }
          controllerRef = null;
        } finally {
          releaseSlot?.();
          releaseSlot = null;
          request.signal.removeEventListener("abort", onRequestAbort);
        }
      })();
    },
    cancel() {
      controllerRef = null;
      localAbort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
