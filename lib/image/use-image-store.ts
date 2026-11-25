"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { makeId, readLocal, writeLocal } from "../storage";
import { DEFAULT_IMAGE_SETTINGS } from "./defaults";
import { normalizeVideo, normalizeVideoSettings } from "./video-settings";
import type {
  GeneratedImage,
  GeneratedVideo,
  ImageCollection,
  ImageEvaluation,
  ImageFeedback,
  ImageExportBundle,
  ImageAspect,
  ImageEditMode,
  ImageGalleryMeta,
  ImageModelId,
  ImageOutpaintDirection,
  ImageQuality,
  ImageSettings,
  VisualConcept,
} from "./types";
import {
  classifyFeedback,
  deriveCorrection,
  deriveStructuralCorrection,
  learnFromGallery,
  normalizeConcept,
  recurringMistakes,
  seedConcepts,
  upsertConcept,
} from "./visual-knowledge";

export { DEFAULT_IMAGE_SETTINGS } from "./defaults";

const EMPTY_GALLERY_META: ImageGalleryMeta = { favorites: [], collections: [], evaluations: [], notes: {} };

function normalizeImage(value: unknown): GeneratedImage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<GeneratedImage>;
  if (typeof raw.id !== "string" || typeof raw.originalPrompt !== "string") return null;
  const rawSettings = raw.settings as Partial<GeneratedImage["settings"]> | undefined;
  const settings: GeneratedImage["settings"] = {
    ...DEFAULT_IMAGE_SETTINGS.generation,
    width: Number(rawSettings?.width) || 512,
    height: Number(rawSettings?.height) || 512,
    steps: Number(rawSettings?.steps) || 20,
    guidance: Number(rawSettings?.guidance) || 7,
    seed: typeof rawSettings?.seed === "number" ? rawSettings.seed : null,
    negativePrompt: typeof rawSettings?.negativePrompt === "string" ? rawSettings.negativePrompt : "",
    style: typeof rawSettings?.style === "string" ? rawSettings.style : "auto",
    strength: Number(rawSettings?.strength) || 0.55,
    hires: rawSettings?.hires === true,
    speed: rawSettings?.speed === "quality" || rawSettings?.speed === "turbo" ? rawSettings.speed : "balanced",
    autoEnhance: rawSettings?.autoEnhance === true,
    quality: rawSettings?.quality === "draft" || rawSettings?.quality === "standard" || rawSettings?.quality === "high" || rawSettings?.quality === "ultra"
      ? rawSettings.quality
      : "standard",
    aspect: rawSettings?.aspect === "square" || rawSettings?.aspect === "portrait" || rawSettings?.aspect === "landscape" || rawSettings?.aspect === "ultrawide" || rawSettings?.aspect === "custom"
      ? rawSettings.aspect
      : "custom",
    batchCount: Number(rawSettings?.batchCount) || 1,
    modelId: rawSettings?.modelId === "sd15-f16" || rawSettings?.modelId === "sd15-q4" || rawSettings?.modelId === "realistic-v6" || rawSettings?.modelId === "dreamshaper-lcm"
      ? rawSettings.modelId
      : "auto",
    sampler: rawSettings?.sampler ?? "auto",
    scheduler: rawSettings?.scheduler ?? "auto",
    editMode: rawSettings?.editMode === "img2img" || rawSettings?.editMode === "mask" || rawSettings?.editMode === "outpaint" || rawSettings?.editMode === "remove" || rawSettings?.editMode === "background"
      ? rawSettings.editMode
      : "text",
    referenceIds: Array.isArray(rawSettings?.referenceIds) ? rawSettings.referenceIds.filter((item): item is string => typeof item === "string") : [],
  };
  return {
    id: raw.id.slice(0, 120),
    originalPrompt: raw.originalPrompt.slice(0, 2000),
    finalPrompt: typeof raw.finalPrompt === "string" ? raw.finalPrompt.slice(0, 4000) : raw.originalPrompt.slice(0, 2000),
    negativePrompt: typeof raw.negativePrompt === "string" ? raw.negativePrompt.slice(0, 800) : "",
    model: typeof raw.model === "string" ? raw.model.slice(0, 160) : "unknown",
    settings,
    status: raw.status === "failed" ? "failed" : "complete",
    imageUrl: typeof raw.imageUrl === "string" && raw.imageUrl.startsWith("/api/image/generated/") ? raw.imageUrl : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    durationMs: Number(raw.durationMs) || 0,
    researchSummary: {
      skipped: Boolean(raw.researchSummary?.skipped),
      reason: typeof raw.researchSummary?.reason === "string" ? raw.researchSummary.reason : undefined,
      subjects: Array.isArray(raw.researchSummary?.subjects) ? raw.researchSummary.subjects.filter((item): item is string => typeof item === "string").slice(0, 12) : [],
      references: Number(raw.researchSummary?.references) || 0,
      characteristics: Array.isArray(raw.researchSummary?.characteristics) ? raw.researchSummary.characteristics.filter((item): item is string => typeof item === "string").slice(0, 24) : [],
      queries: Array.isArray(raw.researchSummary?.queries) ? raw.researchSummary.queries.filter((item): item is string => typeof item === "string").slice(0, 8) : [],
    },
    feedback: Array.isArray(raw.feedback)
      ? raw.feedback.flatMap((item): ImageFeedback[] => {
        if (!item || typeof item.rating !== "string") return [];
        return [{
          id: typeof item.id === "string" ? item.id : makeId(),
          rating: item.rating === "dislike" ? "dislike" : "like",
          correction: typeof item.correction === "string" ? item.correction.slice(0, 600) : "",
          kinds: Array.isArray(item.kinds) ? item.kinds.filter((kind): kind is ImageFeedback["kinds"][number] => ["preference", "visual-fact", "correction"].includes(kind)) : [],
          createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        }];
      }).slice(0, 20)
      : [],
    error: typeof raw.error === "string" ? raw.error.slice(0, 600) : undefined,
    upscaleSourceId: typeof raw.upscaleSourceId === "string" ? raw.upscaleSourceId.slice(0, 120) : undefined,
    render: raw.render ? (raw.render as GeneratedImage["render"]) : undefined,
    pipelineNotes: Array.isArray(raw.pipelineNotes) ? raw.pipelineNotes.filter((item): item is string => typeof item === "string").slice(0, 20) : undefined,
    enhancedPrompt: typeof raw.enhancedPrompt === "string" ? raw.enhancedPrompt.slice(0, 1200) : undefined,
    edit: raw.edit && typeof raw.edit.mode === "string" ? {
      mode: raw.edit.mode,
      sourceId: raw.edit.sourceId,
      maskId: raw.edit.maskId,
      strength: Number(raw.edit.strength) || 0.55,
      note: typeof raw.edit.note === "string" ? raw.edit.note.slice(0, 500) : "",
    } : undefined,
    batchIndex: Number(raw.batchIndex) || undefined,
    batchTotal: Number(raw.batchTotal) || undefined,
  };
}

