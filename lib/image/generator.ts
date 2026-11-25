/**
 * Server-only wrapper around the local stable-diffusion.cpp executable.
 * No external AI API is contacted; the model weights and engine live on disk.
 */
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { dataRoot } from "../runtime-paths";
import {
  LOCAL_UPSCALER_NAME, LOCAL_UPSCALER_SCALE,
  type GeneratedImage, type ImageBackendOption, type ImageEngineStatus, type ImageGenerationSettings, type ImageModelId, type ImageModelOption,
} from "./types";
import type { AnatomyProfile } from "./visual-anatomy";
import { resolveCacheMode, resolveSampler, resolveScheduler } from "./render-strategy";
import { getGenerationQueueStatus } from "./generation-queue";

const projectRoot = process.cwd();
const manifestPath = join(projectRoot, "models", "image-model.json");
const imageDir = join(dataRoot(), "images");
const upscalerDir = join(projectRoot, "models", "upscalers");
const UPSCALER_FILE = "esrgan-4x-nmkd-f16.gguf";
// The installed GGUF is NMKD Superscale-SP F16. Its filename says "esrgan",
// but calling it Real-ESRGAN in the UI would be inaccurate.
export const UPSCALER_NAME = LOCAL_UPSCALER_NAME;
export const UPSCALER_SCALE = LOCAL_UPSCALER_SCALE;
// A detail pass plus local restoration can exceed the old 15 minute ceiling.
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_BATCH = 4;

/** Only checkpoints that can actually be selected on this machine. */
export const LOCAL_MODELS: Array<Omit<ImageModelOption, "bytes" | "available"> & { file: string }> = [
  {
    id: "sd15-f16",
    name: "Stable Diffusion 1.5 F16 GGUF",
    file: "stable-diffusion-v1-5-f16.gguf",
    note: "Full-precision checkpoint. Default in Auto for animals, vehicles and objects; best colour stability here.",
  },
  {
    id: "sd15-q4",
    name: "Stable Diffusion 1.5 Q4_1 GGUF",
    file: "stable-diffusion-v1-5-Q4_1.gguf",
    note: "Smaller SD 1.5 weights for faster CPU experiments; slightly softer detail.",
  },
  {
    id: "realistic-v6",
    name: "Realistic Vision V6 Q4_1 GGUF",
    file: "realistic-vision-v60-b1-Q4_1.gguf",
    note: "Portrait fine-tune. Selected in Auto only for people; produced muddy colours on animals in local A/B tests.",
  },
  {
    id: "dreamshaper-lcm",
    name: "DreamShaper 7 LCM Q4_0 GGUF",
    file: "dreamshaper-7-lcm-q4_0.gguf",
    note: "Fused LCM-LoRA checkpoint for 6-step CPU renders. Pick the Fast LCM preset for matching sampler, scheduler, steps and CFG; several times quicker than a 20-step SD 1.5 render.",
  },
];

/** Installed-but-unavailable families are shown with the real reason, not as fake choices. */
export const LOCAL_BACKENDS: ImageBackendOption[] = [
  { id: "cpu", name: "Local CPU (stable-diffusion.cpp)", available: true, note: "Active backend. Uses the installed native GGUF binary." },
  { id: "cuda", name: "NVIDIA CUDA", available: false, note: "This build ships no CUDA runtime and this machine has no NVIDIA GPU." },
  { id: "vulkan", name: "Vulkan", available: false, note: "This build ships no ggml-vulkan runtime; the Intel HD 630 is not used for diffusion." },
  { id: "remote", name: "Remote / cloud model", available: false, note: "Disabled by design: this workspace is local-only and uses no paid or external AI service." },
];

