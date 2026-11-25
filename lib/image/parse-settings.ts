import type {
  ImageAspect,
  ImageEditMode,
  ImageGenerationSettings,
  ImageModelId,
  ImageOutpaintDirection,
  ImageQuality,
} from "./types";

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

function text(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

/** Server-side validation shared by the image and local-video routes. */
export function parseGenerationSettings(
  value: unknown,
  limits: { maxWidth: number; maxHeight: number; maxSteps: number; maxBatch: number },
): ImageGenerationSettings {
  const raw = value && typeof value === "object" ? value as Partial<ImageGenerationSettings> : {};
  const guidance = numeric(raw.guidance, 7);
  const strength = numeric(raw.strength, 0.55);
  const referenceIds = Array.isArray(raw.referenceIds)
    ? raw.referenceIds.filter((item): item is string => typeof item === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(item)).slice(0, 6)
    : [];
  return {
    width: clamp(raw.width, 256, limits.maxWidth, 384),
    height: clamp(raw.height, 256, limits.maxHeight, 384),
    steps: clamp(raw.steps, 1, limits.maxSteps, 20),
    guidance: Number.isFinite(guidance) ? Math.max(0, Math.min(20, guidance)) : 7,
    seed: typeof raw.seed === "number" && Number.isFinite(raw.seed) ? Math.max(0, Math.floor(raw.seed)) : null,
    negativePrompt: text(raw.negativePrompt, 800, "blurry, low quality, distorted, watermark, text, unnatural colors, color cast, oversaturated, discolored, extra limbs, deformed anatomy, malformed hands"),
    style: text(raw.style, 80, "photorealistic"),
    strength: Number.isFinite(strength) ? Math.max(0.05, Math.min(1, strength)) : 0.55,
    hires: raw.hires === true,
    speed: oneOf(raw.speed, ["quality", "balanced", "turbo"] as const, "balanced"),
    autoEnhance: raw.autoEnhance === true,
    quality: oneOf<ImageQuality>(raw.quality, ["draft", "standard", "high", "ultra"], "high"),
    aspect: oneOf<ImageAspect>(raw.aspect, ["square", "portrait", "landscape", "ultrawide", "custom"], "square"),
    lighting: text(raw.lighting, 80),
    camera: text(raw.camera, 80),
    perspective: text(raw.perspective, 80),
    composition: text(raw.composition, 80),
    colorPalette: text(raw.colorPalette, 80),
    depthOfField: text(raw.depthOfField, 80),
    detailLevel: text(raw.detailLevel, 80),
    atmosphere: text(raw.atmosphere, 80),
    weather: text(raw.weather, 80),
    timeOfDay: text(raw.timeOfDay, 80),
    texture: text(raw.texture, 80),
    realism: text(raw.realism, 80),
    batchCount: clamp(raw.batchCount, 1, limits.maxBatch, 1),
    modelId: oneOf<ImageModelId>(raw.modelId, ["auto", "sd15-f16", "sd15-q4", "realistic-v6", "dreamshaper-lcm"], "auto"),
    sampler: text(raw.sampler, 40, "auto"),
    scheduler: text(raw.scheduler, 40, "auto"),
    editMode: oneOf<ImageEditMode>(raw.editMode, ["text", "img2img", "mask", "outpaint", "remove", "background"], "text"),
    initImageId: text(raw.initImageId, 80) || undefined,
    maskImageId: text(raw.maskImageId, 80) || undefined,
    referenceIds,
    outpaintDirection: oneOf<ImageOutpaintDirection>(raw.outpaintDirection, ["left", "right", "top", "bottom", "all"], "all"),
  };
}
