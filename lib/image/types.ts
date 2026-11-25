/**
 * Shared types for DavidAI's image laboratory.
 *
 * Visual knowledge is deliberately separate from ordinary text knowledge:
 * an image model needs structured appearance facts, not prose answers.
 */

/** Exact identity of the offline restorer installed on this machine. */
export const LOCAL_UPSCALER_NAME = "NMKD Superscale-SP 4× GGUF";
export const LOCAL_UPSCALER_SCALE = 4;

/**
 * Honest local-video defaults. This machine has no video diffusion weights, so
 * video output is a real WebM built from locally generated AI keyframes plus
 * deterministic pan/zoom interpolation. It is not text-to-video.
 */
export const DEFAULT_VIDEO_SETTINGS: VideoGenerationSettings = {
  keyframes: 3,
  fps: 8,
  seconds: 3,
  motion: "drift",
  strength: 45,
};

export type VisualCategory =
  | "person"
  | "animal"
  | "object"
  | "environment"
  | "style"
  | "material"
  | "lighting"
  | "color"
  | "composition"
  | "camera"
  | "clothing"
  | "vehicle"
  | "architecture"
  | "plant"
  | "furniture"
  | "concept";

export type VisualSourceLicense =
  | "Public domain"
  | "CC0"
  | "CC BY"
  | "CC BY-SA"
  | "CC BY-NC"
  | "Other free license"
  | "Unknown";

export interface VisualSource {
  url: string;
  pageUrl: string;
  title: string;
  license: VisualSourceLicense;
  retrievedAt: string;
}

export interface VisualFeedbackNote {
  id: string;
  kind: "preference" | "visual-fact" | "correction";
  note: string;
  subject?: string;
  imageId?: string;
  createdAt: string;
}

/** A correction that remembers which subject and feedback kind produced it. */
export interface ScopedCorrection {
  note: string;
  subject?: string;
  subjects?: string[];
  kind?: VisualFeedbackNote["kind"];
  count?: number;
}

export interface VisualConcept {
  id: string;
  name: string;
  /** Alternate words that identify this concept in a request. */
  aliases?: string[];
  category: VisualCategory;
  /** Short, model-ready appearance phrases, e.g. "golden coat", "floppy ears". */
  attributes: string[];
  /** Structural rules the model must respect, e.g. "two symmetrical wings". */
  constraints?: string[];
  /** Structural failures to exclude, e.g. "asymmetric wings", "engine on top". */
  negativeConstraints?: string[];
  confidence: number;
  sources: VisualSource[];
  feedbackNotes: VisualFeedbackNote[];
  lastResearchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ColorSample {
  name: string;
  hex: string;
  share: number;
}

export interface ReferenceImage {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  pageUrl: string;
  source: string;
  license: VisualSourceLicense;
  width?: number;
  height?: number;
  /** Low-resolution pixel analysis performed locally in the browser. */
  colors: ColorSample[];
  brightness: number;
  characteristics: string[];
}

export interface VisualSubject {
  name: string;
  category: VisualCategory;
  confidence: number;
  basis: string[];
}

export interface VisualResearchResult {
  query: string;
  subjects: VisualSubject[];
  searches: string[];
  references: ReferenceImage[];
  characteristics: string[];
  concepts: VisualConcept[];
  skipped: boolean;
  reason?: string;
  completedAt: string;
}

export type ImageQuality = "draft" | "standard" | "high" | "ultra";
export type ImageAspect = "square" | "portrait" | "landscape" | "ultrawide" | "custom";
export type ImageModelId = "auto" | "sd15-f16" | "sd15-q4" | "realistic-v6" | "dreamshaper-lcm";
export type ImageEditMode = "text" | "img2img" | "mask" | "outpaint" | "remove" | "background";
export type ImageOutpaintDirection = "left" | "right" | "top" | "bottom" | "all";

export interface ImageGenerationSettings {
  width: number;
  height: number;
  steps: number;
  guidance: number;
  seed: number | null;
  negativePrompt: string;
  style: string;
  strength: number;
  /** Second, lower-noise diffusion pass at 2x resolution. Optional for old records. */
  hires?: boolean;
  /**
   * Cache strategy. "balanced" (tuned UCache) is the colour-stable default;
   * "turbo" (spectrum) is fastest but can artefact at low steps; "quality"
   * omits cache flags and is the slowest.
   */
  speed?: "quality" | "balanced" | "turbo";
  /** Generate once, then run the installed local 4x restorer in the same run. */
  autoEnhance?: boolean;