export function resolveLocalModel(modelId: ImageModelId | undefined, needsPeopleModel: boolean): { file: string; label: string } {
  const chosen = modelId && modelId !== "auto"
    ? LOCAL_MODELS.find((model) => model.id === modelId)
    : undefined;
  if (chosen) return { file: chosen.file, label: chosen.name };
  // A same-seed A/B on animals showed Realistic Vision V6 producing chaotic,
  // muddy colours while SD 1.5 F16 kept a coherent forest/snow structure.
  // Auto therefore uses the portrait fine-tune only for people; animals,
  // vehicles and objects use full-precision SD 1.5. Explicit choices still win.
  if (needsPeopleModel) {
    const portrait = LOCAL_MODELS.find((model) => model.id === "realistic-v6")!;
    if (existsSync(join(projectRoot, "models", portrait.file))) {
      return { file: portrait.file, label: portrait.name };
    }
  }
  const base = LOCAL_MODELS.find((model) => model.id === "sd15-f16")!;
  if (existsSync(join(projectRoot, "models", base.file))) {
    return { file: base.file, label: base.name };
  }
  const manifest = readManifest();
  return {
    file: safeName(manifest?.modelFile, LOCAL_MODELS[0].file),
    label: manifest?.modelName ?? LOCAL_MODELS[0].name,
  };
}

function modelLabel(file: string): string {
  if (file.includes("realistic-vision")) return "Realistic Vision V6 Q4_1 GGUF";
  if (/lcm/i.test(file)) return "DreamShaper 7 LCM Q4_0 GGUF";
  if (file.includes("f16")) return "Stable Diffusion 1.5 F16 GGUF";
  if (file.includes("stable-diffusion-v1-5")) return "Stable Diffusion 1.5 Q4_1 GGUF";
  return LOCAL_MODELS.find((model) => model.file === file)?.name ?? file;
}

interface Manifest {
  app?: string;
  modelName?: string;
  binary?: string;
  modelFile?: string;
  modelBytes?: number;
  binaryBytes?: number;
  license?: string;
  engine?: string;
  release?: string;
  installedAt?: string;
}

function readManifest(): Manifest | null {
  try {
    if (!existsSync(manifestPath)) return null;
    return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

function fileSize(path: string): number {
  try { return existsSync(path) ? statSync(path).size : 0; } catch { return 0; }
}

/** Keeps manifest paths inside the two managed asset folders. */
function safeName(relative: string | undefined, fallback: string): string {
  const name = (relative ?? "").replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? fallback;
  return /^[a-zA-Z0-9._-]+$/.test(name) ? name : fallback;
}

function binaryPath(relative: string | undefined): string {
  return join(projectRoot, "bin", "sd-cpp", safeName(relative, "sd-cli.exe"));
}

function modelPath(relative: string | undefined): string {
  return join(projectRoot, "models", safeName(relative, "stable-diffusion-v1-5-f16.gguf"));
}

let cachedGpu: string[] | null = null;
function gpuNames(): string[] {
  if (cachedGpu) return cachedGpu;
  try {
    const output = execFileSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join '|'",
    ], { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] });
    cachedGpu = output.split("|").map((item) => item.trim()).filter(Boolean).slice(0, 4);
  } catch {
    cachedGpu = [];
  }
  return cachedGpu;
}

/**
 * Asset and hardware facts change only when model files change. Cache them for
 * a short window so repeated status polls and the two per-render status calls
 * do not re-read the manifest and re-stat every checkpoint each time. Queue
 * state stays live and is added by getImageEngineStatus().
 */
let cachedStaticEngine: { at: number; info: Omit<ImageEngineStatus, "queue"> } | null = null;

