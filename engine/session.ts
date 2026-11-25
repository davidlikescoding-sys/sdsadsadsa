import { Adam } from "./optimizer";
import { scale, type Tensor } from "./tensor";
import { Tokenizer } from "./tokenizer";
import { Transformer, generate, generateDetailed, type GenerationOptions, type GenerationResult } from "./transformer";
import { createSnapshot, loadSnapshot, restoreOptimizerState, type ModelSnapshot } from "./serialization";

export interface TrainingData {
  inputs: Int32Array[];
  targets: Int32Array[];
  totalTokens: number;
  samples: number;
}

/**
 * Deterministic learning-rate schedule. Warmup prevents early instability on
 * a fresh model; cosine decay lets the model settle instead of bouncing at a
 * constant high rate. Positions are measured in optimizer steps, so a resumed
 * checkpoint continues the schedule rather than restarting it.
 */
export interface LrSchedule {
  type: "constant" | "cosine";
  warmupSteps: number;
  totalSteps: number;
  /** Fraction of the base learning rate to decay down to (cosine only). */
  minLrRatio: number;
}

/** Multiplier applied to the base learning rate at a given global step. */
export function lrMultiplier(schedule: LrSchedule, step: number): number {
  const warmup = Math.max(0, Math.floor(schedule.warmupSteps));
  if (warmup > 0 && step < warmup) return Math.max(0.01, (step + 1) / warmup);
  if (schedule.type !== "cosine") return 1;
  const total = Math.max(warmup + 1, Math.floor(schedule.totalSteps));
  const progress = Math.min(1, Math.max(0, (step - warmup) / (total - warmup)));
  const min = Math.min(1, Math.max(0, schedule.minLrRatio));
  return min + (1 - min) * 0.5 * (1 + Math.cos(Math.PI * progress));
}

/** Exact number of overlapping windows produced by buildTrainingData for a token count. */
export function countWindows(tokenCount: number, blockSize: number): number {
  if (tokenCount <= blockSize || blockSize < 1) return 0;
  const stride = Math.max(1, Math.floor(blockSize / 2));
  return Math.floor((tokenCount - blockSize - 1) / stride) + 1;
}

export function countCorpusTokens(texts: string[], tokenizer: Tokenizer): number {
  let n = 0;
  for (const text of texts) if (text) n += tokenizer.encode(text).length + 1; // + document separator
  return n;
}

/** Build overlapping next-token-prediction windows from raw text. */
export function buildTrainingData(texts: string[], tokenizer: Tokenizer, blockSize: number): TrainingData {
  const ids: number[] = [];
  for (const text of texts) {
    if (!text) continue;
    const encoded = tokenizer.encode(text);
    for (let i = 0; i < encoded.length; i++) ids.push(encoded[i]);
    // Use EOS, not padding, as the document separator. Padding is a structural
    // artifact used to fill short inference windows; teaching it as a token to
    // emit makes generations bleed into unrelated documents. EOS is the real
    // "this document ended" signal and matches stopOnEos during generation.
    ids.push(tokenizer.eosId >= 0 ? tokenizer.eosId : tokenizer.padId);
  }
  if (ids.length < blockSize + 1) {
    throw new Error(`Not enough training tokens (${ids.length}). Need at least ${blockSize + 1}. Provide a longer dataset or reduce the context length.`);
  }
  const inputs: Int32Array[] = [];
  const targets: Int32Array[] = [];
  const stride = Math.max(1, Math.floor(blockSize / 2));
  for (let start = 0; start + blockSize < ids.length; start += stride) {
    inputs.push(Int32Array.from(ids.slice(start, start + blockSize)));
    targets.push(Int32Array.from(ids.slice(start + 1, start + blockSize + 1)));
  }
  return { inputs, targets, totalTokens: ids.length, samples: inputs.length };
}

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

export class TrainingSession {
  model: Transformer;
  tokenizer: Tokenizer;
  optimizer: Adam;
  data: TrainingData | null = null;
  validationData: TrainingData | null = null;
  step = 0;
  totalLoss = 0;
  lossHistory: { step: number; loss: number }[] = [];
  lastBatchSize = 0;
  lastGradNorm = 0;
  baseLearningRate: number;
  schedule: LrSchedule | null = null;
  private rng: () => number;

  constructor(model: Transformer, tokenizer: Tokenizer, learningRate: number, seed = 1) {
    if (model.config.vocabSize !== tokenizer.size) {
      throw new Error(`Vocabulary mismatch: model expects ${model.config.vocabSize} tokens but tokenizer has ${tokenizer.size}. Reinitialize the model from the selected datasets.`);
    }
    this.model = model;
    this.tokenizer = tokenizer;
    this.baseLearningRate = learningRate;
    this.optimizer = new Adam(model.parameters(), learningRate);
    this.rng = mulberry32(seed);
  }

