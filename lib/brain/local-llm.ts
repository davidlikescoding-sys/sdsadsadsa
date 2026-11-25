import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { dataRoot } from "../runtime-paths";

const ROOT = process.cwd();
export const LLAMA_BIN_DIR = join(ROOT, "bin", "llama-cpp");
export const LLAMA_CLI = join(LLAMA_BIN_DIR, "llama-cli.exe");
export const LLAMA_SERVER = join(LLAMA_BIN_DIR, "llama-server.exe");
export const LLAMA_CHAT_MODEL = join(ROOT, "models", "llm", "qwen2.5-1.5b-instruct-q4_k_m.gguf");
export const LLAMA_EMBED_MODEL = join(ROOT, "models", "llm", "all-MiniLM-L6-v2-Q4_K_M.gguf");
export const LOCAL_EMBEDDING_ID = "all-MiniLM-L6-v2-Q4_K_M";

export interface LocalModelStatus {
  executable: string;
  model: string;
  embeddingModel: string;
  executableReady: boolean;
  modelReady: boolean;
  embeddingReady: boolean;
  modelBytes: number;
  embeddingBytes: number;
}

export function getLocalModelStatus(): LocalModelStatus {
  const size = (path: string): number => (existsSync(path) ? statSync(path).size : 0);
  return {
    executable: LLAMA_CLI,
    model: LLAMA_CHAT_MODEL,
    embeddingModel: LLAMA_EMBED_MODEL,
    executableReady: existsSync(LLAMA_CLI),
    modelReady: size(LLAMA_CHAT_MODEL) > 1_000_000_000,
    embeddingReady: size(LLAMA_EMBED_MODEL) > 10_000_000 && existsSync(LLAMA_SERVER),
    modelBytes: size(LLAMA_CHAT_MODEL),
    embeddingBytes: size(LLAMA_EMBED_MODEL),
  };
}

export function localModelReady(): boolean {
  const status = getLocalModelStatus();
  return status.executableReady && status.modelReady;
}

interface CompletionOptions {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  topK?: number;
  topP?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function cleanGeneratedText(raw: string): string {
  let text = String(raw || "");
  const answerMarker = text.lastIndexOf("ANSWER:");
  if (answerMarker >= 0) text = text.slice(answerMarker + "ANSWER:".length);
  text = text
    .replace(/^\s*(?:assistant|answer|system|user)\s*:\s*/i, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\|im_start\|>[\s\S]*?<\|im_end\|>/g, "")
    .replace(/<\|im_end\|>|<\|endoftext\|>/g, "")
    .replace(/^llama_[^\n]*$/gim, "")
    .replace(/^\[[^\]]+\][^\n]*$/gim, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.startsWith('"') && text.endsWith('"') && text.length > 2) text = text.slice(1, -1).trim();
  return text.slice(0, 6000);
}

export async function runLocalCompletion(options: CompletionOptions): Promise<{ text: string; elapsedMs: number; model: string }> {
  if (!localModelReady()) throw new Error("Local language model is not installed or incomplete.");
  cleanupLlmTemp();
  const tmpDir = join(dataRoot(), "brain", "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const id = randomUUID();
  const promptPath = join(tmpDir, `${id}.prompt.txt`);
  const outputPath = join(tmpDir, `${id}.answer.txt`);
  writeFileSync(promptPath, options.prompt, "utf8");
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 180_000;
  const args = [
    "-m", LLAMA_CHAT_MODEL,
    "-f", promptPath,
    "-o", outputPath,
    "-n", String(Math.min(Math.max(options.maxTokens ?? 240, 32), 512)),
    "-c", "4096",
    "-t", "4",
    "-ngl", "0",
    "--temp", String(Math.min(Math.max(options.temperature ?? 0.25, 0), 1.5)),
    "--top-k", String(Math.min(Math.max(options.topK ?? 20, 0), 100)),
    "--top-p", String(Math.min(Math.max(options.topP ?? 0.9, 0.05), 1)),
    "--min-p", "0",
    "--repeat-penalty", "1.05",
    "-st",
    "--no-display-prompt",
    "--no-show-timings",
    "--log-disable",
    "--simple-io",
    "--offline",
  ];

  try {
    const text = await new Promise<string>((resolve, reject) => {
      const child = spawn(LLAMA_CLI, args, { cwd: LLAMA_BIN_DIR, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          finish();
          child.kill();
          reject(new Error("Local model request timed out."));
        }
      }, timeoutMs);
      const onAbort = () => {
        if (!settled) {
          settled = true;
          finish();
          child.kill();
          reject(new Error("Local model request cancelled."));
        }
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        finish();
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        finish();
        if (code !== 0) {
          reject(new Error(`Local model exited with code ${code}: ${stderr.slice(-600) || stdout.slice(-300)}`));
          return;
        }
        let answer = "";
        try { answer = readFileSync(outputPath, "utf8"); } catch { answer = stdout; }
        resolve(answer);
      });
    });
    return { text: cleanGeneratedText(text), elapsedMs: Date.now() - started, model: "Qwen2.5-1.5B-Instruct Q4_K_M (local)" };
  } finally {
    try { unlinkSync(promptPath); } catch { /* ignore */ }
    try { unlinkSync(outputPath); } catch { /* ignore */ }
  }
}