  // Professional studio controls. Every field below is compiled into either the
  // diffusion prompt or the engine arguments; none of them is decorative.
  quality?: ImageQuality;
  aspect?: ImageAspect;
  lighting?: string;
  camera?: string;
  perspective?: string;
  composition?: string;
  colorPalette?: string;
  depthOfField?: string;
  detailLevel?: string;
  atmosphere?: string;
  weather?: string;
  timeOfDay?: string;
  texture?: string;
  realism?: string;
  /** Number of real engine renders in one request. Capped by the server. */
  batchCount?: number;
  /** Explicit local checkpoint. "auto" uses Realistic Vision for people, SD 1.5 F16 otherwise. */
  modelId?: ImageModelId;
  /** "auto" resolves to deterministic Euler, the colour-stable sampler in local A/B tests. */
  sampler?: string;
  /** "auto" resolves to Karras, the best-tested sigma schedule for SD 1.5 here. */
  scheduler?: string;
  editMode?: ImageEditMode;
  /** Saved local asset IDs used as diffusion input / mask / visual inspiration. */
  initImageId?: string;
  maskImageId?: string;
  referenceIds?: string[];
  outpaintDirection?: ImageOutpaintDirection;
}

/** A locally uploaded image. It can guide a render but is never the final output. */
export interface ImageAsset {
  id: string;
  kind: "reference" | "edit" | "mask";
  name: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  colors: ColorSample[];
  brightness: number;
  createdAt: string;
  note: string;
}

export interface ImageModelOption {
  id: ImageModelId;
  name: string;
  file: string;
  bytes: number;
  available: boolean;
  note: string;
}

export interface ImageBackendOption {
  id: string;
  name: string;
  available: boolean;
  note: string;
}

export interface ImageEvaluation {
  id: string;
  imageId: string;
  /** 1–5 scores. 0 means "not scored". */
  quality: number;
  promptAccuracy: number;
  realism: number;
  styleAccuracy: number;
  weaknesses: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImageCollection {
  id: string;
  name: string;
  description: string;
  imageIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ImageGalleryMeta {
  favorites: string[];
  collections: ImageCollection[];
  evaluations: ImageEvaluation[];
  notes: Record<string, string>;
}

export interface ImageFeedback {
  id: string;
  rating: "like" | "dislike";
  correction: string;
  kinds: Array<VisualFeedbackNote["kind"]>;
  createdAt: string;
}

/** Exact local-engine facts recorded at render time, not inferred from settings. */
export interface ImageRenderProvenance {
  /** Recorded only when the original render was produced by this engine. */
  diffusion?: {
    width: number;
    height: number;
    steps: number;
    cfg: number;
    seed: number;
    sampler: string;
    scheduler: string;
    cacheMode: "quality" | "balanced" | "turbo";
    threads: number;
    vaeTiling: boolean;
    hires: boolean;
    hiresSteps?: number;
    modelFile: string;
    engine?: string;
  };
  final: {
    width: number;
    height: number;
    /** Which stage produced the saved pixels. */
    source: "diffusion" | "local-restorer";
    upscaler?: {
      name: string;
      file: string;
      scale: number;
      durationMs: number;
      sourceId: string;
    };
  };
}

export interface GeneratedImage {
  id: string;
  originalPrompt: string;
  finalPrompt: string;
  negativePrompt: string;
  model: string;
  settings: ImageGenerationSettings;
  status: "complete" | "failed";
  imageUrl: string | null;
  createdAt: string;
  durationMs: number;
  researchSummary: {
    skipped: boolean;
    reason?: string;
    subjects: string[];
    references: number;
    characteristics: string[];
    queries: string[];
  };
  feedback: ImageFeedback[];
  error?: string;
  /** Set when this image is a 4x restoration of another saved image. */
  upscaleSourceId?: string;
  /** Recorded engine arguments and real output dimensions. Absent on old records. */
  render?: ImageRenderProvenance;
  /** Honest notes about cues that were withheld or stages that failed safely. */
  pipelineNotes?: string[];
  /** Human-readable prompt expansion shown by the original/enhanced toggle. */
  enhancedPrompt?: string;
  /** Real edit provenance. Absent for plain text-to-image renders. */
  edit?: {
    mode: ImageEditMode;
    sourceId?: string;
    maskId?: string;
    strength: number;
    note: string;
  };
  /** 1-based index when several real renders were produced in one run. */
  batchIndex?: number;
  batchTotal?: number;
}

export type ImageStage =
  | "queued"
  | "understanding"
  | "enhancing-prompt"
  | "enhancing"
  | "identifying"
  | "researching"
  | "analyzing"
  | "knowledge"
  | "description"
  | "composing"
  | "model"
  | "preparing"
  | "generating"
  | "evaluating"
  | "validating"
  | "saving"
  | "done"
  | "error";

export interface ImageActivity {
  id: string;
  stage: ImageStage;
  status: "running" | "ok" | "error";
  message: string;
  detail?: string;
  progress?: number;
  at: string;
}

export interface ImageEngineStatus {
  ready: boolean;
  modelName: string;
  modelFile: string;
  modelBytes: number;
  binary: string;
  binaryBytes: number;
  upscalerReady: boolean;
  upscalerFile: string;
  upscalerName: string;
  message: string;
  hardware: {
    platform: string;
    arch: string;
    cpuCount: number;
    totalMemoryGb: number;
    gpu: string[];
  };
  limits: {
    maxWidth: number;
    maxHeight: number;
    maxSteps: number;
    timeoutSeconds: number;
    maxBatch: number;
  };
  /** Only locally installed checkpoints appear as available. */
  models: ImageModelOption[];
  backends: ImageBackendOption[];
  queue: { active: boolean; waiting: number; label: string | null };
}

export type VideoMotion = "pan-right" | "pan-left" | "zoom-in" | "zoom-out" | "drift" | "none";

export interface VideoGenerationSettings {
  /** Number of distinct locally rendered keyframes. Capped by the image queue at 4. */
  keyframes: number;
  fps: number;
  seconds: number;
  motion: VideoMotion;
  /** 0–100. Controls crop travel for pan/zoom interpolation, not model strength. */
  strength: number;
}

export interface GeneratedVideo {
  id: string;
  originalPrompt: string;
  finalPrompt: string;
  negativePrompt: string;
  videoUrl: string;
  posterUrl: string;
  createdAt: string;
  durationMs: number;
  status: "complete" | "failed";
  settings: VideoGenerationSettings;
  /** Exact image settings used for the local keyframe renders. */
  generation: ImageGenerationSettings;
  model: string;
  sourceKeyframeIds: string[];
  frameCount: number;
  keyframeCount: number;
  fps: number;
  width: number;
  height: number;
  bytes: number;
  encoder: string;
  pipelineNotes: string[];
  error?: string;
}

export type VideoStage =
  | "queued"
  | "understanding"
  | "enhancing-prompt"
  | "description"
  | "model"
  | "preparing"
  | "generating"
  | "validating"
  | "animating"
  | "encoding"
  | "saving"
  | "done"
  | "error";

export interface VideoActivity {
  id: string;
  stage: VideoStage;
  status: "running" | "ok" | "error";
  message: string;
  detail?: string;
  progress?: number;
  at: string;
}

export interface VideoEngineStatus {
  ready: boolean;
  message: string;
  encoder: string;
  binary: string;
  binaryBytes: number;
  limits: {
    maxKeyframes: number;
    maxFrames: number;
    minFps: number;
    maxFps: number;
    maxSeconds: number;
    maxWidth: number;
    maxHeight: number;
  };
  queue: { active: boolean; waiting: number; label: string | null };
}

export interface ImageSettings {
  researchEnabled: boolean;
  forceResearch: boolean;
  maxReferences: number;
  autoSaveKnowledge: boolean;
  /** Show and use the structured prompt expansion. User can compare original vs enhanced. */
  enhancePrompt?: boolean;
  generation: ImageGenerationSettings;
  /** Additive local-video settings; older saved settings normalize to defaults. */
  video?: VideoGenerationSettings;
}

export interface ImageExportBundle {
  app: "DavidAI-image";
  version: 1 | 2 | 3;
  exportedAt: string;
  concepts: VisualConcept[];
  history: GeneratedImage[];
  settings: ImageSettings;
  galleryMeta?: ImageGalleryMeta;
  /** Additive v3 field. Older bundles import without video history. */
  videos?: GeneratedVideo[];
}
