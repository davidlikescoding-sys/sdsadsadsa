import { createHash } from "node:crypto";
import { makeId } from "@/lib/storage";
import { acquireGenerationSlot, getActiveSignal, getGenerationQueueStatus } from "@/lib/image/generation-queue";
import { buildSmartDescription } from "@/lib/image/smart-prompt";
import { enhancePrompt } from "@/lib/image/prompt-enhancer";
import { resolveLocalModel } from "@/lib/image/generator";
import { parseGenerationSettings } from "@/lib/image/parse-settings";
import { normalizeVideoSettings } from "@/lib/image/video-settings";
import { detectAnatomy } from "@/lib/image/visual-anatomy";
import { identifySubjects, normalizeConcept, seedConcepts, upsertConcept } from "@/lib/image/visual-knowledge";
import { generateLocalVideo, getVideoEngineStatus } from "@/lib/video/generator";
import type {
  GeneratedVideo, ScopedCorrection, VideoActivity, VideoStage, VisualConcept,
} from "@/lib/image/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ActivityInput = Omit<VideoActivity, "id" | "at">;

interface RequestBody {
  prompt?: unknown;
  concepts?: unknown;
  recentCorrections?: unknown;
  jobId?: unknown;
  video?: unknown;
  settings?: { generation?: unknown };
}

function errorJson(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * The engine writes absolute paths and raw graph dumps into its errors. Keep
 * those local, but give the user the one piece that actually explains the
 * failure instead of a generic "video generation failed".
 */
function videoErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  console.error("[DavidAI]", raw);
  if (/RAM weight capacity exceeded|weight preparation|out of memory|bad_alloc/i.test(raw)) {
    return "The local renderer ran out of memory preparing keyframes. Close other heavy apps (for example Ollama), then retry with fewer keyframes or a smaller canvas.";
  }
  if (/number must be finite|unstable/i.test(raw)) {
    return "The local renderer hit unstable sampling numbers. Use at least 4 keyframe steps and retry.";
  }
  if (/cancelled/i.test(raw)) return "Video generation was cancelled.";
  if (/timed? ?out/i.test(raw)) return "Video generation timed out. Reduce frames, fps, or canvas size.";
  if (/identical generation is already running/i.test(raw)) {
    return "An identical generation is already running. Wait for it, or change a setting and retry.";
  }
  return "The local video generator failed. No video was saved from this run.";
}

function parseCorrections(value: unknown): ScopedCorrection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ScopedCorrection[] => {
    if (typeof item === "string") {
      const note = item.trim().slice(0, 240);
      return note ? [{ note, kind: "correction" }] : [];
    }
    if (!item || typeof item !== "object") return [];
    const raw = item as Partial<ScopedCorrection>;
    const note = typeof raw.note === "string" ? raw.note.trim().slice(0, 240) : "";
    if (!note) return [];
    return [{
      note,
      subject: typeof raw.subject === "string" ? raw.subject.trim().slice(0, 80) : undefined,
      kind: raw.kind === "preference" || raw.kind === "visual-fact" || raw.kind === "correction" ? raw.kind : "correction",
      count: Number.isFinite(raw.count) ? Math.max(1, Math.min(99, Math.floor(raw.count!))) : undefined,
    }];
  }).slice(-12);
}