const embeddingCache = new Map<string, number[]>();
let embeddingProcess: ChildProcess | null = null;
let embeddingEndpoint = "";
let embeddingStart: Promise<string> | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function stopEmbeddingServer(): void {
  if (embeddingProcess && !embeddingProcess.killed) embeddingProcess.kill();
  embeddingProcess = null;
  embeddingEndpoint = "";
}

process.once("exit", stopEmbeddingServer);

async function ensureEmbeddingServer(): Promise<string> {
  if (embeddingEndpoint && embeddingProcess && !embeddingProcess.killed) return embeddingEndpoint;
  if (embeddingStart) return embeddingStart;
  embeddingStart = (async () => {
    const port = await reservePort();
    const args = [
      "-m", LLAMA_EMBED_MODEL,
      "--host", "127.0.0.1",
      "--port", String(port),
      "--pooling", "mean",
      "--embd-normalize", "2",
      "--embeddings",
      "-c", "512",
      "-t", "4",
      "-ngl", "0",
      "--offline",
      "--log-disable",
    ];
    const child = spawn(LLAMA_SERVER, args, { cwd: LLAMA_BIN_DIR, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    embeddingProcess = child;
    child.stderr.on("data", () => { /* consume stderr so the process never blocks */ });
    child.stdout.on("data", () => { /* consume stdout so the process never blocks */ });
    child.once("exit", () => {
      if (embeddingProcess === child) stopEmbeddingServer();
    });
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (child.killed) throw new Error("The local embedding server exited before it was ready.");
      try {
        const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(750) });
        if (health.ok) {
          embeddingEndpoint = base;
          return base;
        }
      } catch { /* not listening yet */ }
      await delay(250);
    }
    stopEmbeddingServer();
    throw new Error("The local embedding server did not become ready in time.");
  })().finally(() => { embeddingStart = null; });
  return embeddingStart;
}

export async function embedWithLocalModel(text: string): Promise<number[] | null> {
  const status = getLocalModelStatus();
  if (!status.embeddingReady) return null;
  // Hash the whole input: a 1200-character prefix cache collided whenever two
  // memories shared a beginning but differed later.
  const input = text.slice(0, 4000);
  const key = createHash("sha256").update(input).digest("hex");
  const cached = embeddingCache.get(key);
  if (cached) return cached;
  const base = await ensureEmbeddingServer();
  const response = await fetch(`${base}/v1/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, model: LOCAL_EMBEDDING_ID }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`Local embedding failed (HTTP ${response.status}).`);
  const payload = await response.json() as { data?: Array<{ embedding?: number[] }> };
  const vector = payload.data?.[0]?.embedding?.filter((value) => Number.isFinite(value)) ?? [];
  if (!vector.length) return null;
  if (embeddingCache.size > 400) embeddingCache.clear();
  embeddingCache.set(key, vector);
  return vector;
}

export function cleanupLlmTemp(): void {
  const tmpDir = join(dataRoot(), "brain", "tmp");
  if (!existsSync(tmpDir)) return;
  try {
    for (const name of readdirSync(tmpDir)) {
      if (name.endsWith(".prompt.txt") || name.endsWith(".answer.txt")) {
        rmSync(join(tmpDir, name), { force: true });
      }
    }
  } catch { /* ignore */ }
}
