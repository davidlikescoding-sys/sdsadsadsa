import { createHash } from "node:crypto";
import { publicErrorMessage } from "@/lib/api-error";
import { makeId } from "@/lib/storage";
import {
  UPSCALER_NAME,
  UPSCALER_SCALE,
  generateLocalImages,
  getImageEngineStatus,
  inspectGeneratedImage,
  resolveLocalModel,
  upscaleLocalImage,
  writeImageMetadata,
} from "@/lib/image/generator";
import { buildSmartDescription } from "@/lib/image/smart-prompt";
import { enhancePrompt, filterReferenceCues, parsePromptIntent, type EnhancedPrompt } from "@/lib/image/prompt-enhancer";
import { referenceCues } from "@/lib/image/image-assets";
import { detectAnatomy } from "@/lib/image/visual-anatomy";
import { prepareEditInput, removePreparedInput, type PreparedInput } from "@/lib/image/image-inputs";
import {
  acquireGenerationSlot, getActiveSignal, getGenerationQueueStatus,
} from "@/lib/image/generation-queue";
import type {
  GeneratedImage,
  ImageActivity,
  ImageEditMode,
  ScopedCorrection,
  VisualConcept,
  VisualFeedbackNote,
} from "@/lib/image/types";
import { identifySubjects, normalizeConcept, seedConcepts, upsertConcept } from "@/lib/image/visual-knowledge";
import { parseGenerationSettings } from "@/lib/image/parse-settings";
import { runVisualResearch } from "@/lib/image/visual-research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ActivityInput = Omit<ImageActivity, "id" | "at">;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function errorJson(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function mergeEnhancement(
  base: EnhancedPrompt | null,
  appliedCues: string[],
  rejectedCues: string[] = [],
): EnhancedPrompt | null {
  if (!appliedCues.length && !rejectedCues.length) return base;
  const additions = [...new Set([...(base?.additions ?? []), ...appliedCues])].slice(0, 12);
  const intent = base?.intent ?? parsePromptIntent(appliedCues.join(", "));
  const request = base?.intent.request ?? "";
  return {
    text: [request, ...additions].filter(Boolean).join(", ").slice(0, 900),
    intent,
    additions,
    negativeSuggestions: base?.negativeSuggestions ?? [],
    cueProvenance: {
      applied: appliedCues,
      rejected: rejectedCues,
    },
  };
}

