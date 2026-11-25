import { DEFAULT_IMAGE_GENERATION } from "./defaults";
import { DEFAULT_VIDEO_SETTINGS, type GeneratedVideo, type VideoGenerationSettings, type VideoMotion } from "./types";

const MOTIONS: readonly VideoMotion[] = ["pan-right", "pan-left", "zoom-in", "zoom-out", "drift", "none"];

function numeric(value: unknown, fallback: number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = numeric(value, fallback);
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

/** Shared by the browser store and both video API routes. */
export function normalizeVideoSettings(value: unknown): VideoGenerationSettings {
  const raw = value && typeof value === "object" ? value as Partial<VideoGenerationSettings> : {};
  return {
    keyframes: clamp(raw.keyframes, 2, 4, DEFAULT_VIDEO_SETTINGS.keyframes),
    fps: clamp(raw.fps, 4, 12, DEFAULT_VIDEO_SETTINGS.fps),
    seconds: clamp(raw.seconds, 1, 6, DEFAULT_VIDEO_SETTINGS.seconds),
    motion: typeof raw.motion === "string" && MOTIONS.includes(raw.motion as VideoMotion)
      ? raw.motion as VideoMotion
      : DEFAULT_VIDEO_SETTINGS.motion,
    strength: clamp(raw.strength, 0, 100, DEFAULT_VIDEO_SETTINGS.strength),
  };
}

/** Output frames are derived, not trusted from the client. */
export function videoFrameCount(settings: VideoGenerationSettings): number {
  return clamp(Math.round(settings.fps * settings.seconds), 8, 96, 24);
}

export function normalizeVideo(value: unknown): GeneratedVideo | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<GeneratedVideo>;
  if (typeof raw.id !== "string" || typeof raw.videoUrl !== "string" || !raw.videoUrl.startsWith("/api/video/generated/")) return null;
  const id = raw.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  if (!id) return null;
  return {
    id,
    originalPrompt: typeof raw.originalPrompt === "string" ? raw.originalPrompt.slice(0, 2000) : "",
    finalPrompt: typeof raw.finalPrompt === "string" ? raw.finalPrompt.slice(0, 4000) : "",
    negativePrompt: typeof raw.negativePrompt === "string" ? raw.negativePrompt.slice(0, 800) : "",
    videoUrl: raw.videoUrl,
    posterUrl: typeof raw.posterUrl === "string" && raw.posterUrl.startsWith("/api/video/generated/")
      ? raw.posterUrl
      : `/api/video/generated/${id}?poster=1`,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    durationMs: Number.isFinite(Number(raw.durationMs)) ? Math.max(0, Number(raw.durationMs)) : 0,
    status: raw.status === "failed" ? "failed" : "complete",
    settings: normalizeVideoSettings(raw.settings),
    generation: raw.generation && typeof raw.generation === "object"
      ? raw.generation as GeneratedVideo["generation"]
      : { ...DEFAULT_IMAGE_GENERATION },
    model: typeof raw.model === "string" ? raw.model.slice(0, 160) : "unknown",
    sourceKeyframeIds: Array.isArray(raw.sourceKeyframeIds)
      ? raw.sourceKeyframeIds.filter((item): item is string => typeof item === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(item)).slice(0, 6)
      : [],
    frameCount: clamp(raw.frameCount, 1, 96, 24),
    keyframeCount: clamp(raw.keyframeCount, 1, 4, 3),
    fps: clamp(raw.fps, 1, 30, 8),
    width: clamp(raw.width, 64, 768, 256),
    height: clamp(raw.height, 64, 768, 256),
    bytes: Number.isFinite(Number(raw.bytes)) ? Math.max(0, Number(raw.bytes)) : 0,
    encoder: typeof raw.encoder === "string" ? raw.encoder.slice(0, 160) : "stable-diffusion.cpp DGL",
    pipelineNotes: Array.isArray(raw.pipelineNotes)
      ? raw.pipelineNotes.filter((item): item is string => typeof item === "string").slice(0, 20)
      : [],
    error: typeof raw.error === "string" ? raw.error.slice(0, 600) : undefined,
  };
}
