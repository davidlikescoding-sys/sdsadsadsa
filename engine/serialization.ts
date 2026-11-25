import { Tensor } from "./tensor";
import { Tokenizer, type TokenizerMode } from "./tokenizer";
import { Transformer, validateConfig, type ModelConfig } from "./transformer";
import type { Adam } from "./optimizer";

export interface ModelSnapshot {
  version: 1;
  config: ModelConfig;
  vocab: string[];
  /** char = legacy character model; word = generative word-level model. */
  tokenizerMode?: TokenizerMode;
  weights: Record<string, string>;
  savedAt: string;
  /** Lifetime optimizer step, so training can continue exactly after a reload. */
  step?: number;
  /** Adam first/second moments, keyed by parameter name. */
  optimizer?: {
    t: number;
    m: Record<string, string>;
    v: Record<string, string>;
  };
}

function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as number[]);
  }
  return btoa(binary);
}

function base64ToFloat32(s: string): Float32Array {
  let binary: string;
  try { binary = atob(s); }
  catch { throw new Error("Checkpoint contains malformed weight data."); }
  if (binary.length % 4 !== 0) throw new Error("Checkpoint weight data has an invalid length.");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function createSnapshot(
  model: Transformer,
  tokenizer: Tokenizer,
  step = 0,
  optimizer?: Adam,
): ModelSnapshot {
  const weights: Record<string, string> = {};
  const names = new Map<Tensor, string>();
  for (const [name, tensor] of model.weights) {
    weights[name] = float32ToBase64(tensor.data);
    names.set(tensor, name);
  }

  let optimizerState: ModelSnapshot["optimizer"];
  if (optimizer) {
    const state = optimizer.exportState(names);
    optimizerState = { t: state.t, m: {}, v: {} };
    for (const [name, arr] of Object.entries(state.m)) optimizerState.m[name] = float32ToBase64(arr);
    for (const [name, arr] of Object.entries(state.v)) optimizerState.v[name] = float32ToBase64(arr);
  }

  return {
    version: 1,
    config: { ...model.config },
    vocab: tokenizer.toJSON(),
    tokenizerMode: tokenizer.mode,
    weights,
    savedAt: new Date().toISOString(),
    step,
    optimizer: optimizerState,
  };
}

export function loadSnapshot(snapshot: ModelSnapshot): { model: Transformer; tokenizer: Tokenizer } {
  if (!snapshot || snapshot.version !== 1) throw new Error("Unsupported checkpoint format.");
  if (!snapshot.config || !snapshot.vocab || !snapshot.weights) throw new Error("Checkpoint is missing required data.");
  const tokenizer = Tokenizer.fromJSON(snapshot.vocab, snapshot.tokenizerMode);
  const config = { ...snapshot.config, vocabSize: snapshot.vocab.length };
  const err = validateConfig(config);
  if (err) throw new Error(`Incompatible checkpoint architecture: ${err}`);
  const model = new Transformer(config, 1);
  const expected = new Set(model.weights.keys());
  for (const name of Object.keys(snapshot.weights)) {
    if (!expected.has(name)) throw new Error(`Checkpoint has an unexpected weight "${name}" (architecture mismatch).`);
  }
  for (const [name, tensor] of model.weights) {
    const encoded = snapshot.weights[name];
    if (!encoded) throw new Error(`Checkpoint is missing weights for "${name}".`);
    const values = base64ToFloat32(encoded);
    if (values.length !== tensor.data.length) throw new Error(`Weight "${name}" has an unexpected size.`);
    tensor.data.set(values);
  }
  return { model, tokenizer };
}

/** Validate an imported snapshot before writing it to local storage. */
export function validateSnapshot(snapshot: unknown): string | null {
  try { loadSnapshot(snapshot as ModelSnapshot); return null; }
  catch (e) { return e instanceof Error ? e.message : String(e); }
}

/** Restore saved Adam moments into a freshly loaded session's optimizer. */
export function restoreOptimizerState(snapshot: ModelSnapshot, model: Transformer, optimizer: Adam): void {
  const state = snapshot.optimizer;
  if (!state || !state.m || !state.v) return;
  const tensors = new Map<string, Tensor>(model.weights);
  const m = new Map<string, Float32Array>();
  const v = new Map<string, Float32Array>();
  for (const [name, encoded] of Object.entries(state.m)) {
    const tensor = tensors.get(name);
    const values = base64ToFloat32(encoded);
    if (tensor && values.length === tensor.data.length) m.set(name, values);
  }
  for (const [name, encoded] of Object.entries(state.v)) {
    const tensor = tensors.get(name);
    const values = base64ToFloat32(encoded);
    if (tensor && values.length === tensor.data.length) v.set(name, values);
  }
  optimizer.importState(state.t, m, v, tensors);
}

export function snapshotSizeBytes(snapshot: ModelSnapshot): number {
  let total = 0;
  for (const v of Object.values(snapshot.weights)) total += Math.floor(v.length * 3 / 4);
  if (snapshot.optimizer) {
    for (const v of Object.values(snapshot.optimizer.m)) total += Math.floor(v.length * 3 / 4);
    for (const v of Object.values(snapshot.optimizer.v)) total += Math.floor(v.length * 3 / 4);
  }
  return total;
}
