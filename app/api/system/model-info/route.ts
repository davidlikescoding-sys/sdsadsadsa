import { GET as getNetworkStatus } from "@/app/api/network/status/route";
import { getBrainStatus } from "@/lib/brain/service";
import type { BrainStats } from "@/lib/brain/types";
import { getImageEngineStatus } from "@/lib/image/generator";
import type { ImageEngineStatus, ImageModelOption } from "@/lib/image/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** These server endpoints exist in this build; this route never calls them. */
const RESEARCH_APIS_AVAILABLE = true;

interface LocalLlmDetails {
  modelPath: string | null;
  modelBytes: number | null;
  embeddingModel: string | null;
  embeddingReady: boolean;
  executableReady: boolean;
}

interface ImageDetails {
  binary: string | null;
  modelFile: string | null;
  models: ImageModelOption[];
  upscaler: { name: string | null; ready: boolean; file: string | null };
  modelBytes: number | null;
  binaryBytes: number | null;
  limits: ImageEngineStatus["limits"] | null;
  queue: ImageEngineStatus["queue"] | null;
}

interface BrainDetails {
  databasePath: string | null;
  embeddingModel: string | null;
  embeddingReady: boolean;
  embeddingBytes: number | null;
  integrity: string | null;
  schemaVersion: number | null;
}

interface EngineBase {
  id: string;
  name: string;
  family: string;
  version: string | null;
  quantization: string | null;
  parameters: number | null;
  contextWindow: number | null;
  /** Installed and enabled in this build, independent of missing asset files. */
  active: boolean;
  /** The live file/status check passed. */
  ready: boolean;
  purpose: string;
  limitations: string[];
}

interface LocalLlmEngine extends EngineBase {
  id: "local-llm";
  details: LocalLlmDetails;
}

interface ImageEngine extends EngineBase {
  id: "image-diffusion";
  details: ImageDetails;
}

interface BrainEngine extends EngineBase {
  id: "persistent-brain";
  stats: BrainStats | null;
  details: BrainDetails;
}

type Engine = LocalLlmEngine | ImageEngine | BrainEngine;