/** Streams real stages and denoising progress as newline-delimited JSON. */
export async function POST(request: Request): Promise<Response> {
  let body: {
    prompt?: unknown; concepts?: unknown; recentCorrections?: unknown; jobId?: unknown;
    settings?: {
      researchEnabled?: unknown; forceResearch?: unknown; maxReferences?: unknown; enhancePrompt?: unknown;
      generation?: unknown;
    };
  };
  try { body = await request.json(); } catch { return errorJson("A JSON body is required.", 400); }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1200) : "";
  if (prompt.length < 3) return errorJson("Describe the image you want before generating.", 400);

  const status = getImageEngineStatus();
  if (!status.ready) return errorJson(status.message, 503);

  const baseConcepts = seedConcepts();
  const incoming = Array.isArray(body.concepts)
    ? body.concepts.flatMap((item) => {
      const normalized = normalizeConcept(item);
      return normalized ? [normalized] : [];
    }).slice(0, 400)
    : [];
  const concepts = incoming.reduce((list, concept) => upsertConcept(list, concept), baseConcepts);
  const generation = parseGenerationSettings(body.settings?.generation, status.limits);
  const researchEnabled = body.settings?.researchEnabled !== false;
  const forceResearch = body.settings?.forceResearch === true;
  const useEnhancement = body.settings?.enhancePrompt !== false;
  const maxReferences = clamp(body.settings?.maxReferences, 1, 10, 6);
  const recentCorrections: ScopedCorrection[] = Array.isArray(body.recentCorrections)
    ? body.recentCorrections.flatMap((item): ScopedCorrection[] => {
      if (typeof item === "string") {
        const note = item.trim().slice(0, 240);
        return note ? [{ note, kind: "correction" }] : [];
      }
      if (!item || typeof item !== "object") return [];
      const raw = item as Partial<ScopedCorrection>;
      const note = typeof raw.note === "string" ? raw.note.trim().slice(0, 240) : "";
      if (!note) return [];
      const subjects = Array.isArray(raw.subjects)
        ? raw.subjects.filter((name): name is string => typeof name === "string" && Boolean(name.trim())).map((name) => name.trim().slice(0, 80)).slice(0, 6)
        : undefined;
      return [{
        note,
        subject: typeof raw.subject === "string" ? raw.subject.trim().slice(0, 80) : undefined,
        subjects: subjects?.length ? subjects : undefined,
        kind: raw.kind === "preference" || raw.kind === "visual-fact" || raw.kind === "correction" ? raw.kind : "correction",
        count: Number.isFinite(raw.count) ? Math.max(1, Math.min(99, Math.floor(raw.count!))) : undefined,
      }];
    }).slice(-12)
    : [];
  // Duplicate suppression is derived server-side; a client cannot declare a
  // different key for an identical render or reuse one for unrelated work.
  const requestKey = createHash("sha1").update(JSON.stringify({
    prompt, generation, concepts, recentCorrections, researchEnabled, forceResearch,
  })).digest("hex");
  const jobId = typeof body.jobId === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(body.jobId)
    ? body.jobId
    : makeId();

  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const localAbort = new AbortController();
  const onRequestAbort = () => localAbort.abort();
  request.signal.addEventListener("abort", onRequestAbort, { once: true });
  const emit = (input: ActivityInput) => {
    if (!controllerRef) return;
    const activity: ImageActivity = { ...input, id: makeId(), at: new Date().toISOString() };
    try { controllerRef.enqueue(encoder.encode(`${JSON.stringify({ type: "activity", activity })}\n`)); }
    catch { /* the client disconnected */ }
  };
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  let releaseSlot: (() => void) | null = null;
  let prepared: PreparedInput | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      void (async () => {
        let currentStage: ImageActivity["stage"] = "queued";
        try {
          emit({ stage: "queued", status: "running", message: "Waiting for the local render slot", detail: `Queue: ${getGenerationQueueStatus().waiting} waiting.` });
          await flush();
          releaseSlot = await acquireGenerationSlot({
            id: jobId,
            label: prompt.slice(0, 80),
            signal: localAbort.signal,
            duplicateKey: requestKey,
          });
          const activeSignal = getActiveSignal();
          activeSignal?.addEventListener("abort", () => localAbort.abort(), { once: true });
          emit({ stage: "queued", status: "ok", message: "Local engine slot reserved", detail: "Only one CPU render runs at a time; duplicate requests are rejected." });

          currentStage = "understanding";
          emit({ stage: "understanding", status: "running", message: "Understanding the visual request", detail: `${prompt.length} characters received.` });
          await flush();
          emit({ stage: "understanding", status: "ok", message: "Visual request understood" });

          currentStage = "identifying";
          emit({ stage: "identifying", status: "running", message: "Identifying subjects and scene elements" });
          const subjects = identifySubjects(prompt, concepts, 6);
          await flush();
          emit({
            stage: "identifying",
            status: "ok",
            message: `${subjects.length} subject${subjects.length === 1 ? "" : "s"} identified`,
            detail: subjects.length ? subjects.map((subject) => subject.name).join(", ") : "No named subjects; the full request will guide generation.",
          });

          currentStage = "enhancing-prompt";
          const rawReferenceCues = referenceCues(generation.referenceIds);
          const cueRequest = [
            prompt, generation.lighting, generation.camera, generation.composition,
            generation.colorPalette, generation.atmosphere, generation.weather, generation.timeOfDay,
          ].filter(Boolean).join(", ");
          const appliedCues = filterReferenceCues(rawReferenceCues, cueRequest);
          const rejectedCues = rawReferenceCues.filter((cue) => !appliedCues.includes(cue));
          const enhancement = useEnhancement
            ? mergeEnhancement(enhancePrompt(prompt, generation), appliedCues, rejectedCues)
            : null;
          if (rawReferenceCues.length) {
            emit({
              stage: "enhancing-prompt",
              status: rejectedCues.length ? "running" : "ok",
              message: `${appliedCues.length} reference-palette cue(s) applied, ${rejectedCues.length} withheld`,
              detail: [
                appliedCues.length ? `Applied uploaded-reference cues: ${appliedCues.join(" · ")}` : "",
                rejectedCues.length ? `Withheld because they conflict with your explicit request: ${rejectedCues.join(" · ")}` : "",
              ].filter(Boolean).join(" | "),
            });
          }
          emit({
            stage: "enhancing-prompt",
            status: "ok",
            message: enhancement ? `Prompt expanded with ${enhancement.additions.length} structured cue(s)` : "Original prompt used unchanged",
            detail: enhancement?.additions.slice(0, 6).join(" · ") ?? "Prompt enhancement is turned off.",
          });

          currentStage = "knowledge";
          emit({ stage: "knowledge", status: "running", message: "Checking visual knowledge", detail: `${concepts.length} structured concept record(s) available.` });
          await flush();

          let research = null;
          if (researchEnabled) {
            research = await runVisualResearch({
              prompt,
              subjects,
              concepts,
              force: forceResearch,
              maxReferences,
              signal: localAbort.signal,
              onActivity: emit,
            });
            if (research.concepts.length !== concepts.length) {
              concepts.splice(0, concepts.length, ...research.concepts);
            } else {
              for (const concept of research.concepts) {
                const index = concepts.findIndex((item) => item.id === concept.id);
                if (index >= 0) concepts[index] = concept;
              }
            }
            const lookupAttempted = research.searches.length > 0;
            const noReferences = research.references.length === 0;
            emit({
              stage: "knowledge",
              status: research.skipped && lookupAttempted ? "error" : "ok",
              message: research.skipped && lookupAttempted
                ? "Reference lookup did not return usable images"
                : research.skipped
                  ? "Existing visual knowledge used"
                  : noReferences
                    ? "No suitable references matched"
                    : "Visual knowledge updated from references",
              detail: research.skipped && lookupAttempted
                ? `${research.reason ?? "The reference search failed."} Generation continues from local visual knowledge only; no web pixels are used.`
                : research.skipped
                  ? research.reason ?? "No new reference evidence was needed."
                  : noReferences
                    ? `${research.reason ?? "No usable references matched."} Generation continues from local visual knowledge only.`
                    : `${research.references.length} citation(s), ${research.characteristics.length} appearance characteristic(s).`,
            });
          } else {
            emit({ stage: "researching", status: "ok", message: "Reference research disabled", detail: "Generation will use only local visual knowledge." });
            emit({ stage: "knowledge", status: "ok", message: "Local visual knowledge loaded", detail: `${concepts.length} concept record(s).` });
          }

          currentStage = "description";
          emit({ stage: "description", status: "running", message: "Building compact visual description" });
          const feedbackNotes: VisualFeedbackNote[] = concepts.flatMap((concept) => concept.feedbackNotes);
          const description = buildSmartDescription({
            prompt,
            subjects,
            concepts,
            feedbackNotes,
            settings: generation,
            recentCorrections,
            enhancement,
          });
          await flush();
          emit({
            stage: "description",
            status: "ok",
            message: "Compact generation prompt built",
            detail: `${description.usedConcepts.length} subject(s), ${description.adjustments.length} adjustment(s), ${description.finalPrompt.length} characters sent to CLIP.`,
          });

          currentStage = "composing";
          emit({
            stage: "composing",
            status: "ok",
            message: "Visual controls composed",
            detail: [
              generation.lighting && `lighting: ${generation.lighting}`,
              generation.camera && `camera: ${generation.camera}`,
              generation.composition && `composition: ${generation.composition}`,
              generation.depthOfField && `depth: ${generation.depthOfField}`,
              generation.batchCount && generation.batchCount > 1 ? `images: ${generation.batchCount}` : "",
            ].filter(Boolean).join(" · ") || "No extra visual controls selected.",
          });

          const anatomy = detectAnatomy(prompt, subjects);
          // Animals tested much better on full-precision SD 1.5; only people
          // use the Realistic Vision portrait fine-tune in Auto mode.
          const needsPeopleModel = anatomy.person;
          const model = resolveLocalModel(generation.modelId, needsPeopleModel);
          currentStage = "model";
          emit({
            stage: "model",
            status: "ok",
            message: `Model selected: ${model.label}`,
            detail: `Backend: local CPU (${status.hardware.cpuCount} threads). ${generation.modelId === "auto" ? "Subject-aware routing." : "Manual local checkpoint override."}`,
          });

          const editMode: ImageEditMode = generation.editMode ?? "text";
          if (editMode !== "text") {
            currentStage = "preparing";
            emit({ stage: "preparing", status: "running", message: "Preparing local image-guided input", detail: `Mode: ${editMode}` });
            prepared = await prepareEditInput({
              mode: editMode,
              settings: generation,
              sourceId: generation.initImageId,
              maskId: generation.maskImageId,
              direction: generation.outpaintDirection,
            });
            emit({ stage: "preparing", status: "ok", message: "Edit input ready", detail: prepared?.note ?? "" });
          }

          currentStage = "preparing";
          emit({
            stage: "preparing",
            status: "running",
            message: "Preparing the local diffusion engine",
            detail: `${generation.width}×${generation.height} · ${generation.steps} steps · CFG ${generation.guidance} · ${model.label}${generation.hires ? " · 2× detail pass" : ""}`,
          });
          await flush();
          emit({ stage: "preparing", status: "ok", message: "Local model loaded from disk" });

          currentStage = "generating";
          emit({ stage: "generating", status: "running", message: "Starting local image generation", detail: "No reference image is copied into the result.", progress: 0 });
          const generated = await generateLocalImages({
            prompt: description.finalPrompt,
            negativePrompt: description.negativePrompt,
            settings: generation,
            anatomy,
            modelFile: model.file,
            initImagePath: prepared?.initImagePath,
            maskImagePath: prepared?.maskImagePath,
            signal: localAbort.signal,
            onProgress: (progress, detail) => emit({ stage: "generating", status: "running", message: detail ?? "Generating image", detail: model.label, progress }),
            onHeartbeat: (detail) => emit({ stage: "generating", status: "running", message: detail, detail: model.label }),
          });

          currentStage = "validating";
          emit({ stage: "validating", status: "running", message: "Validating generated PNG files" });
          const inspections = new Map<string, ReturnType<typeof inspectGeneratedImage>>();
          for (const result of generated.results) {
            const inspection = inspectGeneratedImage(result.id);
            if (!inspection.valid) throw new Error("A generated file failed PNG validation.");
            inspections.set(result.id, inspection);
            emit({
              stage: "validating",
              status: "ok",
              message: `Image ${result.id.slice(0, 8)} validated`,
              detail: `${inspection.width}×${inspection.height} PNG · ${(inspection.bytes / 1024).toFixed(0)} KB · newly generated pixels.`,
            });
          }

          const researchSummary = {
            skipped: research?.skipped ?? true,
            reason: research?.reason,
            subjects: subjects.map((subject) => subject.name),
            references: research?.references.length ?? 0,
            characteristics: research?.characteristics ?? [],
            queries: research?.searches ?? [],
          };
          const finalImages: GeneratedImage[] = [];
          for (const [index, result] of generated.results.entries()) {
            const createdAt = new Date().toISOString();
            const baseInspection = inspections.get(result.id)!;
            const diffusion = {
              width: result.diffusionWidth,
              height: result.diffusionHeight,
              steps: result.steps,
              cfg: result.cfg,
              seed: result.actualSeed,
              sampler: result.sampler,
              scheduler: result.scheduler,
              cacheMode: result.cacheMode,
              threads: result.threads,
              vaeTiling: result.vaeTiling,
              hires: result.hires,
              hiresSteps: result.hiresSteps,
              modelFile: result.modelFile,
              engine: result.engine,
            };
            const pipelineNotes: string[] = [
              "Compact subject-first prompt compiler used; long dataset/anatomy lists were withheld to keep the subject recognizable.",
            ];
            if (enhancement?.cueProvenance?.applied.length) {
              pipelineNotes.push(`${enhancement.cueProvenance.applied.length} uploaded-reference palette cue(s) applied as inspiration, never copied pixels`);
            }
            if (enhancement?.cueProvenance?.rejected.length) {
              pipelineNotes.push(`${enhancement.cueProvenance.rejected.length} reference cue(s) withheld because they contradict your explicit request`);
            }
            const baseRecord: GeneratedImage = {
              id: result.id,
              originalPrompt: prompt,
              finalPrompt: description.finalPrompt,
              enhancedPrompt: enhancement?.text,
              negativePrompt: description.negativePrompt,
              model: result.model,
              settings: generation,
              status: "complete",
              imageUrl: result.imageUrl,
              createdAt,
              durationMs: Math.round(result.durationMs / generated.results.length),
              researchSummary,
              feedback: [],
              render: {
                diffusion,
                final: {
                  width: baseInspection.width ?? result.diffusionWidth,
                  height: baseInspection.height ?? result.diffusionHeight,
                  source: "diffusion",
                },
              },
              pipelineNotes,
              edit: editMode === "text" ? undefined : {
                mode: editMode,
                sourceId: generation.initImageId,
                maskId: generation.maskImageId,
                strength: generation.strength,
                note: prepared?.note ?? "",
              },
              batchIndex: generated.results.length > 1 ? index + 1 : undefined,
              batchTotal: generated.results.length > 1 ? generated.results.length : undefined,
            };
            // The base PNG is a complete, valid render. Write it before any
            // optional restoration so a failed enhancement cannot lose the art.
            writeImageMetadata(baseRecord);

            let upscale: Awaited<ReturnType<typeof upscaleLocalImage>> | undefined;
            let upscaleInspection: ReturnType<typeof inspectGeneratedImage> | undefined;
            // Auto restore is explicit: when the user enables it, apply it to
            // the chosen canvas instead of silently ignoring 384/512 renders.
            if (generation.autoEnhance && status.upscalerReady) {
              currentStage = "enhancing";
              emit({ stage: "enhancing", status: "running", message: `Restoring 4× detail (${index + 1}/${generated.results.length})`, detail: `${result.diffusionWidth}×${result.diffusionHeight} → ${result.diffusionWidth * UPSCALER_SCALE}×${result.diffusionHeight * UPSCALER_SCALE}. No diffusion model is reloaded; the saved PNG is enhanced directly with ${UPSCALER_NAME}.`, progress: 0 });
              try {
                upscale = await upscaleLocalImage({
                  sourceId: result.id,
                  signal: localAbort.signal,
                  onProgress: (value, detail) => emit({ stage: "enhancing", status: "running", message: detail ?? "Enhancing image", detail: `${UPSCALER_NAME} · CPU`, progress: Math.round(value * 0.8) }),
                  onHeartbeat: (detail) => emit({ stage: "enhancing", status: "running", message: detail, detail: `${UPSCALER_NAME} · CPU` }),
                });
                upscaleInspection = inspectGeneratedImage(upscale.id);
                if (!upscaleInspection.valid) throw new Error("The enhanced file failed PNG validation.");
                emit({ stage: "enhancing", status: "ok", message: `Enhanced to ${upscaleInspection.width}×${upscaleInspection.height}`, detail: `${UPSCALER_NAME} result saved with separate diffusion/final provenance.`, progress: 100 });
              } catch (error) {
                if (localAbort.signal.aborted) throw error;
                const message = error instanceof Error ? error.message : String(error);
                upscale = undefined;
                upscaleInspection = undefined;
                const note = `Enhancement failed; the valid base render was kept: ${message}`;
                pipelineNotes.push(note);
                emit({ stage: "enhancing", status: "error", message: "Enhancement failed; base render kept", detail: message });
              }
            } else if (generation.autoEnhance) {
              emit({ stage: "enhancing", status: "error", message: "4× enhancement skipped", detail: `The local ${UPSCALER_NAME} upscaler is not installed; the original render was kept.` });
            }

            const record: GeneratedImage = {
              ...baseRecord,
              id: upscale?.id ?? result.id,
              model: upscale ? `${result.model} + ${UPSCALER_NAME}` : result.model,
              imageUrl: upscale?.imageUrl ?? result.imageUrl,
              durationMs: baseRecord.durationMs + (upscale?.durationMs ?? 0),
              upscaleSourceId: upscale?.sourceId,
              pipelineNotes: [...pipelineNotes],
              render: upscale && upscaleInspection ? {
                diffusion,
                final: {
                  width: upscaleInspection.width ?? baseInspection.width ?? result.diffusionWidth,
                  height: upscaleInspection.height ?? baseInspection.height ?? result.diffusionHeight,
                  source: "local-restorer",
                  upscaler: {
                    name: upscale.upscalerName,
                    file: upscale.upscalerFile,
                    scale: upscale.scale,
                    durationMs: upscale.durationMs,
                    sourceId: upscale.sourceId,
                  },
                },
              } : baseRecord.render,
            };
            writeImageMetadata(record);
            finalImages.push(record);
          }

          currentStage = "saving";
          emit({ stage: "saving", status: "running", message: "Saving image metadata" });
          await flush();
          emit({ stage: "saving", status: "ok", message: "Images saved to local storage" });
          emit({
            stage: "done",
            status: "ok",
            message: "Generation complete",
            detail: `Completed ${finalImages.length} image(s) in ${(finalImages.reduce((sum, image) => sum + image.durationMs, 0) / 1000).toFixed(1)}s.`,
            progress: 100,
          });
          controller.enqueue(encoder.encode(`${JSON.stringify({
            type: "complete", image: finalImages[0], images: finalImages, concepts, research,
            prompts: {
              original: prompt,
              enhanced: enhancement?.text ?? prompt,
              final: description.finalPrompt,
              negative: description.negativePrompt,
              adjustments: description.adjustments,
            },
          })}\n`));
          controller.close();
          controllerRef = null;
        } catch (error) {
          const message = publicErrorMessage(error, "The local generator failed. No image was saved from this run.");
          emit({ stage: "error", status: "error", message: "Generation failed", detail: message, progress: 0 });
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message, stage: currentStage })}\n`));
            controller.close();
          } catch { /* already closed */ }
          controllerRef = null;
        } finally {
          removePreparedInput(prepared);
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