function staticEngineInfo(): Omit<ImageEngineStatus, "queue"> {
  const now = Date.now();
  if (cachedStaticEngine && now - cachedStaticEngine.at < 1500) return cachedStaticEngine.info;
  const manifest = readManifest();
  const binary = manifest?.binary ? binaryPath(manifest.binary) : "";
  const modelFile = manifest?.modelFile ? modelPath(manifest.modelFile) : "";
  const binaryBytes = fileSize(binary);
  const modelBytes = fileSize(modelFile);
  const ready = Boolean(manifest && binaryBytes > 0 && modelBytes > 500_000_000);
  const integrated = gpuNames().some((name) => /intel|uhd|hd graphics/i.test(name));
  const upscalerFile = join(upscalerDir, UPSCALER_FILE);
  const upscalerReady = fileSize(upscalerFile) > 10_000_000;
  const info: Omit<ImageEngineStatus, "queue"> = {
    ready,
    upscalerReady,
    upscalerFile: `models/upscalers/${UPSCALER_FILE}`,
    upscalerName: UPSCALER_NAME,
    modelName: manifest?.modelName ?? "Not installed",
    modelFile: manifest?.modelFile ?? "models/stable-diffusion-v1-5-f16.gguf",
    modelBytes,
    binary: manifest?.binary ?? "bin/sd-cpp/sd-cli.exe",
    binaryBytes,
    message: ready
      ? `Local ${manifest?.engine ?? "diffusion"} engine ready${integrated ? " on integrated graphics (CPU backend)." : "."}`
      : "Image engine is not installed. Run npm run setup:image once to download the free local model and engine.",
    hardware: {
      platform: os.platform(),
      arch: os.arch(),
      cpuCount: os.cpus().length,
      totalMemoryGb: Math.round((os.totalmem() / 1_073_737_728) * 10) / 10,
      gpu: gpuNames(),
    },
    limits: { maxWidth: 512, maxHeight: 512, maxSteps: 30, timeoutSeconds: DEFAULT_TIMEOUT_MS / 1000, maxBatch: MAX_BATCH },
    models: LOCAL_MODELS.map((model) => {
      const bytes = fileSize(join(projectRoot, "models", model.file));
      return { ...model, bytes, available: bytes > 500_000_000 };
    }),
    backends: LOCAL_BACKENDS,
  };
  cachedStaticEngine = { at: now, info };
  return info;
}

export function getImageEngineStatus(): ImageEngineStatus {
  return { ...staticEngineInfo(), queue: getGenerationQueueStatus() };
}

export interface GenerateOptions {
  prompt: string;
  negativePrompt?: string;
  settings: ImageGenerationSettings;
  /** Used only to resolve Auto sampler selection; manual values still win. */
  anatomy?: AnatomyProfile;
  /** Optional local weights file; falls back to the installed default. */
  modelFile?: string;
  /** Real image-guided input produced by the local edit preparation step. */
  initImagePath?: string;
  maskImagePath?: string;
  /** Halves peak UNet memory on the bundled CPU engine. Used by video keyframes. */
  lowMemory?: boolean;
  onProgress?: (progress: number, detail?: string) => void;
  /** Periodic keep-alive for long CPU renders; carries real elapsed time. */
  onHeartbeat?: (detail: string) => void;
  signal?: AbortSignal;
}

export interface GenerateResult {
  id: string;
  imageUrl: string;
  metadataPath: string;
  durationMs: number;
  model: string;
  /** Exact seed passed to the engine for this image (batch seeds increment). */
  actualSeed: number;
  diffusionWidth: number;
  diffusionHeight: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  cacheMode: "quality" | "balanced" | "turbo";
  threads: number;
  vaeTiling: boolean;
  hires: boolean;
  hiresSteps: number;
  modelFile: string;
  engine?: string;
}

export interface UpscaleResult {
  id: string;
  imageUrl: string;
  metadataPath: string;
  durationMs: number;
  model: string;
  upscalerName: string;
  upscalerFile: string;
  scale: number;
  sourceId: string;
}

const SAMPLERS = new Set([
  "euler", "euler_a", "heun", "dpm2", "dpm++2s_a", "dpm++2m", "dpm++2mv2", "ipndm", "ipndm_v",
  "lcm", "ddim_trailing", "tcd", "res_multistep", "res_2s", "er_sde", "euler_cfg_pp",
  "euler_a_cfg_pp", "euler_ge", "dpm++2m_sde", "dpm++2m_sde_bt", "lms",
]);
const SCHEDULERS = new Set([
  "discrete", "karras", "exponential", "ays", "gits", "sgm_uniform", "simple", "smoothstep",
  "kl_optimal", "lcm", "bong_tangent", "logit_normal",
]);

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || randomUUID();
}

function outputFiles(prefix: string, batchCount: number): string[] {
  if (batchCount <= 1) {
    const single = join(imageDir, `${prefix}.png`);
    return existsSync(single) ? [single] : [];
  }
  if (!existsSync(imageDir)) return [];
  return readdirSync(imageDir)
    .filter((name) => new RegExp(`^${prefix}-\\d+\\.png$`).test(name))
    .sort((a, b) => Number(a.match(/(\d+)\.png$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.png$/)?.[1] ?? 0))
    .map((name) => join(imageDir, name));
}

