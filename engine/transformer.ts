import {
  Tensor, add, applyCausalMask, crossEntropy, dropout, embedding, layernorm, matmul,
  relu, scale, softmax,
} from "./tensor";
import type { Tokenizer } from "./tokenizer";

export interface ModelConfig {
  layers: number;
  heads: number;
  dModel: number;
  blockSize: number;
  vocabSize: number;
  dFF: number;
  /** Optional residual dropout probability. Defaults to 0 for backward compatibility. */
  dropout?: number;
}

export const DEFAULT_CONFIG: Omit<ModelConfig, "vocabSize"> = {
  layers: 1,
  heads: 2,
  dModel: 32,
  blockSize: 64,
  dFF: 128,
  dropout: 0,
};

export function validateConfig(c: Partial<ModelConfig>): string | null {
  if (!Number.isInteger(c.layers) || c.layers! < 1 || c.layers! > 4) return "Layers must be an integer from 1 to 4.";
  if (!Number.isInteger(c.heads) || c.heads! < 1 || c.heads! > 8) return "Attention heads must be an integer from 1 to 8.";
  if (!Number.isInteger(c.dModel) || c.dModel! < 4 || c.dModel! > 256) return "Hidden dimension must be an integer from 4 to 256.";
  if (c.dModel! % c.heads! !== 0) return "Hidden dimension must be divisible by the number of attention heads.";
  if (!Number.isInteger(c.blockSize) || c.blockSize! < 4 || c.blockSize! > 256) return "Context length must be an integer from 4 to 256.";
  if (!Number.isInteger(c.dFF) || c.dFF! < c.dModel!) return "Feed-forward dimension must be at least the hidden dimension.";
  if (!Number.isInteger(c.vocabSize) || c.vocabSize! < 2) return "Vocabulary must contain at least 2 tokens.";
  if (c.dropout !== undefined && (!Number.isFinite(c.dropout) || c.dropout < 0 || c.dropout >= 1)) {
    return "Dropout must be between 0 (off) and 0.9.";
  }
  return null;
}

export function estimateParams(c: ModelConfig): number {
  const { layers: L, dModel: C, dFF: F, blockSize: T, vocabSize: V } = c;
  const perLayer = 4 * C * C + 4 * C + 2 * C * F + F + C;
  return V * C + T * C + L * perLayer + 2 * C + C * V;
}