function normalizeSettings(value: unknown): ImageSettings {
  const raw = value && typeof value === "object" ? value as Partial<ImageSettings> : {};
  const gen = raw.generation ?? DEFAULT_IMAGE_SETTINGS.generation;
  const numeric = (input: unknown, fallback: number) => {
    if (typeof input === "number") return Number.isFinite(input) ? input : fallback;
    if (typeof input === "string" && input.trim()) {
      const parsed = Number(input);
      return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
  };
  const clamp = (input: unknown, min: number, max: number, fallback: number) =>
    Math.max(min, Math.min(max, Math.round(numeric(input, fallback))));
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : fallback;
  const control = (value: unknown): string => typeof value === "string" ? value.slice(0, 80) : "";
  // Migrate both superseded untouched defaults: the original 256px High
  // setting and the brief 512px/8-step turbo default. A manual sampler,
  // scheduler, or non-square canvas is a deliberate choice and is preserved.
  const autoControls = (!gen.sampler || gen.sampler === "auto") && (!gen.scheduler || gen.scheduler === "auto");
  const oldBlobDefault = gen.quality === "high" && gen.width === 256 && gen.height === 256
    && (!gen.steps || gen.steps === 16 || gen.steps === 24);
  const oldTurboDefault = gen.quality === "high" && gen.width === 512 && gen.height === 512
    && gen.steps === 8 && gen.speed === "turbo";
  const migrateDefault = autoControls && (oldBlobDefault || oldTurboDefault);
  return {
    researchEnabled: typeof raw.researchEnabled === "boolean" ? raw.researchEnabled : true,
    forceResearch: typeof raw.forceResearch === "boolean" ? raw.forceResearch : false,
    maxReferences: clamp(raw.maxReferences, 1, 10, 6),
    autoSaveKnowledge: typeof raw.autoSaveKnowledge === "boolean" ? raw.autoSaveKnowledge : true,
    enhancePrompt: raw.enhancePrompt !== false,
    video: normalizeVideoSettings(raw.video),
    generation: {
      width: migrateDefault ? 384 : clamp(gen.width, 256, 512, 256),
      height: migrateDefault ? 384 : clamp(gen.height, 256, 512, 256),
      steps: migrateDefault ? 20 : clamp(gen.steps, 1, 30, 16),
      guidance: Math.max(0, Math.min(20, numeric(gen.guidance, 7))),
      seed: typeof gen.seed === "number" && Number.isFinite(gen.seed) ? Math.max(0, Math.floor(gen.seed)) : null,
      negativePrompt: gen.negativePrompt === "blurry, low quality, distorted, watermark, text, extra limbs, deformed anatomy, malformed hands"
        ? DEFAULT_IMAGE_SETTINGS.generation.negativePrompt
        : typeof gen.negativePrompt === "string" ? gen.negativePrompt.slice(0, 800) : DEFAULT_IMAGE_SETTINGS.generation.negativePrompt,
      style: typeof gen.style === "string" ? gen.style.slice(0, 80) : "photorealistic",
      strength: Math.max(0.05, Math.min(1, numeric(gen.strength, 0.55))),
      hires: gen.hires === true,
      speed: migrateDefault ? "balanced" : pick(gen.speed, ["quality", "balanced", "turbo"] as const, "balanced"),
      autoEnhance: migrateDefault ? false : gen.autoEnhance === true,
      quality: pick<ImageQuality>(gen.quality, ["draft", "standard", "high", "ultra"] as const, "high"),
      aspect: pick<ImageAspect>(gen.aspect, ["square", "portrait", "landscape", "ultrawide", "custom"] as const, "square"),
      lighting: control(gen.lighting),
      camera: control(gen.camera),
      perspective: control(gen.perspective),
      composition: control(gen.composition),
      colorPalette: control(gen.colorPalette),
      depthOfField: control(gen.depthOfField),
      detailLevel: control(gen.detailLevel),
      atmosphere: control(gen.atmosphere),
      weather: control(gen.weather),
      timeOfDay: control(gen.timeOfDay),
      texture: control(gen.texture),
      realism: control(gen.realism),
      batchCount: clamp(gen.batchCount, 1, 4, 1),
      modelId: pick<ImageModelId>(gen.modelId, ["auto", "sd15-f16", "sd15-q4", "realistic-v6", "dreamshaper-lcm"] as const, "auto"),
      sampler: control(gen.sampler) || "auto",
      scheduler: control(gen.scheduler) || "auto",
      editMode: pick<ImageEditMode>(gen.editMode, ["text", "img2img", "mask", "outpaint", "remove", "background"] as const, "text"),
      initImageId: control(gen.initImageId) || undefined,
      maskImageId: control(gen.maskImageId) || undefined,
      referenceIds: Array.isArray(gen.referenceIds) ? gen.referenceIds.filter((item): item is string => typeof item === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(item)).slice(0, 6) : [],
      outpaintDirection: pick<ImageOutpaintDirection>(gen.outpaintDirection, ["left", "right", "top", "bottom", "all"] as const, "all"),
    },
  };
}

function normalizeGalleryMeta(value: unknown): ImageGalleryMeta {
  const raw = value && typeof value === "object" ? value as Partial<ImageGalleryMeta> : {};
  const idList = (items: unknown): string[] => Array.isArray(items)
    ? items.filter((item): item is string => typeof item === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(item)).slice(0, 200)
    : [];
  const collections: ImageCollection[] = Array.isArray(raw.collections)
    ? raw.collections.flatMap((item): ImageCollection[] => {
      if (!item || typeof item.name !== "string" || !item.name.trim()) return [];
      const now = new Date().toISOString();
      return [{
        id: typeof item.id === "string" ? item.id : `collection:${makeId()}`,
        name: item.name.slice(0, 80),
        description: typeof item.description === "string" ? item.description.slice(0, 300) : "",
        imageIds: idList(item.imageIds),
        createdAt: typeof item.createdAt === "string" ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : now,
      }];
    }).slice(0, 60)
    : [];
  const evaluations: ImageEvaluation[] = Array.isArray(raw.evaluations)
    ? raw.evaluations.flatMap((item): ImageEvaluation[] => {
      if (!item || typeof item.imageId !== "string") return [];
      const score = (value: unknown): number => Number.isFinite(Number(value)) ? Math.max(0, Math.min(5, Math.round(Number(value)))) : 0;
      const now = new Date().toISOString();
      return [{
        id: typeof item.id === "string" ? item.id : `eval:${makeId()}`,
        imageId: item.imageId.slice(0, 120),
        quality: score(item.quality),
        promptAccuracy: score(item.promptAccuracy),
        realism: score(item.realism),
        styleAccuracy: score(item.styleAccuracy),
        weaknesses: Array.isArray(item.weaknesses) ? item.weaknesses.filter((entry): entry is string => typeof entry === "string").slice(0, 12) : [],
        note: typeof item.note === "string" ? item.note.slice(0, 800) : "",
        createdAt: typeof item.createdAt === "string" ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : now,
      }];
    }).slice(0, 200)
    : [];
  const notes: Record<string, string> = {};
  if (raw.notes && typeof raw.notes === "object") {
    for (const [key, value] of Object.entries(raw.notes)) {
      if (typeof value === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(key)) notes[key] = value.slice(0, 800);
    }
  }
  return { favorites: idList(raw.favorites), collections, evaluations, notes };
}

export function useImageStore() {
  const [hydrated, setHydrated] = useState(false);
  const [concepts, setConcepts] = useState<VisualConcept[]>(() => seedConcepts());
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [videos, setVideos] = useState<GeneratedVideo[]>([]);
  const [settings, setSettings] = useState<ImageSettings>(DEFAULT_IMAGE_SETTINGS);
  const [galleryMeta, setGalleryMeta] = useState<ImageGalleryMeta>(EMPTY_GALLERY_META);

  useEffect(() => {
    const savedConcepts = readLocal<VisualConcept[]>("visualConcepts", []);
    const valid = Array.isArray(savedConcepts) ? savedConcepts.flatMap((item) => {
      const normalized = normalizeConcept(item);
      return normalized ? [normalized] : [];
    }) : [];
    const merged = [...valid];
    for (const seed of seedConcepts()) {
      if (!merged.some((concept) => concept.id === seed.id || concept.name.toLowerCase() === seed.name.toLowerCase())) merged.push(seed);
    }
    const savedHistory = readLocal<GeneratedImage[]>("imageHistory", []);
    const historyValue = Array.isArray(savedHistory) ? savedHistory.flatMap((item) => {
      const normalized = normalizeImage(item);
      return normalized ? [normalized] : [];
    }).slice(0, 80) : [];
    const savedVideos = readLocal<GeneratedVideo[]>("videoHistory", []);
    const videoValue = Array.isArray(savedVideos) ? savedVideos.flatMap((item) => {
      const normalized = normalizeVideo(item);
      return normalized ? [normalized] : [];
    }).slice(0, 40) : [];
    setConcepts(merged);
    setHistory(historyValue);
    setVideos(videoValue);
    setGalleryMeta(normalizeGalleryMeta(readLocal<ImageGalleryMeta>("imageGalleryMeta", EMPTY_GALLERY_META)));
    const normalizedSettings = normalizeSettings(readLocal<ImageSettings>("imageSettings", DEFAULT_IMAGE_SETTINGS));
    // One-time upgrade: older saves predate the fast-restore pipeline and would
    // otherwise keep the slow 384px/20-step settings forever. Preserve research
    // preferences, but move every existing install onto the measured-fast path.
    if (!readLocal<boolean>("imageSettingsV2", false)) {
      normalizedSettings.generation = { ...DEFAULT_IMAGE_SETTINGS.generation };
      writeLocal("imageSettingsV2", true);
    }
    setSettings(normalizedSettings);
    setHydrated(true);
  }, []);

  useEffect(() => { if (hydrated) writeLocal("visualConcepts", concepts.slice(0, 400)); }, [concepts, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("imageHistory", history.slice(0, 80)); }, [history, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("videoHistory", videos.slice(0, 40)); }, [videos, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("imageSettings", settings); }, [settings, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("imageGalleryMeta", galleryMeta); }, [galleryMeta, hydrated]);

  const addConcepts = useCallback((incoming: VisualConcept[]) => {
    if (!incoming.length) return;
    setConcepts((prev) => incoming.reduce((list, concept) => upsertConcept(list, concept), prev).slice(0, 400));
  }, []);

  const saveImage = useCallback((image: GeneratedImage) => {
    setHistory((prev) => [image, ...prev.filter((item) => item.id !== image.id)].slice(0, 80));
  }, []);

  const saveVideo = useCallback((video: GeneratedVideo) => {
    setVideos((prev) => [video, ...prev.filter((item) => item.id !== video.id)].slice(0, 40));
  }, []);

  const deleteVideo = useCallback((id: string) => {
    setVideos((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearVideos = useCallback(() => setVideos([]), []);

  const deleteImage = useCallback((id: string) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));
    setConcepts((prev) => prev.map((concept) => ({
      ...concept,
      feedbackNotes: concept.feedbackNotes.filter((note) => note.imageId !== id),
    })));
    setGalleryMeta((prev) => {
      const notes = { ...prev.notes };
      delete notes[id];
      return {
        favorites: prev.favorites.filter((value) => value !== id),
        collections: prev.collections.map((collection) => ({ ...collection, imageIds: collection.imageIds.filter((value) => value !== id) })),
        evaluations: prev.evaluations.filter((item) => item.imageId !== id),
        notes,
      };
    });
  }, []);

  const clearHistory = useCallback(() => {
    const removedIds = new Set(history.map((item) => item.id));
    setHistory([]);
    setConcepts((prev) => prev.map((concept) => ({
      ...concept,
      feedbackNotes: concept.feedbackNotes.filter((note) => !note.imageId || !removedIds.has(note.imageId)),
    })));
    setGalleryMeta((prev) => ({
      favorites: [],
      collections: prev.collections.map((collection) => ({ ...collection, imageIds: [] })),
      evaluations: [],
      notes: {},
    }));
  }, [history]);

  const updateSettings = useCallback((patch: Partial<ImageSettings>) => {
    setSettings((prev) => normalizeSettings({ ...prev, ...patch, generation: { ...prev.generation, ...(patch.generation ?? {}) } }));
  }, []);

  const applyFeedback = useCallback((imageId: string, feedback: ImageFeedback) => {
    const image = history.find((item) => item.id === imageId);
    if (!image) return;
    setHistory((prev) => prev.map((item) => item.id === imageId
      ? { ...item, feedback: [...item.feedback.filter((entry) => entry.id !== feedback.id), feedback].slice(-20) }
      : item));
    if (!feedback.correction.trim() || !settings.autoSaveKnowledge) return;
    const kinds = feedback.kinds.length ? feedback.kinds : classifyFeedback(feedback.correction);
    const noteKind = (kinds.includes("correction") ? "correction" : kinds.includes("preference") ? "preference" : "visual-fact") as VisualConcept["feedbackNotes"][number]["kind"];
    setConcepts((prev) => {
      const subjects = image.researchSummary.subjects.map((name) => name.toLowerCase());
      if (!subjects.length) return prev;
      // A correction is stored as a rule only on the subject it actually
      // describes. Evaluating the rule per concept prevents a plane complaint
      // such as "flat nose" from becoming a tiger rule.
      return prev.map((concept) => {
        if (!subjects.includes(concept.name.toLowerCase())) return concept;
        const structural = deriveStructuralCorrection(feedback.correction, concept);
        const note = {
          id: structural ? feedback.id : `${feedback.id}:${concept.id}`,
          kind: structural ? noteKind : "visual-fact",
          note: structural ? deriveCorrection(feedback.correction, concept.name) : feedback.correction.slice(0, 240),
          subject: concept.name,
          imageId,
          createdAt: feedback.createdAt,
        };
        const patch: Partial<VisualConcept> = { feedbackNotes: [note] };
        if (structural) {
          patch.constraints = [...(concept.constraints ?? []), structural.positive];
          patch.negativeConstraints = [...(concept.negativeConstraints ?? []), ...structural.negative.split(",").map((item) => item.trim()).filter(Boolean)];
        }
        return upsertConcept([concept], { ...concept, ...patch })[0];
      });
    });
  }, [history, settings.autoSaveKnowledge]);

  /** Lets the user feed durable visual knowledge into the prompt compiler. */
  const addKnowledgeRule = useCallback((subject: string, rule: string, avoid: boolean) => {
    const name = subject.trim().slice(0, 80);
    const text = rule.trim().slice(0, 240);
    if (!name || !text) return;
    const now = new Date().toISOString();
    setConcepts((prev) => {
      const existing = prev.find((concept) => concept.name.toLowerCase() === name.toLowerCase());
      const base: VisualConcept = existing ?? {
        id: `custom:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name,
        category: "object",
        attributes: [],
        constraints: [],
        negativeConstraints: [],
        confidence: 0.9,
        sources: [],
        feedbackNotes: [],
        lastResearchedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const patch: Partial<VisualConcept> = avoid
        ? { negativeConstraints: [...(base.negativeConstraints ?? []), text] }
        : { constraints: [...(base.constraints ?? []), text] };
      const note = { id: `manual:${makeId()}`, kind: "visual-fact" as const, note: text, subject: name, createdAt: now };
      return upsertConcept(prev, { ...base, ...patch, feedbackNotes: [...base.feedbackNotes, note] }).slice(0, 400);
    });
  }, []);

  /** Promotes corrections found in the local gallery into reusable rules. */
  const learnFromGalleryNow = useCallback(() => {
    const result = learnFromGallery(history, concepts);
    if (result.added) setConcepts(result.concepts);
    return result;
  }, [history, concepts]);

  const mistakes = useMemo(() => recurringMistakes(history), [history]);

  const toggleFavorite = useCallback((imageId: string) => {
    setGalleryMeta((prev) => ({
      ...prev,
      favorites: prev.favorites.includes(imageId)
        ? prev.favorites.filter((id) => id !== imageId)
        : [imageId, ...prev.favorites],
    }));
  }, []);

  const createCollection = useCallback((name: string, description = ""): string => {
    const clean = name.trim().slice(0, 80);
    if (!clean) return "";
    const id = `collection:${makeId()}`;
    const now = new Date().toISOString();
    setGalleryMeta((prev) => ({
      ...prev,
      collections: [...prev.collections, { id, name: clean, description: description.slice(0, 300), imageIds: [], createdAt: now, updatedAt: now }].slice(0, 60),
    }));
    return id;
  }, []);

  const updateCollection = useCallback((collectionId: string, patch: Partial<Pick<ImageCollection, "name" | "description">>) => {
    setGalleryMeta((prev) => ({
      ...prev,
      collections: prev.collections.map((collection) => collection.id === collectionId
        ? {
          ...collection,
          name: patch.name?.trim().slice(0, 80) || collection.name,
          description: patch.description?.slice(0, 300) ?? collection.description,
          updatedAt: new Date().toISOString(),
        }
        : collection),
    }));
  }, []);

  const deleteCollection = useCallback((collectionId: string) => {
    setGalleryMeta((prev) => ({ ...prev, collections: prev.collections.filter((item) => item.id !== collectionId) }));
  }, []);

  const toggleCollectionImage = useCallback((collectionId: string, imageId: string) => {
    setGalleryMeta((prev) => ({
      ...prev,
      collections: prev.collections.map((collection) => collection.id === collectionId
        ? {
          ...collection,
          imageIds: collection.imageIds.includes(imageId)
            ? collection.imageIds.filter((id) => id !== imageId)
            : [imageId, ...collection.imageIds],
          updatedAt: new Date().toISOString(),
        }
        : collection),
    }));
  }, []);

  const saveEvaluation = useCallback((evaluation: Omit<ImageEvaluation, "id" | "createdAt" | "updatedAt">) => {
    setGalleryMeta((prev) => {
      const existing = prev.evaluations.find((item) => item.imageId === evaluation.imageId);
      const now = new Date().toISOString();
      const next: ImageEvaluation = {
        ...evaluation,
        id: existing?.id ?? `eval:${makeId()}`,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      return {
        ...prev,
        evaluations: [next, ...prev.evaluations.filter((item) => item.imageId !== evaluation.imageId)].slice(0, 200),
      };
    });
  }, []);

  const setImageNote = useCallback((imageId: string, note: string) => {
    setGalleryMeta((prev) => {
      const notes = { ...prev.notes };
      if (note.trim()) notes[imageId] = note.slice(0, 800);
      else delete notes[imageId];
      return { ...prev, notes };
    });
  }, []);

  const pruneGalleryMeta = useCallback((removedIds: string[]) => {
    if (!removedIds.length) return;
    const removed = new Set(removedIds);
    setGalleryMeta((prev) => {
      const notes = { ...prev.notes };
      for (const id of removed) delete notes[id];
      return {
        favorites: prev.favorites.filter((id) => !removed.has(id)),
        collections: prev.collections.map((collection) => ({
          ...collection,
          imageIds: collection.imageIds.filter((id) => !removed.has(id)),
        })),
        evaluations: prev.evaluations.filter((item) => !removed.has(item.imageId)),
        notes,
      };
    });
  }, []);

  const exportBundle = useCallback((): ImageExportBundle => ({
    app: "DavidAI-image",
    version: 3,
    exportedAt: new Date().toISOString(),
    concepts,
    history,
    settings,
    galleryMeta,
    videos,
  }), [concepts, history, settings, galleryMeta, videos]);

  const importBundle = useCallback((json: string) => {
    const parsed = JSON.parse(json) as Partial<ImageExportBundle>;
    if (parsed.app !== "DavidAI-image" || !Array.isArray(parsed.concepts) || !Array.isArray(parsed.history)) {
      throw new Error("This is not a DavidAI Image export file.");
    }
    const nextConcepts = parsed.concepts.flatMap((item) => {
      const normalized = normalizeConcept(item);
      return normalized ? [normalized] : [];
    });
    const nextHistory = parsed.history.flatMap((item) => {
      const normalized = normalizeImage(item);
      return normalized ? [normalized] : [];
    });
    const nextVideos = Array.isArray(parsed.videos)
      ? parsed.videos.flatMap((item) => {
        const normalized = normalizeVideo(item);
        return normalized ? [normalized] : [];
      })
      : [];
    setConcepts(nextConcepts.slice(0, 400));
    setHistory(nextHistory.slice(0, 80));
    setVideos(nextVideos.slice(0, 40));
    setSettings(normalizeSettings(parsed.settings));
    setGalleryMeta(normalizeGalleryMeta(parsed.galleryMeta));
  }, []);

  return {
    hydrated, concepts, history, videos, settings, galleryMeta, mistakes,
    addConcepts, saveImage, saveVideo, deleteImage, deleteVideo, clearHistory, clearVideos, updateSettings, applyFeedback, addKnowledgeRule, learnFromGalleryNow,
    toggleFavorite, createCollection, updateCollection, deleteCollection, toggleCollectionImage, saveEvaluation, setImageNote, pruneGalleryMeta,
    exportBundle, importBundle,
  };
}

export type ImageStore = ReturnType<typeof useImageStore>;