function removeOutputFiles(prefix: string): void {
  for (const file of outputFiles(prefix, MAX_BATCH)) rmSync(file, { force: true });
}

export interface GenerationArgsInput {
  modelFile: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  cacheMode: "quality" | "balanced" | "turbo";
  threads: number;
  strength: number;
  outputPattern: string;
  hasInput: boolean;
  initImagePath?: string;
  maskImagePath?: string;
  vaeTiling: boolean;
  hires: boolean;
  hiresSteps: number;
  batchCount: number;
  actualSeed: number;
  lowMemory?: boolean;
}

/**
 * Pure argv compiler. Keeping it separate from process spawning lets tests
 * prove that every pro control reaches the real engine and that the recorded
 * seed is the one actually passed to sd-cli.
 */
export function buildGenerationArgs(input: GenerationArgsInput): string[] {
  return [
    "-m", input.modelFile,
    "--backend", "cpu",
    "-t", String(input.threads),
    "--mmap",
    "-p", input.prompt,
    "-n", input.negativePrompt.slice(0, 800),
    "-W", String(input.width),
    "-H", String(input.height),
    "--steps", String(input.steps),
    "--cfg-scale", String(input.cfg),
    "--sampling-method", input.sampler,
    "--scheduler", input.scheduler,
    // Benchmarked on this CPU: UCache 0.40 kept colour structure with a small
    // pixel delta while saving about 27%; spectrum was faster but artefacted at
    // low steps, and no-cache is the slowest. The resolved mode is recorded in
    // provenance for every render.
    ...(input.cacheMode === "turbo"
      ? ["--cache-mode", "spectrum"]
      : input.cacheMode === "balanced"
        ? ["--cache-mode", "ucache", "--cache-option", "threshold=0.40"]
        : []),
    "--conv-direct", "on",
    // Batched CFG runs both branches in one UNet pass. On this CPU it needs a
    // larger contiguous weight buffer than the machine sometimes has free;
    // splitting the branches avoids the "RAM weight capacity exceeded" crash.
    ...(input.lowMemory ? ["--batched-cfg", "off"] : []),
    ...(input.vaeTiling ? ["--vae-tiling"] : []),
    // Real image-guided editing uses the installed SD 1.5 weights as masked
    // image guidance, not dedicated inpaint weights.
    ...(input.hasInput ? ["-i", input.initImagePath ?? "", "--strength", String(input.strength)] : []),
    ...(input.hasInput && input.maskImagePath ? ["--mask", input.maskImagePath] : []),
    ...(input.hires ? [
      "--hires",
      "--hires-upscaler", "Latent",
      "--hires-scale", "2",
      "--hires-steps", String(input.hiresSteps),
      "--hires-denoising-strength", "0.55",
    ] : []),
    ...(input.batchCount > 1 ? ["-b", String(input.batchCount)] : []),
    "--rng", "cpu",
    "-s", String(input.actualSeed),
    "--log-level", "info",
    "-o", input.outputPattern,
  ];
}