/** Seeded PRNG keeps initialization deterministic for tests and reproducibility. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function xavier(fanIn: number, fanOut: number, rng: () => number): Float32Array {
  const limit = Math.sqrt(6 / (fanIn + fanOut));
  const d = new Float32Array(fanIn * fanOut);
  for (let i = 0; i < d.length; i++) d[i] = (rng() * 2 - 1) * limit;
  return d;
}

export class Transformer {
  readonly config: ModelConfig;
  readonly weights = new Map<string, Tensor>();
  private paramCache: Tensor[] | null = null;
  private training = false;
  private dropoutRng: () => number;

  constructor(config: ModelConfig, seed = Math.floor(Math.random() * 2 ** 31)) {
    const err = validateConfig(config);
    if (err) throw new Error(err);
    this.config = { ...config, dropout: config.dropout ?? 0 };
    this.dropoutRng = mulberry32((seed ^ 0x9e3779b9) >>> 0);

    const rng = mulberry32(seed);
    const { layers, heads, dModel: C, blockSize: T, dFF: F, vocabSize: V } = config;
    const hs = C / heads;
    void hs;

    const embed = new Float32Array(V * C);
    for (let i = 0; i < embed.length; i++) embed[i] = gaussian(rng) * 0.02;
    this.weights.set("tokEmb", new Tensor(embed, [V, C], { leaf: true, label: "tokEmb" }));

    const pos = new Float32Array(T * C);
    for (let i = 0; i < pos.length; i++) pos[i] = gaussian(rng) * 0.02;
    this.weights.set("posEmb", new Tensor(pos, [T, C], { leaf: true, label: "posEmb" }));

    for (let l = 0; l < layers; l++) {
      const p = `l${l}.`;
      this.weights.set(p + "wq", new Tensor(xavier(C, C, rng), [C, C], { leaf: true, label: p + "wq" }));
      this.weights.set(p + "wk", new Tensor(xavier(C, C, rng), [C, C], { leaf: true, label: p + "wk" }));
      this.weights.set(p + "wv", new Tensor(xavier(C, C, rng), [C, C], { leaf: true, label: p + "wv" }));
      this.weights.set(p + "wo", new Tensor(xavier(C, C, rng), [C, C], { leaf: true, label: p + "wo" }));
      this.weights.set(p + "g1", new Tensor(new Float32Array(C).fill(1), [C], { leaf: true, label: p + "g1" }));
      this.weights.set(p + "b1", new Tensor(new Float32Array(C), [C], { leaf: true, label: p + "b1" }));
      this.weights.set(p + "g2", new Tensor(new Float32Array(C).fill(1), [C], { leaf: true, label: p + "g2" }));
      this.weights.set(p + "b2", new Tensor(new Float32Array(C), [C], { leaf: true, label: p + "b2" }));
      this.weights.set(p + "w1", new Tensor(xavier(C, F, rng), [C, F], { leaf: true, label: p + "w1" }));
      this.weights.set(p + "f1", new Tensor(new Float32Array(F), [F], { leaf: true, label: p + "f1" }));
      this.weights.set(p + "w2", new Tensor(xavier(F, C, rng), [F, C], { leaf: true, label: p + "w2" }));
      this.weights.set(p + "f2", new Tensor(new Float32Array(C), [C], { leaf: true, label: p + "f2" }));
    }

    this.weights.set("lnG", new Tensor(new Float32Array(C).fill(1), [C], { leaf: true, label: "lnG" }));
    this.weights.set("lnB", new Tensor(new Float32Array(C), [C], { leaf: true, label: "lnB" }));
    this.weights.set("wOut", new Tensor(xavier(C, V, rng), [C, V], { leaf: true, label: "wOut" }));
  }

  parameters(): Tensor[] {
    if (!this.paramCache) this.paramCache = Array.from(this.weights.values());
    return this.paramCache;
  }

  zeroGrad(): void {
    for (const p of this.parameters()) p.zeroGrad();
  }

  /** Enable dropout for training forward passes; disable it for inference. */
  setTraining(value: boolean): void {
    this.training = value;
  }

  /** Forward pass over N = B*T flat token ids. Returns logits [N, V] and optional loss. */
  /**
   * `lastLogitsOnly` is for autoregressive inference: the transformer layers
   * still process the whole causal window, but the large vocabulary projection
   * is applied only to the final position. Generation needs one next-token
   * distribution, so projecting all `blockSize` positions wastes work linear in
   * the context length on the biggest matrix multiply in the model.
   */
  forward(
    inputs: Int32Array,
    targets?: Int32Array,
    options?: { lastLogitsOnly?: boolean },
  ): { logits: Tensor; loss?: Tensor; attn?: Tensor } {
    const { layers, heads, dModel: C, blockSize: T, vocabSize: V } = this.config;
    const dropRate = this.config.dropout ?? 0;
    const N = inputs.length;
    if (N === 0) throw new Error("forward: empty input");
    if (N % T !== 0) throw new Error(`forward: ${N} tokens is not a multiple of context length ${T}`);
    const B = N / T;
    const hs = C / heads;
    if (!Number.isInteger(hs)) throw new Error("forward: hidden dimension not divisible by heads");

    const positions = new Int32Array(N);
    for (let b = 0; b < B; b++) for (let t = 0; t < T; t++) positions[b * T + t] = t;

    let x = add(
      embedding(this.weights.get("tokEmb")!, inputs),
      embedding(this.weights.get("posEmb")!, positions),
    );

    let lastAttn: Tensor | undefined;
    for (let l = 0; l < layers; l++) {
      const p = `l${l}.`;
      const W = (k: string) => this.weights.get(p + k)!;

      const xNorm1 = layernorm(x, W("g1"), W("b1"));

      const q = matmul(xNorm1, W("wq")).view([B, T, heads, hs]).transpose(1, 2).view([B * heads, T, hs]);
      const k = matmul(xNorm1, W("wk")).view([B, T, heads, hs]).transpose(1, 2).view([B * heads, T, hs]);
      const v = matmul(xNorm1, W("wv")).view([B, T, heads, hs]).transpose(1, 2).view([B * heads, T, hs]);

      const scores = scale(matmul(q, k.transposeLast2()), 1 / Math.sqrt(hs));
      const masked = applyCausalMask(scores);
      const probs = softmax(masked, -1);
      if (l === layers - 1) lastAttn = probs;

      const attnOut = matmul(probs, v)
        .view([B, heads, T, hs]).transpose(1, 2).view([N, C]);
      x = add(x, dropout(matmul(attnOut, W("wo")), dropRate, this.dropoutRng, this.training));

      const xNorm2 = layernorm(x, W("g2"), W("b2"));
      const hidden = relu(add(matmul(xNorm2, W("w1")), W("f1")));
      const ffOut = add(matmul(hidden, W("w2")), W("f2"));
      x = add(x, dropout(ffOut, dropRate, this.dropoutRng, this.training));
    }

    const y = layernorm(x, this.weights.get("lnG")!, this.weights.get("lnB")!);
    if (options?.lastLogitsOnly) {
      const last = new Tensor(y.data.slice((N - 1) * C), [1, C]);
      return { logits: matmul(last, this.weights.get("wOut")!) };
    }
    const logits = matmul(y, this.weights.get("wOut")!);
    const loss = targets ? crossEntropy(logits, targets) : undefined;
    return { logits, loss, attn: lastAttn };
  }
}

