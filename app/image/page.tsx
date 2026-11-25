"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useImageStore, DEFAULT_IMAGE_SETTINGS } from "@/lib/image/use-image-store";
import { buildSmartDescription, type SmartDescription } from "@/lib/image/smart-prompt";
import { enhancePrompt, promptWeaknesses } from "@/lib/image/prompt-enhancer";
import { classifyFeedback, identifySubjects } from "@/lib/image/visual-knowledge";
import { DEFAULT_VIDEO_SETTINGS, LOCAL_UPSCALER_NAME, LOCAL_UPSCALER_SCALE } from "@/lib/image/types";
import type {
  GeneratedImage,
  GeneratedVideo,
  ImageActivity,
  ImageAspect,
  ImageAsset,
  ImageEngineStatus,
  ImageFeedback,
  ImageGenerationSettings,
  ImageQuality,
  ScopedCorrection,
  VideoActivity,
  VideoEngineStatus,
  VideoGenerationSettings,
  VideoMotion,
  VisualResearchResult,
} from "@/lib/image/types";
import { makeId } from "@/lib/storage";
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, Input, PageHeader,
  ProgressBar, Select, Stat, Textarea,
} from "@/components/ui";
import {
  AssetManager, EvaluationPanel, GenerationDetails, ImageViewer, ModelPanel,
  PromptLab, PromptPreview, ProControls,
} from "@/components/image-studio-pro";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusTone(status: ImageActivity["status"]): "cyan" | "green" | "amber" | "red" {
  if (status === "running") return "cyan";
  if (status === "ok") return "green";
  return "red";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** NDJSON streams can be interrupted between lines; never let that crash the UI. */
function parseEvent<T>(line: string): T | null {
  try { return JSON.parse(line) as T; } catch { return null; }
}

const ASPECT_DIMENSIONS: Record<ImageAspect, { width: number; height: number }> = {
  square: { width: 384, height: 384 },
  portrait: { width: 320, height: 384 },
  landscape: { width: 384, height: 320 },
  ultrawide: { width: 448, height: 256 },
  custom: { width: 384, height: 384 },
};

const QUALITY_PROFILES: Record<ImageQuality, Pick<ImageGenerationSettings, "width" | "height" | "steps" | "speed" | "hires" | "autoEnhance">> = {
  draft: { width: 256, height: 256, steps: 8, speed: "balanced", hires: false, autoEnhance: false },
  standard: { width: 320, height: 320, steps: 16, speed: "balanced", hires: false, autoEnhance: false },
  high: { width: 384, height: 384, steps: 20, speed: "balanced", hires: false, autoEnhance: false },
  ultra: { width: 512, height: 512, steps: 24, speed: "quality", hires: true, autoEnhance: false },
};

const QUALITY_PRESETS: Record<string, Pick<ImageGenerationSettings, "width" | "height" | "steps" | "guidance" | "hires" | "speed" | "autoEnhance" | "modelId" | "sampler" | "scheduler">> = {
  fasthd: { width: 256, height: 256, steps: 8, guidance: 7, hires: false, speed: "balanced", autoEnhance: false, modelId: "auto", sampler: "auto", scheduler: "auto" },
  draft: { width: 256, height: 256, steps: 8, guidance: 7, hires: false, speed: "balanced", autoEnhance: false, modelId: "auto", sampler: "auto", scheduler: "auto" },
  balanced: { width: 320, height: 320, steps: 16, guidance: 7, hires: false, speed: "balanced", autoEnhance: false, modelId: "auto", sampler: "auto", scheduler: "auto" },
  detailed: { width: 384, height: 384, steps: 20, guidance: 7, hires: false, speed: "balanced", autoEnhance: false, modelId: "auto", sampler: "auto", scheduler: "auto" },
  maximum: { width: 512, height: 512, steps: 24, guidance: 7, hires: true, speed: "quality", autoEnhance: false, modelId: "auto", sampler: "auto", scheduler: "auto" },
  // The fused LCM checkpoint uses its own sampler, sigma schedule, step count
  // and CFG. These are real engine values, recorded in every image's provenance.
  lcmfast: { width: 384, height: 384, steps: 6, guidance: 1.5, hires: false, speed: "quality", autoEnhance: false, modelId: "dreamshaper-lcm", sampler: "lcm", scheduler: "lcm" },
};

function matchingPreset(generation: ImageGenerationSettings): string {
  const match = Object.entries(QUALITY_PRESETS).find(([, preset]) =>
    preset.width === generation.width && preset.height === generation.height &&
    preset.steps === generation.steps && preset.guidance === generation.guidance &&
    Boolean(preset.hires) === Boolean(generation.hires) &&
    (preset.speed ?? "balanced") === (generation.speed ?? "balanced") &&
    Boolean(preset.autoEnhance) === Boolean(generation.autoEnhance) &&
    (preset.modelId ?? "auto") === (generation.modelId ?? "auto") &&
    (preset.sampler ?? "auto") === (generation.sampler ?? "auto") &&
    (preset.scheduler ?? "auto") === (generation.scheduler ?? "auto"));
  return match?.[0] ?? "custom";
}

interface GenerateOverrides {
  prompt?: string;
  generation?: ImageGenerationSettings;
  forceResearch?: boolean;
}

export default function ImagePage() {
  const { logActivity } = useStore();
  const {
    hydrated, concepts, history, videos, settings, galleryMeta, mistakes,
    addConcepts, saveImage, saveVideo, deleteImage, deleteVideo, clearHistory, updateSettings, applyFeedback, addKnowledgeRule, learnFromGalleryNow,
    toggleFavorite, createCollection, deleteCollection, toggleCollectionImage, saveEvaluation,
    exportBundle, importBundle,
  } = useImageStore();

  const [engine, setEngine] = useState<ImageEngineStatus | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [research, setResearch] = useState<VisualResearchResult | null>(null);
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [activities, setActivities] = useState<ImageActivity[]>([]);
  const [videoEngine, setVideoEngine] = useState<VideoEngineStatus | null>(null);
  const [videoActivities, setVideoActivities] = useState<VideoActivity[]>([]);
  const [videoGenerating, setVideoGenerating] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [currentVideo, setCurrentVideo] = useState<GeneratedVideo | null>(null);
  const [videoToDelete, setVideoToDelete] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceProgress, setEnhanceProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<GeneratedImage | null>(null);
  const [lastDescription, setLastDescription] = useState<SmartDescription | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [assetBusy, setAssetBusy] = useState<string | null>(null);
  const [bundleMessage, setBundleMessage] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [resultPromptView, setResultPromptView] = useState<"original" | "enhanced" | "final">("final");
  const [galleryQuery, setGalleryQuery] = useState("");
  const [galleryFilter, setGalleryFilter] = useState<"all" | "favorites">("all");
  const [galleryCollection, setGalleryCollection] = useState("all");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [newCollection, setNewCollection] = useState("");
  const [knowledgeSubject, setKnowledgeSubject] = useState("airplane");
  const [knowledgeRule, setKnowledgeRule] = useState("");
  const [knowledgeAvoid, setKnowledgeAvoid] = useState(false);
  const [datasetPacks, setDatasetPacks] = useState<Array<{
    id: string; name: string; description: string; source: string; license: string;
    concepts: number; positiveRules: number; negativeRules: number;
  }>>([]);
  const [datasetStats, setDatasetStats] = useState<{ packs: number; concepts: number; positiveRules: number; negativeRules: number } | null>(null);
  const [datasetBusy, setDatasetBusy] = useState<string | null>(null);
  const [datasetJson, setDatasetJson] = useState("");
  const [datasetMessage, setDatasetMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const enhanceAbortRef = useRef<AbortController | null>(null);
  const videoAbortRef = useRef<AbortController | null>(null);
  const generationJobRef = useRef("");
  const videoJobRef = useRef("");
  const enhanceJobRef = useRef("");
  const bundleInputRef = useRef<HTMLInputElement>(null);

  const refreshEngine = useCallback(async (silent = false) => {
    if (!silent) setEngineLoading(true);
    if (!silent) setEngineError(null);
    try {
      const response = await fetch("/api/image/status", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `Status request failed (${response.status}).`);
      setEngine(data.status as ImageEngineStatus);
    } catch (caught) {
      setEngineError(errorMessage(caught));
    } finally {
      if (!silent) setEngineLoading(false);
    }
  }, []);

  useEffect(() => { void refreshEngine(); }, [refreshEngine]);

  const refreshVideoEngine = useCallback(async () => {
    try {
      const response = await fetch("/api/video/status", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `Video status request failed (${response.status}).`);
      setVideoEngine(data.status as VideoEngineStatus);
    } catch (caught) {
      setVideoError(errorMessage(caught));
    }
  }, []);

  useEffect(() => { void refreshVideoEngine(); }, [refreshVideoEngine]);

  useEffect(() => {
    if (!currentVideo && videos.length) setCurrentVideo(videos[0]);
  }, [currentVideo, videos]);

  useEffect(() => {
    if (!generating) return;
    // The generation stream already reports real denoiser steps and sends a
    // 15s heartbeat. Polling the full engine status every 3s only re-stat-ed
    // model files and re-read the manifest, so slow it to a lightweight safety
    // check while the stream remains the source of truth for progress.
    const timer = setInterval(() => { void refreshEngine(true); }, 12_000);
    return () => clearInterval(timer);
  }, [generating, refreshEngine]);

  const loadAssets = useCallback(async () => {
    try {
      const response = await fetch("/api/image/assets", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(data.assets)) setAssets(data.assets as ImageAsset[]);
    } catch { /* uploads remain available after a transient failure */ }
  }, []);

  useEffect(() => { void loadAssets(); }, [loadAssets]);

  useEffect(() => {
    let active = true;
    void fetch("/api/image/datasets", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!active || !data?.ok) return;
        setDatasetPacks(data.packs ?? []);
        setDatasetStats(data.stats ?? null);
      })
      .catch(() => { /* the workspace still works with its bundled seeds */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!current && history.length) setCurrent(history[0]);
  }, [current, history]);

  const subjects = useMemo(() => identifySubjects(prompt, concepts, 6), [prompt, concepts]);
  const feedbackNotes = useMemo(() => concepts.flatMap((concept) => concept.feedbackNotes), [concepts]);
  const recentCorrections = useMemo<ScopedCorrection[]>(() => [
    ...mistakes,
    ...history.flatMap((item) => item.feedback.flatMap((feedback) => {
      if (!feedback.kinds.includes("correction") || !feedback.correction.trim()) return [];
      const subjects = item.researchSummary.subjects;
      return (subjects.length ? subjects : [undefined]).map((subject) => ({
        note: feedback.correction.trim().slice(0, 240),
        subject,
        kind: "correction" as const,
        count: 1,
      }));
    })),
  ].slice(-12), [history, mistakes]);

  const enhancement = useMemo(() => enhancePrompt(prompt, settings.generation), [prompt, settings.generation]);
  const promptIssues = useMemo(() => promptWeaknesses(prompt, settings.generation), [prompt, settings.generation]);
  const promptStrengths = useMemo(() => {
    const found = enhancement.intent.categories;
    return found.length ? [`${found.length} visual dimension${found.length === 1 ? "" : "s"} detected`] : [];
  }, [enhancement]);

  const preview = useMemo(() => {
    if (prompt.trim().length < 3) return null;
    // Use the exact compiler the generation route uses, so the preview is a
    // preview of the sent prompt rather than a second approximation.
    return buildSmartDescription({
      prompt,
      subjects,
      concepts,
      feedbackNotes,
      settings: settings.generation,
      recentCorrections,
      enhancement: settings.enhancePrompt === false ? null : enhancement,
    });
  }, [prompt, subjects, concepts, feedbackNotes, settings.generation, recentCorrections, enhancement, settings.enhancePrompt]);

  const latestActivity = activities.length ? activities[activities.length - 1] : null;
  const displayDescription = lastDescription ?? preview;
  const currentEvaluation = galleryMeta.evaluations.find((item) => item.imageId === current?.id);
  const evaluationAverage = galleryMeta.evaluations.length
    ? galleryMeta.evaluations.reduce((sum, item) => sum + item.quality + item.promptAccuracy + item.realism + item.styleAccuracy, 0) / (galleryMeta.evaluations.length * 4)
    : 0;
  const galleryImages = useMemo(() => {
    const query = galleryQuery.trim().toLowerCase();
    return history.filter((image) => {
      if (galleryFilter === "favorites" && !galleryMeta.favorites.includes(image.id)) return false;
      if (galleryCollection !== "all") {
        const collection = galleryMeta.collections.find((item) => item.id === galleryCollection);
        if (!collection?.imageIds.includes(image.id)) return false;
      }
      if (!query) return true;
      return [image.originalPrompt, image.finalPrompt, image.model, image.enhancedPrompt ?? ""]
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [history, galleryQuery, galleryFilter, galleryCollection, galleryMeta.favorites, galleryMeta.collections]);
  const compareImages = compareIds
    .map((id) => history.find((image) => image.id === id))
    .filter((image): image is GeneratedImage => Boolean(image))
    .slice(0, 3);
  const displayModel = current?.model ?? engine?.modelName ?? "—";
  const feedbackCount = history.reduce((total, item) => total + item.feedback.length, 0);
  const preferenceCount = history.reduce((total, item) => total + item.feedback.filter((entry) => entry.kinds.includes("preference")).length, 0);
  const factCount = history.reduce((total, item) => total + item.feedback.filter((entry) => entry.kinds.includes("visual-fact")).length, 0);
  const correctionCount = history.reduce((total, item) => total + item.feedback.filter((entry) => entry.kinds.includes("correction")).length, 0);
  const researchedConcepts = concepts.filter((concept) => concept.sources.length > 0).length;
  const totalRules = concepts.reduce((total, concept) => total + (concept.constraints?.length ?? 0) + (concept.negativeConstraints?.length ?? 0), 0);
  const manualRules = concepts
    .flatMap((concept) => (concept.feedbackNotes ?? []).filter((note) => note.id.startsWith("manual:")).map((note) => ({ subject: note.subject ?? concept.name, note: note.note })))
    .slice(-4);

  const appendActivity = useCallback((activity: ImageActivity) => {
    setActivities((previous) => [...previous.slice(-80), activity]);
  }, []);

  const appendVideoActivity = useCallback((activity: VideoActivity) => {
    setVideoActivities((previous) => [...previous.slice(-40), activity]);
  }, []);

  const generate = useCallback(async (overrides?: GenerateOverrides) => {
    if (generating) return;
    const requestPrompt = (overrides?.prompt ?? prompt).trim();
    if (requestPrompt.length < 3) {
      setError("Describe the image you want before generating.");
      return;
    }
    if (!engine?.ready) {
      setError(engineError ?? engine?.message ?? "The local image engine is not installed.");
      return;
    }
    const generation = overrides?.generation ?? settings.generation;
    if (generation.editMode && generation.editMode !== "text") {
      if (!generation.initImageId) {
        setError("Upload and select an edit source image before using an editing mode.");
        return;
      }
      if (["mask", "remove", "background"].includes(generation.editMode) && !generation.maskImageId) {
        setError("This editing mode needs a mask. Paint edited areas white and preserved areas black.");
        return;
      }
    }
    const controller = new AbortController();
    const jobId = makeId();
    abortRef.current = controller;
    generationJobRef.current = jobId;
    setGenerating(true);
    setError(null);
    setResearchError(null);
    setActivities([]);
    setProgress(0);
    logActivity("info", `Local image generation started: “${requestPrompt.slice(0, 80)}”.`);

    try {
      const response = await fetch("/api/image/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: requestPrompt,
          concepts,
          recentCorrections,
          jobId,
          settings: {
            ...settings,
            forceResearch: overrides?.forceResearch ?? settings.forceResearch,
            generation,
          },
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `Generation failed (${response.status}).`);
      }
      if (!response.body) throw new Error("The generation stream was empty.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = parseEvent<{
            type?: string;
            activity?: ImageActivity;
            image?: GeneratedImage;
            images?: GeneratedImage[];
            concepts?: typeof concepts;
            research?: VisualResearchResult;
            prompts?: { original: string; enhanced: string; final: string; negative: string; adjustments: string[] };
            message?: string;
          }>(line);
          if (!event) {
            logActivity("warning", "Ignored a malformed generation stream event.");
            continue;
          }
          if (event.type === "activity" && event.activity) {
            appendActivity(event.activity);
            if (typeof event.activity.progress === "number") setProgress(event.activity.progress);
          } else if (event.type === "complete" && event.image) {
            const images = Array.isArray(event.images) && event.images.length ? event.images : [event.image];
            for (const image of images) saveImage(image);
            setCurrent(images[0]);
            setLastDescription({
              finalPrompt: event.prompts?.final ?? images[0].finalPrompt,
              negativePrompt: event.prompts?.negative ?? images[0].negativePrompt,
              usedConcepts: images[0].researchSummary.subjects,
              adjustments: event.prompts?.adjustments ?? [],
            });
            if (Array.isArray(event.concepts)) addConcepts(event.concepts);
            if (event.research) setResearch(event.research);
            setProgress(100);
            completed = true;
          } else if (event.type === "error") {
            throw new Error(event.message ?? "Image generation failed.");
          }
        }
      }
      if (!completed) throw new Error("Generation ended without producing an image.");
      logActivity("success", "Local image generation completed and saved to disk.");
    } catch (caught) {
      if (controller.signal.aborted) {
        setError("Image generation was stopped.");
        logActivity("warning", "Image generation was stopped.");
      } else {
        setError(errorMessage(caught));
        appendActivity({
          id: makeId(), stage: "error", status: "error",
          message: "Generation failed", detail: errorMessage(caught), at: new Date().toISOString(),
        });
        logActivity("error", `Image generation failed: ${errorMessage(caught)}`);
      }
    } finally {
      abortRef.current = null;
      generationJobRef.current = "";
      setGenerating(false);
    }
  }, [prompt, engine, engineError, concepts, recentCorrections, settings, generating, appendActivity, saveImage, addConcepts, logActivity]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    // The stream may be buffered by an intermediary; the server-side cancel
    // aborts only this tab's engine process or queued slot.
    void fetch("/api/image/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: generationJobRef.current }),
    }).catch(() => undefined);
  }, []);

  const focusVisualRequest = useCallback(() => {
    const field = document.querySelector<HTMLTextAreaElement>('textarea[placeholder^="e.g. a golden retriever"]');
    field?.scrollIntoView({ block: "center", behavior: "smooth" });
    field?.focus();
  }, []);

  /**
   * Honest local video: real AI keyframes, deterministic CPU motion frames,
   * then a real VP8 WebM from the bundled encoder. Not text-to-video.
   */
  const generateVideo = useCallback(async () => {
    if (videoGenerating) return;
    const requestPrompt = prompt.trim();
    if (requestPrompt.length < 3) {
      setVideoError("Type a visual request first — the prompt box is now focused.");
      focusVisualRequest();
      return;
    }
    if (!videoEngine?.ready) {
      setVideoError(videoEngine?.message ?? videoError ?? "The local video encoder is not installed.");
      return;
    }
    const controller = new AbortController();
    const jobId = makeId();
    videoAbortRef.current = controller;
    videoJobRef.current = jobId;
    setVideoGenerating(true);
    setVideoError(null);
    setVideoActivities([]);
    setVideoProgress(0);
    logActivity("info", `Local keyframe animation started: “${requestPrompt.slice(0, 80)}”.`);

    try {
      const response = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: requestPrompt,
          concepts,
          recentCorrections,
          jobId,
          video: settings.video ?? DEFAULT_VIDEO_SETTINGS,
          settings: { generation: settings.generation },
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `Video generation failed (${response.status}).`);
      }
      if (!response.body) throw new Error("The video generation stream was empty.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = parseEvent<{
            type?: string;
            activity?: VideoActivity;
            video?: GeneratedVideo;
            prompts?: { original: string; enhanced: string; final: string; negative: string; adjustments: string[] };
            message?: string;
          }>(line);
          if (!event) {
            logActivity("warning", "Ignored a malformed video stream event.");
            continue;
          }
          if (event.type === "activity" && event.activity) {
            appendVideoActivity(event.activity);
            if (typeof event.activity.progress === "number") setVideoProgress(event.activity.progress);
          } else if (event.type === "complete" && event.video) {
            saveVideo(event.video);
            setCurrentVideo(event.video);
            if (Array.isArray(event.prompts?.adjustments)) {
              setLastDescription({
                finalPrompt: event.prompts?.final ?? event.video.finalPrompt,
                negativePrompt: event.prompts?.negative ?? event.video.negativePrompt,
                usedConcepts: [],
                adjustments: event.prompts.adjustments,
              });
            }
            setVideoProgress(100);
            completed = true;
          } else if (event.type === "error") {
            throw new Error(event.message ?? "Video generation failed.");
          }
        }
      }
      if (!completed) throw new Error("Video generation ended without producing a WebM file.");
      logActivity("success", "Local WebM animation completed and saved to disk.");
    } catch (caught) {
      if (controller.signal.aborted) {
        setVideoError("Video generation was stopped.");
        logActivity("warning", "Video generation was stopped.");
      } else {
        setVideoError(errorMessage(caught));
        appendVideoActivity({
          id: makeId(), stage: "error", status: "error",
          message: "Video generation failed", detail: errorMessage(caught), at: new Date().toISOString(),
        });
        logActivity("error", `Video generation failed: ${errorMessage(caught)}`);
      }
    } finally {
      videoAbortRef.current = null;
      videoJobRef.current = "";
      setVideoGenerating(false);
      void refreshVideoEngine();
    }
  }, [prompt, videoEngine, videoError, concepts, recentCorrections, settings, videoGenerating, focusVisualRequest, appendVideoActivity, saveVideo, logActivity, refreshVideoEngine]);

  const stopVideo = useCallback(() => {
    videoAbortRef.current?.abort();
    void fetch("/api/video/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: videoJobRef.current }),
    }).catch(() => undefined);
  }, []);

  /** Offline local-restorer enhancement of any saved image. */
  const enhanceImage = useCallback(async (image: GeneratedImage) => {
    if (enhancing) return;
    if (!engine?.upscalerReady) {
      setError(`The local ${LOCAL_UPSCALER_NAME} upscaler is not installed. Run npm run setup:image once.`);
      return;
    }
    if (image.upscaleSourceId || image.render?.final.source === "local-restorer") {
      setError("This image is already a 4× restoration. Enhance the original render instead.");
      return;
    }
    if (!image.imageUrl) {
      setError("That history entry has no image file to enhance.");
      return;
    }
    const controller = new AbortController();
    const jobId = makeId();
    enhanceAbortRef.current = controller;
    enhanceJobRef.current = jobId;
    setEnhancing(true);
    setError(null);
    setEnhanceProgress(0);
    logActivity("info", `Local ${LOCAL_UPSCALER_SCALE}× enhancement started with ${LOCAL_UPSCALER_NAME} for image ${image.id.slice(0, 8)}.`);
    try {
      const response = await fetch("/api/image/upscale", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ id: image.id, jobId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `Enhancement failed (${response.status}).`);
      }
      if (!response.body) throw new Error("The enhancement stream was empty.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = parseEvent<{ type?: string; activity?: ImageActivity; image?: GeneratedImage; message?: string }>(line);
          if (!event) {
            logActivity("warning", "Ignored a malformed enhancement stream event.");
            continue;
          }
          if (event.type === "activity" && event.activity) {
            appendActivity(event.activity);
            if (typeof event.activity.progress === "number") setEnhanceProgress(event.activity.progress);
          } else if (event.type === "complete" && event.image) {
            saveImage(event.image);
            setCurrent(event.image);
            setEnhanceProgress(100);
            completed = true;
          } else if (event.type === "error") {
            throw new Error(event.message ?? "Enhancement failed.");
          }
        }
      }
      if (!completed) throw new Error("Enhancement ended without producing an image.");
      logActivity("success", "4x enhancement completed and saved to disk.");
    } catch (caught) {
      if (controller.signal.aborted) {
        setError("Enhancement was stopped.");
        logActivity("warning", "Image enhancement was stopped.");
      } else {
        setError(errorMessage(caught));
        logActivity("error", `Image enhancement failed: ${errorMessage(caught)}`);
      }
    } finally {
      enhanceAbortRef.current = null;
      enhanceJobRef.current = "";
      setEnhancing(false);
    }
  }, [enhancing, engine, appendActivity, saveImage, logActivity]);

  const stopEnhancement = useCallback(() => {
    enhanceAbortRef.current?.abort();
    void fetch("/api/image/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: enhanceJobRef.current }),
    }).catch(() => undefined);
  }, []);

  const runResearch = useCallback(async (force: boolean) => {
    if (prompt.trim().length < 3) {
      setResearchError("Describe the image first so the research query has real subjects.");
      return;
    }
    if (!subjects.length) {
      setResearchError("No visual subjects were identified in that description.");
      return;
    }
    setResearching(true);
    setResearchError(null);
    try {
      const response = await fetch("/api/image/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, subjects, concepts, force, maxReferences: settings.maxReferences }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `Research failed (${response.status}).`);
      const result = data.result as VisualResearchResult;
      setResearch(result);
      addConcepts(result.concepts);
      logActivity("success", `Visual research found ${result.references.length} openly licensed reference(s).`);
    } catch (caught) {
      setResearchError(errorMessage(caught));
    } finally {
      setResearching(false);
    }
  }, [prompt, subjects, concepts, settings.maxReferences, addConcepts, logActivity]);

  /** Loads a bundled or user-supplied visual knowledge dataset into this workspace. */
  const loadDataset = useCallback(async (packId: string, custom?: unknown) => {
    setDatasetBusy(packId);
    setDatasetMessage(null);
    try {
      const response = await fetch("/api/image/datasets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(custom ? { packId, concepts: custom } : { packId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `Dataset load failed (${response.status}).`);
      addConcepts(data.concepts);
      const message = `Loaded ${data.stats.concepts} concept(s) with ${data.stats.positiveRules} positive and ${data.stats.negativeRules} negative rules.`;
      setDatasetMessage(message);
      logActivity("success", message);
    } catch (caught) {
      setDatasetMessage(errorMessage(caught));
    } finally {
      setDatasetBusy(null);
    }
  }, [addConcepts, logActivity]);

  const importDatasetText = useCallback(async () => {
    if (!datasetJson.trim()) {
      setDatasetMessage("Paste a JSON array of visual concepts first.");
      return;
    }
    try {
      const parsed = JSON.parse(datasetJson);
      const list = Array.isArray(parsed) ? parsed : parsed?.concepts;
      if (!Array.isArray(list)) throw new Error("Expected a JSON array of concepts or an object with a concepts array.");
      await loadDataset("custom", list);
      setDatasetJson("");
    } catch (caught) {
      setDatasetMessage(errorMessage(caught));
    }
  }, [datasetJson, loadDataset]);

  const learnFromGallery = useCallback(() => {
    const result = learnFromGalleryNow();
    setDatasetMessage(result.added
      ? `Learned ${result.added} new rule(s) from ${result.subjects.join(", ")}. No model retraining was performed.`
      : "No new rules found. Give feedback on an image, then try again.");
  }, [learnFromGalleryNow]);

  const uploadAsset = useCallback(async (file: File, kind: ImageAsset["kind"]) => {
    setAssetBusy(kind);
    setBundleMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      const response = await fetch("/api/image/assets", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `Upload failed (${response.status}).`);
      setAssets((previous) => [data.asset as ImageAsset, ...previous]);
      logActivity("success", `Local ${kind} image uploaded for image studio use.`);
    } catch (caught) {
      setBundleMessage(errorMessage(caught));
    } finally {
      setAssetBusy(null);
    }
  }, [logActivity]);

  const deleteAsset = useCallback(async (id: string) => {
    try { await fetch(`/api/image/assets/${encodeURIComponent(id)}`, { method: "DELETE" }); } catch { /* local list still updates */ }
    setAssets((previous) => previous.filter((asset) => asset.id !== id));
    const patch: Partial<ImageGenerationSettings> = {};
    if (settings.generation.initImageId === id) patch.initImageId = undefined;
    if (settings.generation.maskImageId === id) patch.maskImageId = undefined;
    if (settings.generation.referenceIds?.includes(id)) {
      patch.referenceIds = settings.generation.referenceIds.filter((value) => value !== id);
    }
    if (Object.keys(patch).length) updateSettings({ generation: { ...settings.generation, ...patch } });
  }, [settings.generation, updateSettings]);

  const toggleReference = useCallback((id: string) => {
    const currentIds = settings.generation.referenceIds ?? [];
    updateSettings({
      generation: {
        ...settings.generation,
        referenceIds: currentIds.includes(id) ? currentIds.filter((value) => value !== id) : [...currentIds, id].slice(0, 6),
      },
    });
  }, [settings.generation, updateSettings]);

  const downloadBundle = useCallback(() => {
    const blob = new Blob([JSON.stringify(exportBundle(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `davidai-image-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setBundleMessage(`Image workspace exported as JSON with ${videos.length} local video record${videos.length === 1 ? "" : "s"}. Generated files stay on local disk.`);
  }, [exportBundle, videos.length]);

  const importBundleFile = useCallback(async (file: File) => {
    try {
      importBundle(await file.text());
      setBundleMessage("Image workspace imported and validated. Old image files remain in local storage.");
      logActivity("success", "Image workspace bundle imported.");
    } catch (caught) {
      setBundleMessage(errorMessage(caught));
    }
  }, [importBundle, logActivity]);

  const evaluateCurrent = useCallback((value: Parameters<typeof saveEvaluation>[0]) => {
    if (!current) return;
    saveEvaluation(value);
    logActivity("info", `Evaluation saved for image ${current.id.slice(0, 8)}; ${value.weaknesses.length} weakness note(s).`);
  }, [current, saveEvaluation, logActivity]);

  const submitFeedback = useCallback(async (rating: ImageFeedback["rating"]) => {
    if (!current) return;
    const text = feedbackText.trim();
    const feedback: ImageFeedback = {
      id: makeId(),
      rating,
      correction: text,
      kinds: text ? classifyFeedback(text) : [],
      createdAt: new Date().toISOString(),
    };
    applyFeedback(current.id, feedback);
    setFeedbackText("");
    setFeedbackNotice(null);
    logActivity("info", `Image feedback saved (${rating}${text ? " with explanation" : ""}).`);
    try {
      const response = await fetch("/api/image/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageId: current.id, feedback }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `Durable save failed (${response.status}).`);
      }
    } catch (caught) {
      // localStorage remains the source of truth for this browser, but the
      // user must know that the brain-level save did not happen.
      const detail = errorMessage(caught);
      setFeedbackNotice(`Feedback is saved in this browser, but the durable brain sync failed: ${detail}`);
      logActivity("warning", `Image feedback saved locally only: ${detail}`);
    }
  }, [current, feedbackText, applyFeedback, logActivity]);

  const openImage = useCallback((image: GeneratedImage) => {
    setCurrent(image);
    setViewerOpen(false);
    setPrompt(image.originalPrompt);
    setLastDescription({
      finalPrompt: image.finalPrompt,
      negativePrompt: image.negativePrompt,
      usedConcepts: image.researchSummary.subjects,
      adjustments: [],
    });
    setResearch(null);
    setFeedbackText("");
    setFeedbackNotice(null);
    setError(null);
  }, []);

  const makeVariation = useCallback((image: GeneratedImage) => {
    const variationPrompt = `${image.originalPrompt} — a fresh variation with a different composition`;
    setPrompt(variationPrompt);
    setCurrent(null);
    setViewerOpen(false);
    setResearch(null);
    setLastDescription(null);
    void generate({
      prompt: variationPrompt,
      generation: {
        ...image.settings,
        seed: null,
        editMode: "text",
        initImageId: undefined,
        maskImageId: undefined,
      },
      forceResearch: false,
    });
  }, [generate]);

  const removeImage = useCallback(async (image: GeneratedImage) => {
    deleteImage(image.id);
    if (current?.id === image.id) setCurrent(null);
    try { await fetch(`/api/image/generated/${encodeURIComponent(image.id)}`, { method: "DELETE" }); }
    catch { /* metadata removal still succeeds */ }
    logActivity("warning", "A generated image was removed from local storage.");
  }, [current, deleteImage, logActivity]);

  const removeVideo = useCallback(async (id: string) => {
    deleteVideo(id);
    if (currentVideo?.id === id) setCurrentVideo(null);
    try { await fetch(`/api/video/generated/${encodeURIComponent(id)}`, { method: "DELETE" }); }
    catch { /* local history still updates */ }
    setVideoToDelete(null);
    logActivity("warning", "A generated WebM was removed from local storage.");
  }, [currentVideo, deleteVideo, logActivity]);

  const clearAll = useCallback(() => {
    for (const image of history) {
      void fetch(`/api/image/generated/${encodeURIComponent(image.id)}`, { method: "DELETE" }).catch(() => undefined);
    }
    clearHistory();
    setCurrent(null);
    setPrompt("");
    setResearch(null);
    setLastDescription(null);
    setActivities([]);
    setProgress(0);
    setFeedbackText("");
    setConfirmClear(false);
    logActivity("warning", "Image workspace was cleared.");
  }, [history, clearHistory, logActivity]);

  const updateGeneration = useCallback((patch: Partial<ImageGenerationSettings>) => {
    updateSettings({ generation: { ...settings.generation, ...patch } });
  }, [settings.generation, updateSettings]);

  const updateVideo = useCallback((patch: Partial<VideoGenerationSettings>) => {
    updateSettings({ video: { ...(settings.video ?? DEFAULT_VIDEO_SETTINGS), ...patch } });
  }, [settings.video, updateSettings]);

  const applyAspect = useCallback((aspect: ImageAspect) => {
    const dimensions = ASPECT_DIMENSIONS[aspect];
    updateGeneration(aspect === "custom"
      ? { aspect }
      : { aspect, width: dimensions.width, height: dimensions.height });
  }, [updateGeneration]);

  const applyQuality = useCallback((quality: ImageQuality) => {
    const profile = QUALITY_PROFILES[quality];
    updateGeneration({
      quality,
      ...profile,
      aspect: profile.width === profile.height ? "square" : settings.generation.aspect ?? "square",
    });
  }, [settings.generation.aspect, updateGeneration]);

  if (!hydrated || engineLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="brand-emblem mx-auto mb-4 font-display text-3xl">◇</div>
          <div className="mono-label text-[var(--gold)]">Preparing the local image laboratory…</div>
          <div className="luxe-track mx-auto mt-4 h-0.5 w-40 overflow-hidden rounded">
            <div className="luxe-fill h-full w-1/2 rounded" />
          </div>
        </div>
      </div>
    );
  }

  const engineReady = Boolean(engine?.ready);
  const generationStatus = generating
    ? latestActivity?.message ?? "Starting…"
    : current ? "Complete" : "Not started";

  return (
    <>
      <PageHeader
        eyebrow="Local Image Laboratory"
        title="Image"
        description="Describe a visual idea, research openly licensed references when needed, build structured visual knowledge, and generate a genuinely new image or local keyframe WebM with a diffusion model. References are learning material only — generated pixels come from the local model."
        actions={<>
          <Button variant="outline" onClick={() => void refreshEngine()}>Refresh engine</Button>
          <Button variant="ghost" onClick={() => setSettingsOpen((value) => !value)}>{settingsOpen ? "Hide settings" : "Settings"}</Button>
          <Button variant={generating ? "danger" : "primary"} onClick={generating ? stopGeneration : () => void generate()}>
            {generating ? "Stop generation" : "Generate image"}
          </Button>
          <Button
            variant={videoGenerating ? "danger" : "outline"}
            onClick={videoGenerating ? stopVideo : () => void generateVideo()}
          >
            {videoGenerating ? "Stop video" : "Generate video"}
          </Button>
        </>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        <Stat label="Visual concepts" value={concepts.length} tone="text-cyan-300" />
        <Stat label="Researched concepts" value={researchedConcepts} />
        <Stat label="Generated images" value={history.length} />
        <Stat label="Generated videos" value={videos.length} />
        <Stat label="Feedback notes" value={feedbackCount} />
        <Stat label="Average rating" value={evaluationAverage ? evaluationAverage.toFixed(1) : "—"} suffix="/ 5" />
        <Stat label="Local engine" value={engine?.queue?.active ? "Busy" : "Ready"} tone={engine?.queue?.active ? "text-amber-300" : "text-emerald-300"} />
      </div>

      {!engineReady && (
        <Card className="mb-4" title="Local image engine is not installed" subtitle="One-time, free setup. No account, API key, subscription, or paid service.">
          <ErrorBox message={engineError ?? engine?.message ?? null} />
          <p className="mb-3 text-xs leading-relaxed text-[var(--muted)]">
            Run this once in the <span className="font-mono text-slate-300">davidai</span> folder, then click Refresh engine:
          </p>
          <pre className="overflow-x-auto rounded border hairline bg-black/40 p-3 font-mono text-xs text-cyan-300">npm run setup:image</pre>
          <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
            Setup downloads a compact CPU build of stable-diffusion.cpp, SD 1.5 F16 and Realistic Vision V6 GGUF weights,
            plus {LOCAL_UPSCALER_NAME} for offline enhancement. Generation afterwards is fully offline. An internet connection is only needed for setup and optional visual research.
          </p>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.5fr)]">
        <div className="space-y-4">
          <Card title="Generation workspace" subtitle="A real local model turns the final visual description into a new PNG.">
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void generate(); }}>
              <Field label="Visual request" hint="Describe subject, setting, style, lighting, and composition. The system expands it into a structured description.">
                <Textarea
                  value={prompt}
                  onChange={(event) => { setPrompt(event.target.value); setResearch(null); setLastDescription(null); }}
                  placeholder="e.g. a golden retriever sitting in a snowy forest at golden hour, close-up, photorealistic"
                  rows={6}
                  maxLength={1200}
                  disabled={generating}
                />
              </Field>

              <div className="grid grid-cols-3 gap-2">
                <Button type="button" variant={settings.researchEnabled ? "primary" : "secondary"} onClick={() => updateSettings({ researchEnabled: !settings.researchEnabled })} disabled={generating}>
                  Research {settings.researchEnabled ? "on" : "off"}
                </Button>
                <Button type="button" variant={settings.forceResearch ? "primary" : "secondary"} onClick={() => updateSettings({ forceResearch: !settings.forceResearch })} disabled={generating}>
                  Force lookup {settings.forceResearch ? "on" : "off"}
                </Button>
                <Button type="button" variant={settings.enhancePrompt === false ? "secondary" : "primary"} onClick={() => updateSettings({ enhancePrompt: settings.enhancePrompt === false })} disabled={generating}>
                  Enhance {settings.enhancePrompt === false ? "off" : "on"}
                </Button>
              </div>

              <ErrorBox message={error} />
              <div className="flex gap-2">
                <Button type="submit" variant="primary" className="flex-1" disabled={generating || prompt.trim().length < 3}>
                  {generating ? "Generating…" : "Generate image"}
                </Button>
                {generating && <Button type="button" variant="danger" onClick={stopGeneration}>Stop</Button>}
                <Button type="button" variant="ghost" onClick={() => { setPrompt(""); setResearch(null); setLastDescription(null); setError(null); }} disabled={generating}>Clear</Button>
              </div>

              {(generating || progress > 0 || enhancing || enhanceProgress > 0) && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-[var(--muted)]">
                    <span className="truncate pr-2">{enhancing ? `Enhancing with ${LOCAL_UPSCALER_NAME}` : generationStatus}</span>
                    <span className="font-mono">{enhancing ? enhanceProgress : progress}%</span>
                  </div>
                  <ProgressBar value={enhancing ? enhanceProgress : progress} label="Local image progress" />
                </div>
              )}
            </form>
          </Card>

          <Card title="Local video from AI keyframes" subtitle="A real WebM built entirely on this machine from locally rendered diffusion images.">
            <p className="mb-3 rounded border hairline bg-black/20 p-2.5 text-[11px] leading-relaxed text-[var(--muted)]">
              This is image-to-video animation, not text-to-video: no video diffusion weights are installed. The local model renders
              {(settings.video ?? DEFAULT_VIDEO_SETTINGS).keyframes} real keyframes from your request, then deterministic pan/zoom crossfades are muxed into VP8 WebM by the bundled stable-diffusion.cpp encoder. Keyframe renders always use at least four sampling steps for numerical stability.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="AI keyframes" hint={`${videoEngine?.limits.maxKeyframes ?? 4} maximum. Each keyframe is a separate local diffusion render that shares the selected seed.`}>
                <Select value={(settings.video ?? DEFAULT_VIDEO_SETTINGS).keyframes} onChange={(event) => updateVideo({ keyframes: Number(event.target.value) })} disabled={videoGenerating}>
                  {[2, 3, 4].map((value) => <option key={value} value={value}>{value} render{value === 1 ? "" : "s"}</option>)}
                </Select>
              </Field>
              <Field label="Motion" hint="Deterministic crop travel between keyframes. No motion model is involved.">
                <Select value={(settings.video ?? DEFAULT_VIDEO_SETTINGS).motion} onChange={(event) => updateVideo({ motion: event.target.value as VideoMotion })} disabled={videoGenerating}>
                  <option value="drift">Drift — gentle diagonal travel</option>
                  <option value="pan-right">Pan right</option>
                  <option value="pan-left">Pan left</option>
                  <option value="zoom-in">Zoom in</option>
                  <option value="zoom-out">Zoom out</option>
                  <option value="none">None — keyframe crossfades only</option>
                </Select>
              </Field>
              <Field label="Duration" hint={`${videoEngine?.limits.maxSeconds ?? 6} seconds maximum on this CPU.`}>
                <Select value={(settings.video ?? DEFAULT_VIDEO_SETTINGS).seconds} onChange={(event) => updateVideo({ seconds: Number(event.target.value) })} disabled={videoGenerating}>
                  {[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value} second{value === 1 ? "" : "s"}</option>)}
                </Select>
              </Field>
              <Field label="Frame rate" hint="Real interpolated frames, capped at the local encoder's tested range.">
                <Select value={(settings.video ?? DEFAULT_VIDEO_SETTINGS).fps} onChange={(event) => updateVideo({ fps: Number(event.target.value) })} disabled={videoGenerating}>
                  {[4, 6, 8, 10, 12].map((value) => <option key={value} value={value}>{value} fps</option>)}
                </Select>
              </Field>
            </div>
            <div className="mt-3">
              <Field label={`Motion strength: ${(settings.video ?? DEFAULT_VIDEO_SETTINGS).strength}%`} hint="Controls crop travel only. It does not change diffusion strength or add generated motion.">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={(settings.video ?? DEFAULT_VIDEO_SETTINGS).strength}
                  onChange={(event) => updateVideo({ strength: Number(event.target.value) })}
                  disabled={videoGenerating}
                  className="w-full accent-cyan-400"
                />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
              <Badge tone={videoEngine?.ready ? "green" : "amber"}>{videoEngine?.ready ? "encoder ready" : "encoder unavailable"}</Badge>
              <Badge>{(settings.video ?? DEFAULT_VIDEO_SETTINGS).fps * (settings.video ?? DEFAULT_VIDEO_SETTINGS).seconds} frames</Badge>
              <Badge>{videoEngine?.encoder ?? "stable-diffusion.cpp DGL"}</Badge>
            </div>
            <ErrorBox message={videoError} />
            <div className="mt-3 flex gap-2">
              <Button type="button" variant="primary" className="flex-1" onClick={() => void generateVideo()} disabled={videoGenerating}>
                {videoGenerating ? "Generating WebM…" : "Generate WebM"}
              </Button>
              {videoGenerating && <Button type="button" variant="danger" onClick={stopVideo}>Stop</Button>}
            </div>
            {(videoGenerating || videoProgress > 0) && (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between text-[11px] text-[var(--muted)]">
                  <span className="truncate pr-2">{videoActivities[videoActivities.length - 1]?.message ?? "Starting local video pipeline…"}</span>
                  <span className="font-mono">{videoProgress}%</span>
                </div>
                <ProgressBar value={videoProgress} label="Local video progress" />
              </div>
            )}
            {videoActivities.length > 0 && (
              <div className="mt-3 space-y-1 border-t border-[var(--border)] pt-3">
                {videoActivities.slice(-4).map((activity) => (
                  <div key={activity.id} className="rounded border hairline bg-black/20 px-2 py-1.5 text-[11px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={statusTone(activity.status)}>{activity.stage}</Badge>
                      <span className="text-slate-300">{activity.message}</span>
                    </div>
                    {activity.detail && <p className="mt-1 text-[var(--muted)]">{activity.detail}</p>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <PromptPreview
            prompt={prompt}
            enabled={settings.enhancePrompt !== false}
            onToggle={(value) => updateSettings({ enhancePrompt: value })}
            strengths={promptStrengths}
            weaknesses={promptIssues}
          />

          <PromptLab onUse={(value) => { setPrompt(value); setResearch(null); setLastDescription(null); setError(null); }} />

          <AssetManager
            assets={assets}
            busy={assetBusy}
            generating={generating}
            settings={settings.generation}
            onUpload={(file, kind) => void uploadAsset(file, kind)}
            onDelete={(id) => void deleteAsset(id)}
            onToggleReference={toggleReference}
            onSelectEdit={(id) => updateGeneration({ initImageId: id })}
            onSelectMask={(id) => updateGeneration({ maskImageId: id })}
            onChange={updateGeneration}
          />

          <Card title="Visual knowledge" subtitle={`${concepts.length} concepts · ${totalRules} structural rules. Rules you add here are compiled into the next prompt; nothing is retrained.`}>
            <form className="space-y-3" onSubmit={(event) => {
              event.preventDefault();
              if (!knowledgeRule.trim() || !knowledgeSubject.trim()) return;
              addKnowledgeRule(knowledgeSubject, knowledgeRule, knowledgeAvoid);
              setKnowledgeRule("");
            }}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Subject" hint="e.g. airplane, car, golden retriever">
                  <Input value={knowledgeSubject} onChange={(event) => setKnowledgeSubject(event.target.value)} placeholder="airplane" />
                </Field>
                <Field label="Rule type">
                  <Select value={knowledgeAvoid ? "avoid" : "must"} onChange={(event) => setKnowledgeAvoid(event.target.value === "avoid")}>
                    <option value="must">Must have / must be</option>
                    <option value="avoid">Avoid / exclude</option>
                  </Select>
                </Field>
              </div>
              <Field label="Rule" hint="Use plain visual language: 'engines under the wings' or 'no trees in the background'.">
                <Input value={knowledgeRule} onChange={(event) => setKnowledgeRule(event.target.value)} placeholder="pointed nose with visible landing gear" />
              </Field>
              <Button size="sm" variant="primary" type="submit" disabled={!knowledgeRule.trim() || !knowledgeSubject.trim()}>
                Feed knowledge to generator
              </Button>
            </form>
            {manualRules.length > 0 && (
              <div className="mt-3 space-y-1 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
                <p className="font-medium text-[var(--text)]">Rules you added</p>
                {manualRules.map((rule, index) => (
                  <p key={`${rule.subject}-${index}`} className="truncate">· {rule.subject}: {rule.note}</p>
                ))}
              </div>
            )}
          </Card>

          <Card title="Image datasets" subtitle="Load structured visual knowledge packs into the prompt compiler. All packs are local text data — no images are copied and no model is retrained.">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <Badge tone="cyan">{datasetStats?.packs ?? 0} packs</Badge>
              <Badge>{datasetStats?.concepts ?? 0} concepts</Badge>
              <Badge>{((datasetStats?.positiveRules ?? 0) + (datasetStats?.negativeRules ?? 0))} rules</Badge>
              <Badge>{concepts.length} loaded</Badge>
            </div>
            <div className="mt-3 space-y-2">
              {datasetPacks.map((pack) => (
                <div key={pack.id} className="flex flex-wrap items-start gap-2 rounded border hairline bg-black/20 p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-slate-200">{pack.name}</div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted)]">{pack.description}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge>{pack.concepts} concepts</Badge>
                      <Badge>{pack.positiveRules + pack.negativeRules} rules</Badge>
                      <Badge tone="green">{pack.license}</Badge>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void loadDataset(pack.id)} disabled={datasetBusy !== null || generating}>
                    {datasetBusy === pack.id ? "Loading…" : "Load"}
                  </Button>
                </div>
              ))}
              {!datasetPacks.length && <p className="text-xs text-[var(--muted)]">Loading local dataset index…</p>}
            </div>
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <div className="mono-label mb-1.5">Learn from your gallery</div>
              <p className="mb-2 text-[11px] leading-relaxed text-[var(--muted)]">
                Turns feedback on your own captioned generations into reusable structural rules for the matching subject.
              </p>
              <Button size="sm" variant="outline" onClick={learnFromGallery} disabled={history.length === 0}>Learn from gallery</Button>
            </div>
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <div className="mono-label mb-1.5">Import your own concept dataset (JSON)</div>
              <Textarea
                rows={3}
                value={datasetJson}
                onChange={(event) => setDatasetJson(event.target.value)}
                placeholder={'[{"name":"ocelot","category":"animal","attributes":["spotted coat"],"constraints":["four legs"],"negativeConstraints":["wheels"]}]'}
                maxLength={200000}
              />
              <Button size="sm" variant="primary" className="mt-2" onClick={() => void importDatasetText()} disabled={datasetBusy !== null}>Import concepts</Button>
            </div>
            {datasetMessage && <p className="mt-3 rounded border hairline bg-black/20 p-2 text-[11px] leading-relaxed text-cyan-300">{datasetMessage}</p>}
          </Card>

          <Card title="Visual research" subtitle="Optional, bounded lookup of openly licensed reference metadata. References are never used as generated output.">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => void runResearch(false)} disabled={researching || generating || prompt.trim().length < 3}>
                {researching ? "Researching…" : "Research references"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void runResearch(true)} disabled={researching || generating || prompt.trim().length < 3}>
                Force fresh lookup
              </Button>
            </div>
            <ErrorBox message={researchError} />
            <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
              Familiar subjects use stored visual knowledge. Unfamiliar subjects search Wikimedia Commons, keep source URLs and licenses,
              and extract short appearance phrases from descriptions. Search results are cached in this browser.
            </p>
          </Card>

          {settingsOpen && (
            <>
              <Card title="Canvas and output" subtitle="Aspect presets set real diffusion dimensions. Quality profiles set real steps, cache strategy, detail pass and restoration behavior.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Aspect" hint="Dimensions are applied to the engine, not just displayed. Custom keeps the width and height below.">
                    <Select value={settings.generation.aspect ?? "square"} onChange={(event) => applyAspect(event.target.value as ImageAspect)} disabled={generating}>
                      <option value="square">Square — 384 × 384</option>
                      <option value="portrait">Portrait — 320 × 384</option>
                      <option value="landscape">Landscape — 384 × 320</option>
                      <option value="ultrawide">Ultrawide — 448 × 256</option>
                      <option value="custom">Custom dimensions</option>
                    </Select>
                  </Field>
                  <Field label="Quality profile" hint="Simple size shortcut that sets real dimensions and steps. For the tested renderer defaults (including Fast LCM and sampler choice), use Quality preset below.">
                    <Select value={settings.generation.quality ?? "high"} onChange={(event) => applyQuality(event.target.value as ImageQuality)} disabled={generating}>
                      <option value="draft">Draft — 256 px, 8 steps</option>
                      <option value="standard">Standard — 320 px, 16 steps</option>
                      <option value="high">High — 384 px, 20 steps (default)</option>
                      <option value="ultra">Ultra — 512 px, 24 steps + 2× detail</option>
                    </Select>
                  </Field>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Images per run" hint={`${engine?.limits.maxBatch ?? 4} maximum on this machine.`}>
                    <Select value={settings.generation.batchCount ?? 1} onChange={(event) => updateGeneration({ batchCount: Number(event.target.value) })} disabled={generating}>
                      {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value} real render{value === 1 ? "" : "s"}</option>)}
                    </Select>
                  </Field>
                  <Field label="Queue" hint="One local render runs at a time. Identical in-flight requests are rejected.">
                    <Badge tone={engine?.queue?.active ? "amber" : "green"}>
                      {engine?.queue?.active ? `busy · ${engine.queue.waiting} waiting` : "idle"}
                    </Badge>
                  </Field>
                </div>
              </Card>

              <ModelPanel engine={engine} settings={settings.generation} onChange={updateGeneration} disabled={generating} />
              <ProControls settings={settings.generation} onChange={updateGeneration} disabled={generating} />

              <Card title="Image settings" subtitle="Detailed is the A/B-tested 384 px / 20-step default on full-precision SD 1.5 with a compact subject-first prompt. Auto uses Euler + Karras; people alone use Realistic Vision. Fast LCM uses installed fused LCM weights for a 6-step render.">
                <div className="space-y-3">
                <Field label="Quality preset" hint="Fast LCM is the quickest real diffusion render. Fast HD/Draft are quick SD 1.5 checks; Detailed is the tested default; Maximum adds a slow 2× detail pass.">
                  <Select
                    value={matchingPreset(settings.generation)}
                    onChange={(event) => {
                      const preset = QUALITY_PRESETS[event.target.value];
                      if (preset) updateGeneration(preset);
                    }}
                    disabled={generating}
                  >
                    <option value="lcmfast">Fast LCM — 384 px, 6 steps (quickest)</option>
                    <option value="fasthd">Fast HD — 256 px, 8 steps, quick check</option>
                    <option value="draft">Draft — 256 px, 8 steps</option>
                    <option value="balanced">Balanced — 320 px, 16 steps</option>
                    <option value="detailed">Detailed — 384 px, 20 steps (default)</option>
                    <option value="maximum">Maximum — 512 px, 24 steps + 2× detail</option>
                    <option value="custom">Custom</option>
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Width">
                    <Select value={settings.generation.width} onChange={(event) => updateGeneration({ width: Number(event.target.value) })} disabled={generating}>
                      {[256, 320, 384, 448, 512].map((value) => <option key={value} value={value}>{value} px</option>)}
                    </Select>
                  </Field>
                  <Field label="Height">
                    <Select value={settings.generation.height} onChange={(event) => updateGeneration({ height: Number(event.target.value) })} disabled={generating}>
                      {[256, 320, 384, 448, 512].map((value) => <option key={value} value={value}>{value} px</option>)}
                    </Select>
                  </Field>
                </div>
                <Field label={`Sampling steps: ${settings.generation.steps}`} hint="20 steps at 384 px is the colour-stable default. Fewer steps and spectrum cache produced muddy, unstable colours in local tests. Time scales with pixels × steps.">
                  <input type="range" min={1} max={engine?.limits.maxSteps ?? 30} value={settings.generation.steps} onChange={(event) => updateGeneration({ steps: Number(event.target.value) })} disabled={generating} className="w-full accent-cyan-400" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Guidance scale">
                    <Input type="number" min={0} max={20} step={0.5} value={settings.generation.guidance} onChange={(event) => updateGeneration({ guidance: Number(event.target.value) })} disabled={generating} />
                  </Field>
                  <Field label="Seed" hint="Blank means a different random image each time.">
                    <Input type="number" min={0} value={settings.generation.seed ?? ""} placeholder="random" onChange={(event) => updateGeneration({ seed: event.target.value === "" ? null : Number(event.target.value) })} disabled={generating} />
                  </Field>
                </div>
                <Field label="Style preset">
                  <Select value={settings.generation.style} onChange={(event) => updateGeneration({ style: event.target.value })} disabled={generating}>
                    <option value="auto">Auto</option>
                    {[...new Set(concepts.filter((concept) => concept.category === "style").map((concept) => concept.name))].map((style) => (
                      <option key={style} value={style}>{style}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Negative prompt">
                  <Textarea rows={2} value={settings.generation.negativePrompt} onChange={(event) => updateGeneration({ negativePrompt: event.target.value })} disabled={generating} maxLength={800} />
                </Field>
                <Field label="Maximum references">
                  <Select value={settings.maxReferences} onChange={(event) => updateSettings({ maxReferences: Number(event.target.value) })} disabled={generating}>
                    {[2, 4, 6, 8, 10].map((value) => <option key={value} value={value}>{value} references</option>)}
                  </Select>
                </Field>
                <Field label="Render speed" hint="Balanced (UCached 0.40) is the default: it was ~27% faster than no-cache with a small pixel delta and kept colours stable. Turbo/spectrum was fastest but caused artefacts at low steps; Quality is the slowest.">
                  <Select value={settings.generation.speed ?? "balanced"} onChange={(event) => updateGeneration({ speed: event.target.value as ImageGenerationSettings["speed"] })} disabled={generating}>
                    <option value="balanced">Balanced — tuned UCache (default)</option>
                    <option value="turbo">Turbo — spectrum predictor, fastest</option>
                    <option value="quality">Quality — full sampling, no cache, slowest</option>
                  </Select>
                </Field>
                <label className="flex items-start gap-2 rounded border hairline bg-black/20 p-3 text-xs text-slate-300">
                  <input type="checkbox" checked={settings.generation.autoEnhance === true} onChange={(event) => updateGeneration({ autoEnhance: event.target.checked })} disabled={generating} className="mt-0.5 accent-cyan-400" />
                  <span>Auto {LOCAL_UPSCALER_SCALE}× restore: after diffusion finishes, enhance the saved PNG with {LOCAL_UPSCALER_NAME} inside the same run. The final file is {settings.generation.width * LOCAL_UPSCALER_SCALE}×{settings.generation.height * LOCAL_UPSCALER_SCALE}; this adds restoration time after every image and keeps separate diffusion/final provenance.</span>
                </label>
                <label className="flex items-start gap-2 rounded border hairline bg-black/20 p-3 text-xs text-slate-300">
                  <input type="checkbox" checked={settings.generation.hires === true} onChange={(event) => updateGeneration({ hires: event.target.checked })} disabled={generating} className="mt-0.5 accent-cyan-400" />
                  <span>Detail pass (2×): a second diffusion pass at double resolution adds real detail, not just interpolation. Final PNG is 2× the selected size and takes roughly 2× longer. For offline 4× enhancement of an existing image, use Enhance below.</span>
                </label>
                <label className="flex items-start gap-2 rounded border hairline bg-black/20 p-3 text-xs text-slate-300">
                  <input type="checkbox" checked={settings.autoSaveKnowledge} onChange={(event) => updateSettings({ autoSaveKnowledge: event.target.checked })} className="mt-0.5 accent-cyan-400" />
                  <span>Save explained feedback as structured visual notes. No automatic model retraining is performed.</span>
                </label>
              </div>
              </Card>
            </>
          )}

          <Card title="Learning statistics" subtitle="Feedback is separated into preferences, visual facts, and individual corrections.">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded border hairline bg-black/20 p-2"><div className="font-mono text-lg text-cyan-300">{preferenceCount}</div><div className="mono-label">preferences</div></div>
              <div className="rounded border hairline bg-black/20 p-2"><div className="font-mono text-lg text-emerald-300">{factCount}</div><div className="mono-label">visual facts</div></div>
              <div className="rounded border hairline bg-black/20 p-2"><div className="font-mono text-lg text-amber-300">{correctionCount}</div><div className="mono-label">corrections</div></div>
            </div>
            <div className="mt-3">
              <div className="mono-label mb-1.5">Recurring mistakes</div>
              {mistakes.length ? (
                <ul className="space-y-1 text-xs text-slate-300">
                  {mistakes.map((mistake) => (
                    <li key={`${mistake.subject ?? "general"}:${mistake.note}`} className="flex items-start justify-between gap-2 rounded border hairline bg-black/20 px-2 py-1.5">
                      <span className="min-w-0">{mistake.subject ? <span className="text-slate-500">{mistake.subject}: </span> : null}{mistake.note}</span><Badge tone="amber">×{mistake.count}</Badge>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-[var(--muted)]">No repeated correction yet. Feedback will appear here after multiple similar notes.</p>}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Generated image" subtitle={current ? `${current.model} · ${new Date(current.createdAt).toLocaleString()} · ${formatDuration(current.durationMs)}` : "Your newest image appears here."}>
            {current?.imageUrl ? (
              <div className="space-y-4">
                <div className="overflow-hidden rounded border hairline bg-black/50">
                  {/* This is a same-origin route serving bytes produced by the local model. */}
                  <img src={`${current.imageUrl}`} alt={current.originalPrompt} className="mx-auto max-h-[560px] w-full object-contain" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="green">newly generated</Badge>
                  <Badge>{current.render?.final.width ?? current.settings.width}×{current.render?.final.height ?? current.settings.height}</Badge>
                  <Badge>{current.render?.diffusion?.steps ?? current.settings.steps} steps</Badge>
                  {current.render?.diffusion?.hires && <Badge tone="amber">2× detail pass</Badge>}
                  {current.render?.final.upscaler && <Badge tone="amber">{LOCAL_UPSCALER_SCALE}× {current.render.final.upscaler.name}</Badge>}
                  <Badge tone="cyan">{current.model}</Badge>
                  <a
                    href={`${current.imageUrl}?download=1`}
                    download={`davidai-${current.id}.png`}
                    className="focus-ring ml-auto rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-300 hover:bg-cyan-500/20"
                  >
                    Download PNG
                  </a>
                  <Button size="sm" variant="primary" onClick={() => setViewerOpen(true)}>View fullscreen</Button>
                  <Button size="sm" variant={galleryMeta.favorites.includes(current.id) ? "primary" : "outline"} onClick={() => toggleFavorite(current.id)}>
                    {galleryMeta.favorites.includes(current.id) ? "★ Favorite" : "☆ Favorite"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void enhanceImage(current)} disabled={generating || enhancing || !engine?.upscalerReady}>
                    {enhancing ? "Enhancing…" : "Enhance 4×"}
                  </Button>
                  {enhancing && <Button size="sm" variant="danger" onClick={stopEnhancement}>Stop enhancement</Button>}
                  <Button size="sm" variant="outline" onClick={() => makeVariation(current)} disabled={generating || enhancing}>Make variation</Button>
                  <Button size="sm" variant="ghost" onClick={() => void removeImage(current)} disabled={generating || enhancing}>Delete</Button>
                </div>
                <div className="rounded border hairline bg-black/20 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-1 rounded border hairline bg-black/30 p-0.5 text-[11px]">
                    {(["original", "enhanced", "final"] as const).map((view) => (
                      <button
                        key={view}
                        type="button"
                        onClick={() => setResultPromptView(view)}
                        className={`rounded px-2 py-1 capitalize ${resultPromptView === view ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500"}`}
                      >
                        {view}
                      </button>
                    ))}
                  </div>
                  <div className="mono-label mb-1">{resultPromptView === "final" ? "Final generation prompt" : resultPromptView === "enhanced" ? "Enhanced preview" : "Original request"}</div>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                    {resultPromptView === "final"
                      ? current.finalPrompt
                      : resultPromptView === "enhanced"
                        ? current.enhancedPrompt ?? "This image was saved before enhanced-prompt previews were available; its original and final prompts are preserved."
                        : current.originalPrompt}
                  </p>
                </div>
                <div className="rounded border hairline bg-black/20 p-3">
                  <div className="mono-label mb-2">Feedback and learning</div>
                  {feedbackNotice && <p className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200" role="status">{feedbackNotice}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" onClick={() => void submitFeedback("like")} disabled={generating}>Like</Button>
                    <Button size="sm" variant="danger" onClick={() => void submitFeedback("dislike")} disabled={generating}>Dislike</Button>
                  </div>
                  <Textarea
                    value={feedbackText}
                    onChange={(event) => setFeedbackText(event.target.value)}
                    placeholder="Explain what to change, e.g. 'ears too small' or 'I prefer softer lighting'"
                    rows={2}
                    maxLength={600}
                    className="mt-2"
                  />
                  {current.feedback.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {current.feedback.slice().reverse().map((item) => (
                        <div key={item.id} className="rounded border hairline bg-black/30 px-2.5 py-2 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={item.rating === "like" ? "green" : "red"}>{item.rating}</Badge>
                            {item.kinds.map((kind) => <Badge key={kind}>{kind}</Badge>)}
                          </div>
                          {item.correction && <p className="mt-1.5 text-slate-300">{item.correction}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState
                title="No image generated yet"
                description="Enter a visual request and click Generate image. The local engine will stream real denoising progress here."
                action={<Button variant="primary" onClick={() => void generate()} disabled={prompt.trim().length < 3 || !engineReady}>Generate image</Button>}
              />
            )}
          </Card>

          <Card title="Generated video" subtitle={currentVideo ? `${currentVideo.encoder} · ${new Date(currentVideo.createdAt).toLocaleString()} · ${formatDuration(currentVideo.durationMs)}` : "Your newest local WebM appears here."}>
            {currentVideo?.videoUrl ? (
              <div className="space-y-4">
                <div className="overflow-hidden rounded border hairline bg-black/50">
                  <video
                    src={currentVideo.videoUrl}
                    poster={currentVideo.posterUrl}
                    controls
                    preload="metadata"
                    className="mx-auto max-h-[480px] w-full bg-black object-contain"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="green">local WebM</Badge>
                  <Badge>{currentVideo.width}×{currentVideo.height}</Badge>
                  <Badge>{currentVideo.keyframeCount} AI keyframes</Badge>
                  <Badge>{currentVideo.frameCount} frames · {currentVideo.fps} fps</Badge>
                  <Badge tone="cyan">{formatBytes(currentVideo.bytes)}</Badge>
                  <Badge tone="amber">not text-to-video</Badge>
                  <a
                    href={`${currentVideo.videoUrl}?download=1`}
                    download={`davidai-${currentVideo.id}.webm`}
                    className="focus-ring ml-auto rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-300 hover:bg-cyan-500/20"
                  >
                    Download WebM
                  </a>
                  <Button size="sm" variant="danger" onClick={() => setVideoToDelete(currentVideo.id)}>Delete</Button>
                </div>
                <div className="rounded border hairline bg-black/20 p-3">
                  <div className="mono-label mb-1">Video request</div>
                  <p className="text-xs leading-relaxed text-slate-300">{currentVideo.originalPrompt}</p>
                  <div className="mono-label mt-3 mb-1">How this file was made</div>
                  <ul className="space-y-1 text-[11px] leading-relaxed text-[var(--muted)]">
                    {currentVideo.pipelineNotes.map((note) => <li key={note}>· {note}</li>)}
                  </ul>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No video generated yet"
                description="Use the same visual request with Generate WebM. The local pipeline will render real keyframes and save a playable VP8 WebM."
                action={<Button variant="primary" onClick={() => void generateVideo()} disabled={videoGenerating}>Generate WebM</Button>}
              />
            )}
          </Card>

          {current?.imageUrl && (
            <EvaluationPanel
              image={current}
              evaluation={currentEvaluation}
              suggestions={promptWeaknesses(current.originalPrompt, current.settings)}
              onSave={evaluateCurrent}
            />
          )}

          <Card title="Live image activity" subtitle="Only real operations are reported: understanding, identifying, searching, analyzing, knowledge checks, prompt building, local generation, evaluation, and saving.">
            {activities.length === 0 ? (
              <EmptyState title="Waiting for a run" description="Start a generation to inspect every step in real time." />
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {activities.map((activity) => (
                  <div key={activity.id} className="rounded border hairline bg-black/20 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone(activity.status)}>{activity.stage}</Badge>
                      <span className="text-xs text-slate-200">{activity.message}</span>
                      <span className="ml-auto font-mono text-[10px] text-slate-600">{new Date(activity.at).toLocaleTimeString()}</span>
                    </div>
                    {activity.detail && <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">{activity.detail}</p>}
                    {typeof activity.progress === "number" && (activity.stage === "generating" || activity.stage === "enhancing") && (
                      <div className="mt-2"><ProgressBar value={activity.progress} label={activity.stage === "enhancing" ? "Enhancement progress" : "Denoising progress"} /></div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <GenerationDetails activities={activities} image={current} displayModel={displayModel} />

          <Card title="Visual research panel" subtitle="Search queries, reference thumbnails with citations, extracted characteristics, and the final generation prompt.">
            {research ? (
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded border hairline bg-black/20 p-3">
                    <div className="mono-label">Search query</div>
                    <p className="mt-1 text-xs text-slate-200">{research.searches.join(" · ") || "none"}</p>
                  </div>
                  <div className="rounded border hairline bg-black/20 p-3">
                    <div className="mono-label">Result</div>
                    <p className="mt-1 text-xs text-slate-200">
                      {research.skipped ? `Skipped — ${research.reason ?? "knowledge sufficient"}` : `${research.references.length} references · ${research.characteristics.length} characteristics`}
                    </p>
                  </div>
                </div>

                {research.references.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {research.references.map((reference) => (
                      <div key={reference.id} className="overflow-hidden rounded border hairline bg-black/25">
                        <img src={reference.thumbnailUrl} alt={reference.title} className="h-28 w-full bg-black object-cover" />
                        <div className="p-2.5">
                          <div className="line-clamp-2 text-xs text-slate-200">{reference.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge tone="green">{reference.license}</Badge>
                            <a href={reference.pageUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-cyan-400 hover:underline">source ↗</a>
                          </div>
                          {reference.characteristics.length > 0 && (
                            <p className="mt-1.5 line-clamp-2 text-[11px] text-[var(--muted)]">{reference.characteristics.join(" · ")}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {research.characteristics.length > 0 && (
                  <div>
                    <div className="mono-label mb-1.5">Extracted visual characteristics</div>
                    <div className="flex flex-wrap gap-1.5">
                      {research.characteristics.map((characteristic) => <Badge key={characteristic} tone="cyan">{characteristic}</Badge>)}
                    </div>
                  </div>
                )}

                <div className="rounded border hairline bg-black/20 p-3">
                  <div className="mono-label">Final generation prompt</div>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">{displayDescription?.finalPrompt ?? "Enter a request to build a prompt."}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                  <Badge>{displayModel}</Badge>
                  <Badge tone={generating ? "cyan" : current ? "green" : "neutral"}>{generationStatus}</Badge>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No visual research yet"
                description="Run optional research to inspect licensed references and extracted appearance facts before generation."
                action={<Button size="sm" variant="primary" onClick={() => void runResearch(false)} disabled={prompt.trim().length < 3}>Research references</Button>}
              />
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-4" title="Gallery and history" subtitle="Original prompt, final prompt, enhanced preview, model, date, research summary, settings, feedback, favorites, collections and evaluations are preserved locally.">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <p className="text-xs text-[var(--muted)]">
            {galleryImages.length} of {history.length} saved image{history.length === 1 ? "" : "s"}. Select one to reopen it, compare it, or create a variation.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={galleryQuery}
              onChange={(event) => setGalleryQuery(event.target.value)}
              placeholder="Search prompts, models…"
              className="w-52"
            />
            <Button size="sm" variant={galleryFilter === "favorites" ? "primary" : "outline"} onClick={() => setGalleryFilter(galleryFilter === "favorites" ? "all" : "favorites")}>
              ★ Favorites ({galleryMeta.favorites.length})
            </Button>
            <Select value={galleryCollection} onChange={(event) => setGalleryCollection(event.target.value)} className="w-44">
              <option value="all">All collections</option>
              {galleryMeta.collections.map((collection) => (
                <option key={collection.id} value={collection.id}>{collection.name} ({collection.imageIds.length})</option>
              ))}
            </Select>
            <Input value={newCollection} onChange={(event) => setNewCollection(event.target.value)} placeholder="New collection" className="w-36" />
            <Button size="sm" variant="outline" onClick={() => {
              const id = createCollection(newCollection);
              if (id) setGalleryCollection(id);
              setNewCollection("");
            }} disabled={!newCollection.trim()}>Create</Button>
            <Button size="sm" variant="outline" onClick={downloadBundle}>Export JSON</Button>
            <input
              ref={bundleInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importBundleFile(file);
                event.target.value = "";
              }}
            />
            <Button size="sm" variant="outline" onClick={() => bundleInputRef.current?.click()}>Import JSON</Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmClear(true)} disabled={!history.length}>Clear history</Button>
          </div>
        </div>
        {bundleMessage && <p className="mb-3 rounded border hairline bg-black/20 p-2 text-[11px] text-cyan-300">{bundleMessage}</p>}
        {galleryMeta.collections.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {galleryMeta.collections.map((collection) => (
              <span key={collection.id} className="inline-flex items-center gap-1 rounded border hairline bg-black/20 px-2 py-1 text-[11px] text-slate-300">
                {collection.name}
                <button type="button" onClick={() => {
                  deleteCollection(collection.id);
                  if (galleryCollection === collection.id) setGalleryCollection("all");
                }} className="text-slate-600 hover:text-red-300" aria-label={`Delete collection ${collection.name}`}>×</button>
              </span>
            ))}
          </div>
        )}

        {compareImages.length > 0 && (
          <div className="mb-3 rounded border border-cyan-500/30 bg-cyan-500/5 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="mono-label text-cyan-300">Compare up to 3 renders</span>
              <Button size="sm" variant="ghost" onClick={() => setCompareIds([])}>Clear comparison</Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {compareImages.map((image) => (
                <div key={image.id} className="overflow-hidden rounded border hairline bg-black/30">
                  <img src={image.imageUrl ?? ""} alt={image.originalPrompt} className="h-36 w-full object-contain" />
                  <div className="p-2">
                    <p className="line-clamp-2 text-[11px] text-slate-300">{image.originalPrompt}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge>{image.settings.width}×{image.settings.height}</Badge>
                      <Badge>{image.settings.steps} steps</Badge>
                      {image.enhancedPrompt && <Badge tone="cyan">enhanced</Badge>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {galleryImages.length === 0 ? (
          <EmptyState title="No matching images" description="Try a different search, clear the favorite or collection filter, or generate a new image." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {galleryImages.map((image) => {
              const selected = current?.id === image.id;
              const favorite = galleryMeta.favorites.includes(image.id);
              const comparing = compareIds.includes(image.id);
              return (
                <div key={image.id} className={`overflow-hidden rounded border ${selected ? "border-cyan-500/50" : "hairline"} bg-black/25`}>
                  <button type="button" onClick={() => openImage(image)} className="block w-full text-left" aria-label={`Open image: ${image.originalPrompt}`}>
                    {image.imageUrl ? (
                      <img src={image.imageUrl} alt={image.originalPrompt} className="h-32 w-full bg-black object-cover" />
                    ) : <div className="flex h-32 items-center justify-center text-xs text-red-300">failed</div>}
                    <div className="p-2.5">
                      <div className="line-clamp-2 text-xs text-slate-200">{image.originalPrompt}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <Badge>{image.settings.width}×{image.settings.height}</Badge>
                        <Badge tone={image.researchSummary.skipped ? "neutral" : "cyan"}>
                          {image.researchSummary.skipped ? "known" : `${image.researchSummary.references} refs`}
                        </Badge>
                        {image.edit && <Badge tone="amber">{image.edit.mode}</Badge>}
                        {image.feedback.length > 0 && <Badge tone={image.feedback.some((item) => item.rating === "like") ? "green" : "red"}>{image.feedback.length} feedback</Badge>}
                      </div>
                      <div className="mt-1.5 font-mono text-[10px] text-slate-600">{new Date(image.createdAt).toLocaleString()}</div>
                    </div>
                  </button>
                  <div className="space-y-1.5 border-t hairline px-2 py-1.5">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="flex-1" onClick={() => openImage(image)}>Open</Button>
                      <Button size="sm" variant="ghost" className="flex-1" onClick={() => {
                        openImage(image);
                        setViewerOpen(true);
                      }}>View</Button>
                      <Button size="sm" variant={favorite ? "primary" : "ghost"} className="flex-1" onClick={() => toggleFavorite(image.id)}>{favorite ? "★" : "☆"}</Button>
                      <Button
                        size="sm"
                        variant={comparing ? "primary" : "ghost"}
                        className="flex-1"
                        onClick={() => setCompareIds((previous) => previous.includes(image.id)
                          ? previous.filter((value) => value !== image.id)
                          : previous.length >= 3 ? [...previous.slice(1), image.id] : [...previous, image.id])}
                      >Compare</Button>
                    </div>
                    <Select
                      value=""
                      onChange={(event) => {
                        if (event.target.value) toggleCollectionImage(event.target.value, image.id);
                      }}
                      className="h-7 py-0 text-[11px]"
                    >
                      <option value="">Add to collection…</option>
                      {galleryMeta.collections.map((collection) => (
                        <option key={collection.id} value={collection.id}>{collection.name}</option>
                      ))}
                    </Select>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="flex-1" onClick={() => makeVariation(image)} disabled={generating || enhancing}>Variation</Button>
                      <Button size="sm" variant="ghost" className="flex-1" onClick={() => void enhanceImage(image)} disabled={generating || enhancing || !engine?.upscalerReady || !image.imageUrl}>Enhance</Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="mt-4" title="Video history" subtitle="Every WebM keeps its source keyframe IDs, exact settings, encoder notes, and prompt provenance in the exported workspace bundle.">
        {videos.length === 0 ? (
          <EmptyState title="No videos saved" description="Generate a WebM above to create a real local animation from AI keyframes." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((video) => (
              <div key={video.id} className={`overflow-hidden rounded border ${currentVideo?.id === video.id ? "border-cyan-500/50" : "hairline"} bg-black/25`}>
                <video src={video.videoUrl} poster={video.posterUrl} controls preload="metadata" className="h-36 w-full bg-black object-contain" />
                <div className="p-2.5">
                  <p className="line-clamp-2 text-xs text-slate-200">{video.originalPrompt}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Badge>{video.keyframeCount} keyframes</Badge>
                    <Badge>{video.frameCount} frames</Badge>
                    <Badge tone="cyan">{formatBytes(video.bytes)}</Badge>
                  </div>
                  <div className="mt-1.5 font-mono text-[10px] text-slate-600">{new Date(video.createdAt).toLocaleString()}</div>
                </div>
                <div className="flex gap-1 border-t hairline px-2 py-1.5">
                  <Button size="sm" variant="ghost" className="flex-1" onClick={() => setCurrentVideo(video)}>Open</Button>
                  <a
                    href={`${video.videoUrl}?download=1`}
                    download={`davidai-${video.id}.webm`}
                    className="focus-ring flex-1 rounded px-2 py-1.5 text-center text-xs text-cyan-300 hover:bg-cyan-500/10"
                  >
                    Download
                  </a>
                  <Button size="sm" variant="danger" className="flex-1" onClick={() => setVideoToDelete(video.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {viewerOpen && current?.imageUrl && <ImageViewer image={current} onClose={() => setViewerOpen(false)} />}

      <ConfirmDialog
        open={confirmClear}
        title="Clear image history?"
        description="This removes all saved image metadata in this browser and deletes the generated PNG files from local disk. Feedback and visual knowledge notes attached to those images are removed too."
        confirmLabel="Clear everything"
        danger
        onConfirm={clearAll}
        onCancel={() => setConfirmClear(false)}
      />

      <ConfirmDialog
        open={videoToDelete !== null}
        title="Delete generated video?"
        description="This removes the WebM, poster, metadata, and source keyframes created for this video from local disk and from this browser's history."
        confirmLabel="Delete video"
        danger
        onConfirm={() => { if (videoToDelete) void removeVideo(videoToDelete); }}
        onCancel={() => setVideoToDelete(null)}
      />
    </>
  );
}