/** Runs one or more real local diffusion renders in a single model load. */
export async function generateLocalImages(options: GenerateOptions): Promise<{ results: GenerateResult[] }> {
  const status = getImageEngineStatus();
  if (!status.ready) throw new Error(status.message);
  const manifest = readManifest();
  const binary = binaryPath(manifest!.binary);
  const preferredModel = options.modelFile ? safeName(options.modelFile, "") : "";
  const modelFileName = preferredModel && existsSync(join(projectRoot, "models", preferredModel))
    ? preferredModel
    : safeName(manifest?.modelFile, LOCAL_MODELS[0].file);
  const modelFile = modelPath(modelFileName);
  const modelName = modelLabel(modelFileName);
  const prompt = options.prompt.trim().slice(0, 2400);
  if (prompt.length < 3) throw new Error("A visual description is required.");
  const settings = options.settings;
  const width = clamp(settings.width, 256, status.limits.maxWidth, 256);
  const height = clamp(settings.height, 256, status.limits.maxHeight, 256);
  const steps = clamp(settings.steps, 1, status.limits.maxSteps, 16);
  const cfg = Number.isFinite(Number(settings.guidance)) ? Math.max(0, Math.min(20, Number(settings.guidance))) : 7;
  const requestedSeed = typeof settings.seed === "number" && Number.isFinite(settings.seed) ? Math.max(0, Math.floor(settings.seed)) : null;
  // Always pass a concrete seed so the exact value can be stored in history.
  // A negative engine seed means "random" but leaves no truthful record.
  const actualSeed = requestedSeed ?? Math.floor(Math.random() * 2_147_483_647);
  const batchCount = clamp(settings.batchCount, 1, status.limits.maxBatch, 1);
  // Auto sampler/scheduler follow the checkpoint: fused LCM weights need the
  // LCM sampler; SD 1.5 and Realistic Vision stay on tested Euler + Karras.
  // Manual pro-control values still win inside resolveSampler/resolveScheduler.
  const renderModelId = /lcm/i.test(modelFileName) ? "dreamshaper-lcm" : undefined;
  const resolvedSampler = resolveSampler(settings, options.anatomy, renderModelId);
  const resolvedScheduler = resolveScheduler(settings, renderModelId);
  const sampler = SAMPLERS.has(resolvedSampler) ? resolvedSampler : "euler";
  const scheduler = SCHEDULERS.has(resolvedScheduler) ? resolvedScheduler : "karras";
  const strength = Number.isFinite(Number(settings.strength)) ? Math.max(0.05, Math.min(1, Number(settings.strength))) : 0.55;
  const threads = Math.max(1, Math.min(8, os.cpus().length));
  const cacheMode = resolveCacheMode(settings);
  const hires = settings.hires === true;
  const hiresSteps = hires ? Math.max(4, Math.round(steps * 0.6)) : 0;
  // A hires pass doubles the decoded image even though the CLI receives the
  // base width/height. VAE tiling must be based on the effective final size.
  const effectiveWidth = width * (hires ? 2 : 1);
  const effectiveHeight = height * (hires ? 2 : 1);
  const vaeTiling = effectiveWidth >= 512 || effectiveHeight >= 512;
  const hasInput = Boolean(options.initImagePath);

  mkdirSync(imageDir, { recursive: true });
  const prefix = safeId(randomUUID());
  const outputPattern = batchCount > 1 ? join(imageDir, `${prefix}-%d.png`) : join(imageDir, `${prefix}.png`);
  const args = buildGenerationArgs({
    modelFile,
    prompt,
    negativePrompt: options.negativePrompt ?? "",
    width,
    height,
    steps,
    cfg,
    sampler,
    scheduler,
    cacheMode,
    threads,
    strength,
    lowMemory: options.lowMemory === true,
    outputPattern,
    hasInput,
    initImagePath: options.initImagePath,
    maskImagePath: options.maskImagePath,
    vaeTiling,
    hires,
    hiresSteps,
    batchCount,
    actualSeed,
  });

  const started = Date.now();
  try {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(binary, args, { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
      let engineOutput = "";
      let progressBuffer = "";
      let lastStep = 0;
      let completedImages = 0;
      let settled = false;
      const heartbeat = setInterval(() => {
        if (settled) return;
        const elapsed = Math.round((Date.now() - started) / 1000);
        options.onHeartbeat?.(`Local render still running · ${elapsed}s elapsed`);
      }, 15_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearInterval(heartbeat);
        if (error) reject(error);
        else resolvePromise();
      };
      const onAbort = () => {
        child.kill("SIGTERM");
        finish(new Error("Image generation was cancelled."));
      };
      if (options.signal?.aborted) { onAbort(); return; }
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new Error("Image generation timed out. Try fewer steps, a smaller canvas, or fewer images."));
      }, DEFAULT_TIMEOUT_MS);
      const consumeChunk = (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        engineOutput = (engineOutput + text).slice(-8000);
        progressBuffer = (progressBuffer + text).slice(-4000);
        const matches = [...progressBuffer.matchAll(/(\d+)\s*\/\s*(\d+)\s*-\s*[\d.]+s\/it/g)];
        for (const match of matches) {
          const step = Number(match[1]);
          const total = Number(match[2]);
          if (total <= 1 || step > total) continue;
          if (lastStep > total * 0.6 && step <= 2 && completedImages < batchCount - 1) completedImages++;
          if (step > lastStep || completedImages > 0) {
            lastStep = step;
            const fraction = (completedImages + step / total) / batchCount;
            options.onProgress?.(
              Math.min(99, Math.round(fraction * 100)),
              batchCount > 1 ? `Render ${completedImages + 1} of ${batchCount} · step ${step}/${total}` : `Denoising step ${step} of ${total}`,
            );
          }
        }
      };
      child.stdout.on("data", consumeChunk);
      child.stderr.on("data", consumeChunk);
      child.on("error", (error) => { clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); finish(error); });
      child.on("close", (code) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        if (code !== 0) finish(new Error(engineOutput.trim().slice(-1200) || `Image engine exited with code ${code}.`));
        else finish();
      });
    });

    if (options.signal?.aborted) throw new Error("Image generation was cancelled.");
    const files = outputFiles(prefix, batchCount);
    if (files.length < batchCount) {
      throw new Error("The image engine finished without producing every requested PNG.");
    }
    const results: GenerateResult[] = [];
    for (const [index, file] of files.entries()) {
      if (statSync(file).size < 1000) {
        removeOutputFiles(prefix);
        throw new Error("The image engine produced an invalid PNG.");
      }
      const id = batchCount > 1 ? `${prefix}-${index}` : prefix;
      results.push({
        id,
        imageUrl: `/api/image/generated/${id}`,
        metadataPath: join(imageDir, `${id}.json`),
        durationMs: Date.now() - started,
        model: modelName,
        // sd-cli increments the supplied seed for batch members. Recording that
        // exact value makes variations reproducible instead of merely "random".
        actualSeed: actualSeed + index,
        diffusionWidth: width,
        diffusionHeight: height,
        steps,
        cfg,
        sampler,
        scheduler,
        cacheMode,
        threads,
        vaeTiling,
        hires,
        hiresSteps,
        modelFile,
        engine: readManifest()?.engine,
      });
    }
    options.onProgress?.(100, `${results.length} image${results.length === 1 ? "" : "s"} written to local storage`);
    return { results };
  } catch (error) {
    // Aborts, timeouts and engine failures must not leave orphan PNGs behind.
    removeOutputFiles(prefix);
    throw error;
  }
}