  configureSchedule(schedule: LrSchedule | null): void {
    this.schedule = schedule;
    this.applyScheduledLr();
  }

  private applyScheduledLr(): void {
    const lr = this.schedule
      ? this.baseLearningRate * lrMultiplier(this.schedule, this.step)
      : this.baseLearningRate;
    this.optimizer.learningRate = lr;
  }

  setData(data: TrainingData): void {
    if (data.samples < 1) throw new Error("Training data contains no samples.");
    this.data = data;
  }

  setValidationData(data: TrainingData | null): void {
    if (data && data.samples < 1) throw new Error("Validation data contains no samples.");
    this.validationData = data;
  }

  /** Real held-out cross-entropy. No gradients and no optimizer update. */
  validationLoss(batchSize: number): number | null {
    const data = this.validationData;
    if (!data || data.samples === 0) return null;
    const n = Math.max(1, Math.min(Math.floor(Number.isFinite(batchSize) ? batchSize : 1), data.samples));
    let total = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(this.rng() * data.samples);
      const { loss } = this.model.forward(data.inputs[idx], data.targets[idx]);
      if (!loss || !Number.isFinite(loss.data[0])) throw new Error("Validation produced a non-finite loss.");
      total += loss.data[0];
    }
    return total / n;
  }

  setLearningRate(lr: number): void {
    if (Number.isFinite(lr) && lr > 0) {
      this.baseLearningRate = lr;
      this.applyScheduledLr();
    }
  }

  setWeightDecay(weightDecay: number): void {
    if (Number.isFinite(weightDecay) && weightDecay >= 0) {
      this.optimizer.weightDecay = weightDecay;
    }
  }

  /** One optimizer update over a random mini-batch. Returns mean cross-entropy loss. */
  trainBatch(batchSize: number, gradientClip: number): number {
    if (!this.data || this.data.samples === 0) throw new Error("No training data has been prepared.");
    const n = Math.max(1, Math.min(Math.floor(Number.isFinite(batchSize) ? batchSize : 1), this.data.samples));
    this.lastBatchSize = n;
    this.model.zeroGrad();
    let total = 0;
    this.model.setTraining(true);
    try {
      for (let i = 0; i < n; i++) {
        const idx = Math.floor(this.rng() * this.data.samples);
        const { loss } = this.model.forward(this.data.inputs[idx], this.data.targets[idx]);
        if (!loss || !Number.isFinite(loss.data[0])) throw new Error("Training produced a non-finite loss. Try a lower learning rate or smaller model.");
        total += loss.data[0];
        scale(loss, 1 / n).backward();
      }
    } finally {
      this.model.setTraining(false);
    }
    this.lastGradNorm = this.optimizer.gradientNorm();
    if (gradientClip > 0 && Number.isFinite(gradientClip)) this.optimizer.clipGradNorm(gradientClip);
    this.optimizer.step();
    const mean = total / n;
    this.step += 1;
    this.applyScheduledLr();
    this.totalLoss = mean;
    this.lossHistory.push({ step: this.step, loss: mean });
    if (this.lossHistory.length > 2000) this.lossHistory.shift();
    return mean;
  }

  snapshot(): ModelSnapshot {
    return createSnapshot(this.model, this.tokenizer, this.step, this.optimizer);
  }

  generate(prompt: string, opts: GenerationOptions): string {
    return generate(this.model, this.tokenizer, prompt, opts);
  }

  generateAsync(prompt: string, opts: GenerationOptions): Promise<GenerationResult> {
    return generateDetailed(this.model, this.tokenizer, prompt, opts);
  }
}

/** Restore a session from a checkpoint snapshot. */
export function sessionFromSnapshot(snapshot: ModelSnapshot, learningRate: number, seed = 1): TrainingSession {
  const { model, tokenizer } = loadSnapshot(snapshot);
  const session = new TrainingSession(model, tokenizer, learningRate, seed);
  const savedStep = snapshot.step ?? 0;
  session.step = Number.isFinite(savedStep) ? Math.max(0, Math.floor(savedStep)) : 0;
  restoreOptimizerState(snapshot, model, session.optimizer);
  return session;
}

export function tensorNorm(t: Tensor): number {
  let s = 0;
  for (let i = 0; i < t.data.length; i++) s += t.data[i] * t.data[i];
  return Math.sqrt(s);
}