/** Streams real local stages as newline-delimited JSON, like the image route. */
export async function POST(request: Request): Promise<Response> {
  let body: RequestBody;
  try { body = await request.json(); } catch { return errorJson("A JSON body is required.", 400); }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1200) : "";
  if (prompt.length < 3) return errorJson("Describe the video you want before generating.", 400);

  const videoStatus = getVideoEngineStatus();
  if (!videoStatus.ready) return errorJson(videoStatus.message, 503);

  const generation = parseGenerationSettings(body.settings?.generation, {
    maxWidth: videoStatus.limits.maxWidth,
    maxHeight: videoStatus.limits.maxHeight,
    maxSteps: 30,
    maxBatch: videoStatus.limits.maxKeyframes,
  });
  const video = normalizeVideoSettings(body.video);
  const baseConcepts = seedConcepts();
  const incoming = Array.isArray(body.concepts)
    ? body.concepts.flatMap((item) => {
      const normalized = normalizeConcept(item);
      return normalized ? [normalized] : [];
    }).slice(0, 400)
    : [];
  const concepts: VisualConcept[] = incoming.reduce((list, concept) => upsertConcept(list, concept), baseConcepts);
  const recentCorrections = parseCorrections(body.recentCorrections);
  const requestKey = createHash("sha1").update(JSON.stringify({ prompt, generation, video })).digest("hex");
  const jobId = typeof body.jobId === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(body.jobId) ? body.jobId : makeId();

  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const localAbort = new AbortController();
  const onRequestAbort = () => localAbort.abort();
  request.signal.addEventListener("abort", onRequestAbort, { once: true });
  const emit = (input: ActivityInput) => {
    if (!controllerRef) return;
    const activity: VideoActivity = { ...input, id: makeId(), at: new Date().toISOString() };
    try { controllerRef.enqueue(encoder.encode(`${JSON.stringify({ type: "activity", activity })}\n`)); }
    catch { /* the client disconnected */ }
  };
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  let releaseSlot: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      void (async () => {
        let currentStage: VideoStage = "queued";
        try {
          emit({ stage: "queued", status: "running", message: "Waiting for the local render slot", detail: `Queue: ${getGenerationQueueStatus().waiting} waiting.` });
          await flush();
          releaseSlot = await acquireGenerationSlot({ id: jobId, label: `video: ${prompt.slice(0, 70)}`, signal: localAbort.signal, duplicateKey: requestKey });
          const activeSignal = getActiveSignal();
          activeSignal?.addEventListener("abort", () => localAbort.abort(), { once: true });
          emit({ stage: "queued", status: "ok", message: "Local render slot reserved", detail: "Video shares the single local render slot with image generation." });

          currentStage = "understanding";
          const subjects = identifySubjects(prompt, concepts, 6);
          emit({ stage: "understanding", status: "ok", message: `${subjects.length} subject(s) identified`, detail: subjects.map((item) => item.name).join(", ") || "Full request guides the keyframes." });
          await flush();

          currentStage = "enhancing-prompt";
          const enhancement = enhancePrompt(prompt, generation);
          emit({ stage: "enhancing-prompt", status: "ok", message: `Prompt expanded with ${enhancement.additions.length} structured cue(s)` });

          currentStage = "description";
          const description = buildSmartDescription({
            prompt,
            subjects,
            concepts,
            feedbackNotes: concepts.flatMap((concept) => concept.feedbackNotes),
            settings: generation,
            recentCorrections,
            enhancement,
          });
          emit({ stage: "description", status: "ok", message: "Compact keyframe prompt built", detail: `${description.finalPrompt.length} characters sent to CLIP.` });

          currentStage = "model";
          const model = resolveLocalModel(generation.modelId, detectAnatomy(prompt, subjects).person);
          emit({ stage: "model", status: "ok", message: `Model selected: ${model.label}`, detail: "The same local checkpoint renders every keyframe." });

          currentStage = "preparing";
          emit({
            stage: "preparing",
            status: "ok",
            message: "Local animation plan ready",
            detail: `${video.keyframes} keyframes → ${Math.round(video.fps * video.seconds)} motion frames at ${video.fps} fps (${video.motion}, ${video.strength}% strength).`,
          });
          await flush();

          currentStage = "generating";
          const rendered = await generateLocalVideo({
            prompt: description.finalPrompt,
            negativePrompt: description.negativePrompt,
            generation,
            video,
            modelFile: model.file,
            signal: localAbort.signal,
            onProgress: (progress, detail) => emit({ stage: progress < 50 ? "generating" : progress < 82 ? "animating" : "encoding", status: "running", message: detail ?? "Building local video", detail: model.label, progress }),
            onHeartbeat: (detail) => emit({ stage: currentStage, status: "running", message: detail, detail: model.label }),
          });

          currentStage = "saving";
          emit({ stage: "saving", status: "ok", message: "Video metadata saved locally" });
          emit({
            stage: "done",
            status: "ok",
            message: "Local video complete",
            detail: `${rendered.frameCount} frames · ${(rendered.bytes / 1_000_000).toFixed(2)} MB · ${rendered.encoder}`,
            progress: 100,
          });
          controller.enqueue(encoder.encode(`${JSON.stringify({
            type: "complete",
            video: rendered satisfies GeneratedVideo,
            prompts: {
              original: prompt,
              enhanced: enhancement.text,
              final: description.finalPrompt,
              negative: description.negativePrompt,
              adjustments: description.adjustments,
            },
          })}\n`));
          controller.close();
          controllerRef = null;
        } catch (error) {
          const message = videoErrorMessage(error);
          emit({ stage: "error", status: "error", message: "Video generation failed", detail: message, progress: 0 });
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message, stage: currentStage })}\n`));
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