/** Backwards-compatible single-image wrapper used by existing callers. */
export async function generateLocalImage(options: GenerateOptions): Promise<GenerateResult> {
  const { results } = await generateLocalImages(options);
  return results[0];
}

export interface UpscaleOptions {
  sourceId: string;
  onProgress?: (progress: number, detail?: string) => void;
  onHeartbeat?: (detail: string) => void;
  signal?: AbortSignal;
}

/** Runs the installed local 4x restorer over an existing locally generated PNG. */
export async function upscaleLocalImage(options: UpscaleOptions): Promise<UpscaleResult> {
  const status = getImageEngineStatus();
  if (!status.ready) throw new Error(status.message);
  if (!status.upscalerReady) throw new Error(`The local ${UPSCALER_NAME} upscaler is not installed. Run npm run setup:image once.`);
  const source = imageFilePath(options.sourceId);
  if (!source) throw new Error("The source image was not found.");
  const manifest = readManifest();
  const binary = binaryPath(manifest!.binary);
  const id = safeId(randomUUID());
  const output = join(imageDir, `${id}.png`);
  // Upscale mode only needs the small local restorer weights, not the diffusion model.
  const args = [
    "-M", "upscale",
    "--upscale-model", join(upscalerDir, UPSCALER_FILE),
    "--backend", "cpu",
    "-t", String(Math.max(1, Math.min(8, os.cpus().length))),
    "-i", source,
    "-o", output,
    "--upscale-tile-size", "128",
    "--log-level", "info",
  ];

  const started = Date.now();
  try {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(binary, args, { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
      let engineOutput = "";
      let settled = false;
      const heartbeat = setInterval(() => {
        if (settled) return;
        const elapsed = Math.round((Date.now() - started) / 1000);
        options.onHeartbeat?.(`${UPSCALER_NAME} enhancement still running · ${elapsed}s elapsed`);
      }, 15_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearInterval(heartbeat);
        if (error) reject(error);
        else resolvePromise();
      };
      const onAbort = () => { child.kill("SIGTERM"); finish(new Error("Enhancement was cancelled.")); };
      if (options.signal?.aborted) { onAbort(); return; }
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new Error("Enhancement timed out. The source image may be too large for this CPU."));
      }, DEFAULT_TIMEOUT_MS);
      const consume = (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        engineOutput = (engineOutput + text).slice(-8000);
        // The upscaler logs stages, not steps; report only stages it actually prints.
        if (/Upscaler architecture/i.test(text)) options.onProgress?.(10, `Loading ${UPSCALER_NAME} weights`);
        if (/upscaling from/i.test(text)) options.onProgress?.(35, `Enhancing image tiles with ${UPSCALER_NAME}`);
        if (/taking [\d.]+s/i.test(text)) options.onProgress?.(90, "Detail pass complete");
        if (/save result image/i.test(text)) options.onProgress?.(96, "Writing enhanced PNG");
      };
      child.stdout.on("data", consume);
      child.stderr.on("data", consume);
      child.on("error", (error) => { clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); finish(error); });
      child.on("close", (code) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        if (code !== 0) finish(new Error(engineOutput.trim().slice(-1200) || `Upscaler exited with code ${code}.`));
        else finish();
      });
    });

  if (options.signal?.aborted) throw new Error("Enhancement was cancelled.");
  if (!existsSync(output) || statSync(output).size < 1000 || !inspectGeneratedImage(id).valid) {
    rmSync(output, { force: true });
    throw new Error("The local upscaler finished without producing a valid image.");
  }
    options.onProgress?.(100, "Enhanced image written to local storage");
    return {
      id,
      imageUrl: `/api/image/generated/${id}`,
      metadataPath: join(imageDir, `${id}.json`),
      durationMs: Date.now() - started,
      model: UPSCALER_NAME,
      upscalerName: UPSCALER_NAME,
      upscalerFile: `models/upscalers/${UPSCALER_FILE}`,
      scale: UPSCALER_SCALE,
      sourceId: options.sourceId,
    };
  } catch (error) {
    rmSync(output, { force: true });
    throw error;
  }
}