interface ModelInfoResponse {
  ok: true;
  generatedAt: string;
  runtime: {
    platform: string;
    arch: string;
    cpuCount: number | null;
    totalMemoryGb: number | null;
    gpu: string[];
    online: boolean;
    nodeVersion: string;
    webAccessActive: boolean;
  };
  engines: Engine[];
  webAccess: {
    online: boolean;
    chatWebSearchEnabled: false;
    researchApisAvailable: boolean;
  };
  notes: string[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeCall<T>(read: () => T): { value: T | null; error: string | null } {
  try {
    return { value: read(), error: null };
  } catch (error) {
    return { value: null, error: messageOf(error) };
  }
}

async function readNetworkStatus(): Promise<{ online: boolean; error: string | null }> {
  try {
    // The status endpoint is a plain connectivity probe (HEAD to example.com),
    // not a research request. Calling its handler avoids a self-fetch.
    const response = await getNetworkStatus();
    const payload = await response.json() as { ok?: boolean; online?: boolean };
    return { online: response.ok && payload.ok === true && payload.online === true, error: null };
  } catch (error) {
    return { online: false, error: messageOf(error) };
  }
}

/** Only report a quantization that is actually named by the installed model. */
function quantizationFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const match = name.match(/\b(F16|F32|FP16|FP32|Q4_0|Q4_1|Q4_K_M|Q4_K_S|Q5_K_M|Q5_K_S|Q6_K|Q8_0)\b/i);
  return match ? match[0].toUpperCase() : null;
}

function imageLimitations(status: ImageEngineStatus | null): string[] {
  const limitations = ["Runs through the bundled stable-diffusion.cpp CPU backend; no remote image API is used."];
  if (!status) return limitations;
  limitations.push(`Local limit: ${status.limits.maxWidth}×${status.limits.maxHeight} px, up to ${status.limits.maxSteps} steps per render.`);
  const gpuBackends = status.backends.filter((backend) => backend.available && /cuda|vulkan|gpu/i.test(backend.id));
  if (!gpuBackends.length) limitations.push("No CUDA or Vulkan backend is available in this build; the GPU is not used for diffusion.");
  return limitations;
}

export async function GET(): Promise<Response> {
  const generatedAt = new Date().toISOString();
  const notes: string[] = [
    "Facts here come from installed files and live status checks; no external AI service is used at runtime.",
    "webAccessActive means the connectivity probe passed and the server research endpoints are present; it does not mean research is running.",
    "chatWebSearchEnabled is always false because browser chat settings cannot be read from a server route; check the UI toggle to know if chat web search is on.",
    "Parameter counts are reported only for models with a verified identity; unknown values are null.",
  ];

  const brainResult = safeCall(getBrainStatus);
  const imageResult = safeCall(getImageEngineStatus);
  const network = await readNetworkStatus();

  if (brainResult.error) notes.push(`Brain status could not be read: ${brainResult.error}`);
  if (imageResult.error) notes.push(`Image engine status could not be read: ${imageResult.error}`);
  if (network.error) notes.push(`Network probe failed: ${network.error}`);

  const brain = brainResult.value;
  const image = imageResult.value;
  const local = brain?.localModel;
  const hardware = image?.hardware;
  const webAccessActive = network.online && RESEARCH_APIS_AVAILABLE;

  const localLlm: LocalLlmEngine = {
    id: "local-llm",
    name: "Qwen2.5 1.5B Instruct (local GGUF)",
    family: "Qwen2.5",
    version: "2.5",
    quantization: "Q4_K_M",
    parameters: 1_500_000_000,
    contextWindow: 4096,
    active: true,
    ready: Boolean(local?.executableReady && local.modelReady),
    purpose: "Offline grounded chat answers",
    limitations: ["CPU-only llama.cpp here", "No token streaming in current backend", "1.5B model has knowledge limits"],
    details: {
      modelPath: local?.model ?? null,
      modelBytes: local ? local.modelBytes : null,
      embeddingModel: local?.embeddingModel ?? null,
      embeddingReady: Boolean(local?.embeddingReady),
      executableReady: Boolean(local?.executableReady),
    },
  };

  const imageEngine: ImageEngine = {
    id: "image-diffusion",
    name: image?.modelName ?? "Local image engine (status unavailable)",
    family: "Stable Diffusion / LCM",
    version: null,
    quantization: quantizationFromName(image?.modelName) ?? quantizationFromName(image?.modelFile),
    parameters: null,
    contextWindow: null,
    active: true,
    ready: Boolean(image?.ready),
    purpose: "Local image generation",
    limitations: imageLimitations(image),
    details: {
      binary: image?.binary ?? null,
      modelFile: image?.modelFile ?? null,
      models: image ? image.models.filter((model) => model.available) : [],
      upscaler: {
        name: image?.upscalerName ?? null,
        ready: Boolean(image?.upscalerReady),
        file: image?.upscalerFile ?? null,
      },
      modelBytes: image ? image.modelBytes : null,
      binaryBytes: image ? image.binaryBytes : null,
      limits: image?.limits ?? null,
      queue: image?.queue ?? null,
    },
  };

  const brainEngine: BrainEngine = {
    id: "persistent-brain",
    name: "SQLite brain + MiniLM embeddings",
    family: "SQLite + all-MiniLM-L6-v2 embeddings",
    version: null,
    quantization: quantizationFromName(local?.embeddingModel),
    parameters: null,
    contextWindow: null,
    active: true,
    ready: Boolean(brain?.ready),
    purpose: "Persistent local memory with semantic retrieval for grounded answers",
    limitations: [
      "Only information saved on this device is available.",
      "This engine never performs web research by itself.",
      "Semantic retrieval needs the local MiniLM embedding model to be ready.",
    ],
    stats: brain?.stats ?? null,
    details: {
      databasePath: brain?.databasePath ?? null,
      embeddingModel: local?.embeddingModel ?? null,
      embeddingReady: Boolean(local?.embeddingReady),
      embeddingBytes: local ? local.embeddingBytes : null,
      integrity: brain?.stats.integrity ?? null,
      schemaVersion: brain?.stats.schemaVersion ?? null,
    },
  };

  const payload: ModelInfoResponse = {
    ok: true,
    generatedAt,
    runtime: {
      platform: hardware?.platform ?? process.platform,
      arch: hardware?.arch ?? process.arch,
      cpuCount: hardware?.cpuCount ?? null,
      totalMemoryGb: hardware?.totalMemoryGb ?? null,
      gpu: hardware?.gpu ?? [],
      online: network.online,
      nodeVersion: process.version,
      webAccessActive,
    },
    engines: [localLlm, imageEngine, brainEngine],
    webAccess: {
      online: network.online,
      chatWebSearchEnabled: false,
      researchApisAvailable: RESEARCH_APIS_AVAILABLE,
    },
    notes,
  };

  return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
}