export interface GenerationOptions {
  maxTokens: number;
  temperature: number;
  topK?: number;
  /** Nucleus sampling: keep the smallest set of tokens whose probability sums to topP. */
  topP?: number;
  /** Penalise tokens that already appeared, >1 reduces repetition. 1 disables it. */
  repetitionPenalty?: number;
  seed?: number;
  /** Cancel a long generation from the UI. */
  signal?: AbortSignal;
  /** Stop when the model samples the dedicated end-of-sequence token. */
  stopOnEos?: boolean;
  onProgress?: (partialText: string, tokenCount: number) => void;
}

export interface GenerationResult {
  text: string;
  tokensGenerated: number;
  elapsedMs: number;
  tokensPerSecond: number;
  stoppedEarly: boolean;
}

function seededRng(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeOptions(opts: GenerationOptions) {
  const maxTokens = Number.isFinite(opts.maxTokens) ? Math.max(1, Math.min(Math.floor(opts.maxTokens), 512)) : 120;
  const temperature = Number.isFinite(opts.temperature) ? Math.max(0.01, Math.min(opts.temperature, 2)) : 0.8;
  const topK = Number.isFinite(opts.topK) ? Math.max(0, Math.floor(opts.topK!)) : 0;
  const topP = Number.isFinite(opts.topP) ? Math.max(0, Math.min(opts.topP!, 1)) : 1;
  const repetitionPenalty = Number.isFinite(opts.repetitionPenalty)
    ? Math.max(1, Math.min(opts.repetitionPenalty!, 3)) : 1;
  return { maxTokens, temperature, topK, topP, repetitionPenalty };
}

/** Tokens that cannot appear in readable output are masked before sampling. */
function bannedTokens(tokenizer: Tokenizer, allowEos: boolean): Set<number> {
  const banned = new Set<number>([tokenizer.padId]);
  if (tokenizer.unkId >= 0) banned.add(tokenizer.unkId);
  if (!allowEos && tokenizer.eosId >= 0) banned.add(tokenizer.eosId);
  return banned;
}

/**
 * Real nucleus sampling with an optional frequency penalty. Both operate on
 * the model's own logits; no tokens are injected from outside the network.
 */
function sampleIndex(
  row: Float32Array,
  V: number,
  temperature: number,
  topK: number,
  topP: number,
  repetitionPenalty: number,
  recent: Set<number>,
  rng: () => number,
  banned: Set<number> = new Set(),
): number {
  const logits = new Float64Array(V);
  let maxLogit = -Infinity;
  for (let i = 0; i < V; i++) {
    if (banned.has(i)) { logits[i] = -Infinity; continue; }
    let value = row[i];
    if (repetitionPenalty > 1 && recent.has(i)) {
      value = value > 0 ? value / repetitionPenalty : value * repetitionPenalty;
    }
    logits[i] = value;
    if (value > maxLogit) maxLogit = value;
  }
  const allowed = Array.from({ length: V }, (_, i) => i).filter((i) => !banned.has(i));
  if (!allowed.length) return 0;
  if (temperature <= 0.02) {
    let best = allowed[0];
    for (const i of allowed) if (logits[i] > logits[best]) best = i;
    return best;
  }
  let candidates: number[];
  if (topK > 0 && topK < allowed.length) {
    candidates = allowed.slice().sort((a, b) => logits[b] - logits[a]).slice(0, topK);
  } else {
    candidates = allowed;
  }
  const weights = new Float64Array(candidates.length);
  for (let i = 0; i < candidates.length; i++) {
    weights[i] = Math.exp((logits[candidates[i]] - maxLogit) / temperature);
  }
  if (topP > 0 && topP < 1 && candidates.length > 1) {
    const order = Array.from({ length: candidates.length }, (_, i) => i)
      .sort((a, b) => weights[b] - weights[a]);
    let cumulative = 0;
    const keep: number[] = [];
    for (const index of order) {
      keep.push(index);
      cumulative += weights[index];
      if (cumulative >= topP) break;
    }
    candidates = keep.map((index) => candidates[index]);
  }
  let sum = 0;
  for (let i = 0; i < candidates.length; i++) {
    weights[i] = Math.exp((logits[candidates[i]] - maxLogit) / temperature);
    sum += weights[i];
  }
  if (!(sum > 0) || !Number.isFinite(sum)) return candidates[0];
  let r = rng() * sum;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

function initialContext(model: Transformer, tokenizer: Tokenizer, prompt: string): number[] {
  if (model.config.vocabSize !== tokenizer.size) {
    throw new Error(`Vocabulary mismatch: model expects ${model.config.vocabSize} tokens but tokenizer has ${tokenizer.size}.`);
  }
  const ids = Array.from(tokenizer.encode(prompt));
  return ids.length ? ids : [tokenizer.padId];
}

/** Sample from the model's own predicted distribution. Never uses canned text. */
export function generate(model: Transformer, tokenizer: Tokenizer, prompt: string, opts: GenerationOptions): string {
  const { blockSize: T, vocabSize: V } = model.config;
  const { maxTokens, temperature, topK, topP, repetitionPenalty } = normalizeOptions(opts);
  const rng = seededRng(opts.seed);
  const context = initialContext(model, tokenizer, prompt);
  const generated: number[] = [];
  // Unknown/padding tokens never produce readable text. Excluding them from
  // sampling is standard decoding hygiene, not injected content. EOS stays
  // available only when the caller wants clean document stops.
  const banned = bannedTokens(tokenizer, opts.stopOnEos === true);

  for (let step = 0; step < maxTokens; step++) {
    const window = context.slice(-T);
    while (window.length < T) window.unshift(tokenizer.padId);
    const { logits } = model.forward(Int32Array.from(window), undefined, { lastLogitsOnly: true });
    const recent = new Set(context.slice(-64));
    const next = sampleIndex(logits.data.subarray(0, V), V, temperature, topK, topP, repetitionPenalty, recent, rng, banned);
    if (opts.stopOnEos && next === tokenizer.eosId) break;
    generated.push(next);
    context.push(next);
  }
  return tokenizer.decode(generated);
}

/** Chunked async generation: yields to the browser so Stop stays responsive. */
export async function generateDetailed(model: Transformer, tokenizer: Tokenizer, prompt: string, opts: GenerationOptions): Promise<GenerationResult> {
  const startedAt = Date.now();
  const { blockSize: T, vocabSize: V } = model.config;
  const { maxTokens, temperature, topK, topP, repetitionPenalty } = normalizeOptions(opts);
  const rng = seededRng(opts.seed);
  const context = initialContext(model, tokenizer, prompt);
  const generated: number[] = [];
  const banned = bannedTokens(tokenizer, opts.stopOnEos === true);
  let stoppedEarly = false;

  for (let step = 0; step < maxTokens; step++) {
    if (opts.signal?.aborted) { stoppedEarly = true; break; }
    // Yielding every token is dominated by timer clamping in background tabs;
    // 16 tokens still keeps Stop responsive without adding seconds of idle time.
    if (step > 0 && step % 16 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (opts.signal?.aborted) { stoppedEarly = true; break; }
    }
    const window = context.slice(-T);
    while (window.length < T) window.unshift(tokenizer.padId);
    const { logits } = model.forward(Int32Array.from(window), undefined, { lastLogitsOnly: true });
    const recent = new Set(context.slice(-64));
    const next = sampleIndex(logits.data.subarray(0, V), V, temperature, topK, topP, repetitionPenalty, recent, rng, banned);
    if (opts.stopOnEos && next === tokenizer.eosId) { stoppedEarly = true; break; }
    generated.push(next);
    context.push(next);
    if (generated.length % 4 === 0) opts.onProgress?.(tokenizer.decode(generated), generated.length);
  }

  const elapsedMs = Math.max(1, Date.now() - startedAt);
  return {
    text: tokenizer.decode(generated),
    tokensGenerated: generated.length,
    elapsedMs,
    tokensPerSecond: (generated.length * 1000) / elapsedMs,
    stoppedEarly,
  };
}

/**
 * Mean log-likelihood of an answer under the model's own weights, teacher-forced
 * after the prompt. This is a real forward pass (no sampling, no canned text)
 * and is used to rank grounded answer candidates. Higher is better.
 */
export function scoreAnswer(
  model: Transformer,
  tokenizer: Tokenizer,
  prompt: string,
  answer: string,
  maxAnswerTokens = 96,
): number {
  if (model.config.vocabSize !== tokenizer.size) {
    throw new Error(`Vocabulary mismatch: model expects ${model.config.vocabSize} tokens but tokenizer has ${tokenizer.size}.`);
  }
  const answerIds = Array.from(tokenizer.encode(answer)).slice(0, Math.max(1, maxAnswerTokens));
  if (!answerIds.length) return -Infinity;

  const { blockSize: T, vocabSize: V } = model.config;
  const prefix = Array.from(tokenizer.encode(prompt)).slice(-Math.max(1, T - 1));
  const sequence = [...prefix, ...answerIds];

  const windows: number[] = [];
  for (let i = 0; i < answerIds.length; i++) {
    const end = prefix.length + i; // index of the token being predicted
    const window = sequence.slice(Math.max(0, end - T), end);
    while (window.length < T) window.unshift(tokenizer.padId);
    for (const id of window) windows.push(id);
  }

  const { logits } = model.forward(Int32Array.from(windows));
  let total = 0;
  for (let b = 0; b < answerIds.length; b++) {
    const base = (b * T + (T - 1)) * V;
    const row = logits.data.subarray(base, base + V);
    let max = -Infinity;
    for (let v = 0; v < V; v++) if (row[v] > max) max = row[v];
    let sum = 0;
    for (let v = 0; v < V; v++) sum += Math.exp(row[v] - max);
    const logP = row[answerIds[b]] - max - Math.log(Math.max(sum, 1e-12));
    total += Number.isFinite(logP) ? logP : -20;
  }
  return total / answerIds.length;
}