export function writeImageMetadata(record: GeneratedImage): void {
  mkdirSync(imageDir, { recursive: true });
  writeFileSync(join(imageDir, `${record.id}.json`), JSON.stringify(record, null, 2));
}

export function readImageMetadata(id: string): GeneratedImage | null {
  try {
    const safe = safeId(id);
    const path = join(imageDir, `${safe}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as GeneratedImage;
  } catch {
    return null;
  }
}

/** Verifies that the file is a real PNG and reads its IHDR dimensions. */
export function inspectGeneratedImage(id: string): { bytes: number; width: number | null; height: number | null; valid: boolean } {
  const path = imageFilePath(id);
  if (!path) return { bytes: 0, width: null, height: null, valid: false };
  const bytes = statSync(path).size;
  const header = readFileSync(path).subarray(0, 24);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const valid = bytes >= 1000 && header.subarray(0, 8).equals(signature) && header.subarray(12, 16).toString("ascii") === "IHDR";
  return {
    bytes,
    width: valid ? header.readUInt32BE(16) : null,
    height: valid ? header.readUInt32BE(20) : null,
    valid,
  };
}

export function listImageMetadata(): GeneratedImage[] {
  try {
    if (!existsSync(imageDir)) return [];
    return readdirSync(imageDir)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) => {
        const record = readImageMetadata(name.replace(/\.json$/, ""));
        return record ? [record] : [];
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function imageFilePath(id: string): string | null {
  const safe = safeId(id);
  const path = join(imageDir, `${safe}.png`);
  return existsSync(path) ? path : null;
}

export function deleteGeneratedImage(id: string): boolean {
  const safe = safeId(id);
  let removed = false;
  for (const ext of ["png", "json"]) {
    const path = join(imageDir, `${safe}.${ext}`);
    if (existsSync(path)) { rmSync(path, { force: true }); removed = true; }
  }
  return removed;
}
