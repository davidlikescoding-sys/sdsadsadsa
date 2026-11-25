import { describe, it, expect } from "vitest";
import {
  Tensor, add, matmul, layernorm, crossEntropy, relu, softmax, scale,
  embedding,
} from "./tensor";
import { Tokenizer } from "./tokenizer";
import {
  Transformer, generate, generateDetailed, estimateParams, scoreAnswer, validateConfig, DEFAULT_CONFIG,
  type ModelConfig,
} from "./transformer";
import { Adam } from "./optimizer";
import { createSnapshot, loadSnapshot, validateSnapshot, type ModelSnapshot } from "./serialization";
import { buildTrainingData, countCorpusTokens, countWindows, TrainingSession, sessionFromSnapshot, lrMultiplier } from "./session";

function valueOf(f: () => Tensor): number {
  const t = f();
  let s = 0;
  for (let i = 0; i < t.data.length; i++) s += t.data[i];
  return s;
}

function numericalGradient(f: () => Tensor, param: Tensor, eps = 1e-3): Float32Array {
  const orig = new Float32Array(param.data);
  const out = new Float32Array(orig.length);
  for (let i = 0; i < orig.length; i++) {
    param.data[i] = orig[i] + eps;
    const plus = valueOf(f);
    param.data[i] = orig[i] - eps;
    const minus = valueOf(f);
    param.data[i] = orig[i];
    out[i] = (plus - minus) / (2 * eps);
  }
  return out;
}

function compare(a: Float32Array, b: Float32Array, label: string, tol = 2e-2): void {
  expect(a.length).toBe(b.length);
  let maxAbs = 0;
  for (let i = 0; i < a.length; i++) maxAbs = Math.max(maxAbs, Math.abs(a[i] - b[i]));
  if (maxAbs > tol) {
    const idx = Array.from(a).findIndex((_, i) => Math.abs(a[i] - b[i]) > tol);
    throw new Error(`${label}: max diff ${maxAbs.toFixed(6)} at ${idx} (analytic ${a[idx]}, numeric ${b[idx]})`);
  }
}

function tinyConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return { ...DEFAULT_CONFIG, layers: 1, heads: 2, dModel: 8, blockSize: 4, vocabSize: 12, dFF: 16, ...overrides };
}

describe("Tokenizer", () => {
  it("round-trips text and builds a vocabulary from the dataset", () => {
    const tok = Tokenizer.build(["hello world", "hello again"]);
    expect(tok.size).toBeGreaterThan(20);
    const encoded = tok.encode("hello");
    expect(encoded.length).toBe(5);
    expect(tok.decode(encoded)).toBe("hello");
    expect(tok.encode("").length).toBe(0);
  });

  it("reserves pad, unknown and end-of-sequence ids and never emits them as text", () => {
    const tok = Tokenizer.build(["hello"]);
    expect(tok.vocab.slice(0, 3)).toEqual(["<pad>", "<unk>", "</s>"]);
    expect(tok.padId).toBe(0);
    expect(tok.unkId).toBe(1);
    expect(tok.eosId).toBe(2);
    expect(Array.from(tok.encode("€"))).toEqual([1]); // unknown maps to <unk>, never shifts ids
    expect(tok.decode(Int32Array.from([0, 1, 2, tok.charToId.get("h")!]))).toBe("h");
    const roundTrip = Tokenizer.fromJSON(JSON.parse(JSON.stringify(tok.toJSON())));
    expect(roundTrip.vocab).toEqual(tok.vocab);
    expect(roundTrip.eosId).toBe(2);
  });
});

describe("Tensor operations", () => {
  it("matmul forward is correct", () => {
    const a = Tensor.fromArray([2, 3], [1, 2, 3, 4, 5, 6]);
    const b = Tensor.fromArray([3, 2], [7, 8, 9, 10, 11, 12]);
    const c = matmul(a, b);
    expect(c.shape).toEqual([2, 2]);
    expect(Array.from(c.data)).toEqual([58, 64, 139, 154]);
  });

  it("matmul gradients match numerical gradients", () => {
    const a = Tensor.fromArray([2, 2], [0.1, -0.2, 0.3, 0.4], { leaf: true });
    const b = Tensor.fromArray([2, 2], [0.5, 0.6, -0.7, 0.8], { leaf: true });
    const f = () => {
      a.zeroGrad(); b.zeroGrad();
      const loss = scale(matmul(a, b), 0.1);
      loss.backward();
      return loss;
    };
    const numericA = numericalGradient(() => scale(matmul(a, b), 0.1), a);
    const numericB = numericalGradient(() => scale(matmul(a, b), 0.1), b);
    const loss = f();
    void loss;
    compare(a.grad!, numericA, "matmul dA");
    compare(b.grad!, numericB, "matmul dB");
  });

  it("broadcast add gradients accumulate correctly", () => {
    const a = Tensor.fromArray([2, 2], [1, 2, 3, 4], { leaf: true });
    const bias = Tensor.fromArray([2], [0.5, -0.5], { leaf: true });
    const f = () => {
      a.zeroGrad(); bias.zeroGrad();
      const loss = scale(add(a, bias), 0.25);
      loss.backward();
      return loss;
    };
    const nA = numericalGradient(() => scale(add(a, bias), 0.25), a);
    const nB = numericalGradient(() => scale(add(a, bias), 0.25), bias);
    f();
    compare(a.grad!, nA, "add dA");
    compare(bias.grad!, nB, "add dbias");
  });

  it("layernorm gradients match numerical gradients", () => {
    const x = Tensor.fromArray([2, 3], [0.2, -0.5, 1.1, -0.3, 0.7, 0.0], { leaf: true });
    const g = Tensor.fromArray([3], [1.2, 0.8, -0.4], { leaf: true });
    const b = Tensor.fromArray([3], [0.1, -0.2, 0.3], { leaf: true });
    const f = () => {
      x.zeroGrad(); g.zeroGrad(); b.zeroGrad();
      const loss = scale(layernorm(x, g, b), 0.3);
      loss.backward();
      return loss;
    };
    const nX = numericalGradient(() => scale(layernorm(x, g, b), 0.3), x);
    const nG = numericalGradient(() => scale(layernorm(x, g, b), 0.3), g);
    const nB = numericalGradient(() => scale(layernorm(x, g, b), 0.3), b);
    f();
    compare(x.grad!, nX, "layernorm dx");
    compare(g.grad!, nG, "layernorm dgamma");
    compare(b.grad!, nB, "layernorm dbeta");
  });

  it("cross-entropy and softmax integrate correctly", () => {
    const logits = Tensor.fromArray([2, 3], [2, 1, 0.1, 0.5, 3, -1], { leaf: true });
    const loss = crossEntropy(logits, Int32Array.from([0, 1]));
    expect(loss.data[0]).toBeGreaterThan(0);
    loss.backward();
    expect(logits.grad).not.toBeNull();
    let sum = 0;
    for (let n = 0; n < 2; n++) {
      let rowSum = 0;
      for (let v = 0; v < 3; v++) rowSum += logits.grad![n * 3 + v];
      sum += rowSum;
    }
    expect(Math.abs(sum)).toBeLessThan(1e-5);
  });

  it("causal masking prevents future tokens from influencing earlier logits", () => {
    const cfg = tinyConfig({ layers: 1, heads: 1, dModel: 4, blockSize: 4, vocabSize: 6, dFF: 8 });
    const model = new Transformer(cfg, 42);
    const ids = Int32Array.from([1, 2, 3, 4]);
    const a = model.forward(ids).logits;
    const changed = Int32Array.from([1, 2, 3, 5]);
    const b = model.forward(changed).logits;
    // position 0 and 1 predictions must be identical; position 2 must change.
    for (let pos = 0; pos < 2; pos++) {
      for (let v = 0; v < cfg.vocabSize; v++) {
        expect(a.data[pos * cfg.vocabSize + v]).toBeCloseTo(b.data[pos * cfg.vocabSize + v], 4);
      }
    }
    expect(Math.abs(a.data[3 * cfg.vocabSize] - b.data[3 * cfg.vocabSize])).toBeGreaterThan(1e-6);
  });

  it("lastLogitsOnly matches the final row of a full forward pass", () => {
    const cfg = tinyConfig({ layers: 2, heads: 1, dModel: 4, blockSize: 4, vocabSize: 6, dFF: 8 });
    const model = new Transformer(cfg, 42);
    const ids = Int32Array.from([1, 2, 3, 4]);
    const full = model.forward(ids).logits;
    const last = model.forward(ids, undefined, { lastLogitsOnly: true }).logits;
    expect(last.shape).toEqual([1, cfg.vocabSize]);
    for (let v = 0; v < cfg.vocabSize; v++) {
      expect(last.data[v]).toBeCloseTo(full.data[(cfg.blockSize - 1) * cfg.vocabSize + v], 5);
    }
  });

  it("relu, softmax and embedding have valid gradients", () => {
    const x = Tensor.fromArray([4], [0.5, -1, 2, 0], { leaf: true });
    relu(x).backward();
    expect(Array.from(x.grad!)).toEqual([1, 0, 1, 0]);
    const table = Tensor.fromArray([3, 2], [1, 2, 3, 4, 5, 6], { leaf: true });
    embedding(table, Int32Array.from([2, 0])).backward();
    expect(Array.from(table.grad!)).toEqual([1, 1, 0, 0, 1, 1]);
  });
});

describe("Transformer", () => {
  it("forward produces the expected shapes and finite values", () => {
    const cfg = tinyConfig();
    const model = new Transformer(cfg, 7);
    const ids = Int32Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const targets = Int32Array.from([2, 3, 4, 5, 6, 7, 8, 1]);
    const { logits, loss, attn } = model.forward(ids, targets);
    expect(logits.shape).toEqual([8, cfg.vocabSize]);
    expect(loss).toBeDefined();
    expect(Number.isFinite(loss!.data[0])).toBe(true);
    expect(attn!.shape).toEqual([cfg.heads * 2, cfg.blockSize, cfg.blockSize]);
  });

  it("parameter count estimate matches the real model", () => {
    const cfg = tinyConfig();
    const model = new Transformer(cfg, 1);
    const actual = model.parameters().reduce((n, p) => n + p.data.length, 0);
    expect(estimateParams(cfg)).toBe(actual);
  });

  it("rejects invalid configurations", () => {
    expect(validateConfig({ ...tinyConfig(), dModel: 7, heads: 2 })).toContain("divisible");
    expect(validateConfig({ ...tinyConfig(), layers: 0 })).toContain("Layers");
    expect(validateConfig({ ...tinyConfig(), heads: 9 })).toContain("heads");
  });

  it("backpropagation through the full model matches numerical gradients", () => {
    const cfg = tinyConfig({ layers: 1, heads: 1, dModel: 4, blockSize: 4, vocabSize: 5, dFF: 8 });
    const model = new Transformer(cfg, 3);
    const ids = Int32Array.from([0, 1, 2, 3]);
    const targets = Int32Array.from([1, 2, 3, 4]);
    const param = model.weights.get("l0.wq")!;
    const f = () => {
      model.zeroGrad();
      const loss = model.forward(ids, targets).loss!;
      loss.backward();
      return loss;
    };
    const numeric = numericalGradient(() => model.forward(ids, targets).loss!, param, 1e-3);
    f();
    compare(param.grad!, numeric, "transformer dWq", 3e-2);
  });

  it("Adam updates parameters and reduces loss on a tiny dataset", () => {
    const cfg = tinyConfig({ layers: 1, heads: 2, dModel: 8, blockSize: 4, vocabSize: 12, dFF: 16 });
    const tok = Tokenizer.build(["abababababababababab"]);
    cfg.vocabSize = tok.size;
    const model = new Transformer(cfg, 11);
    const data = buildTrainingData(["abababababababababababab"], tok, cfg.blockSize);
    const session = new TrainingSession(model, tok, 0.01);
    session.setData(data);
    const before = model.forward(data.inputs[0], data.targets[0]).loss!.data[0];
    const wBefore = new Float32Array(model.weights.get("tokEmb")!.data);
    for (let i = 0; i < 60; i++) session.trainBatch(4, 1);
    const after = model.forward(data.inputs[0], data.targets[0]).loss!.data[0];
    const wAfter = model.weights.get("tokEmb")!.data;
    let changed = 0;
    for (let i = 0; i < wBefore.length; i++) if (Math.abs(wBefore[i] - wAfter[i]) > 1e-7) changed++;
    expect(changed).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });

  it("generation uses model weights, respects limits, and samples deterministically", async () => {
    const cfg = tinyConfig();
    const tok = Tokenizer.build(["hello world hello world"]);
    cfg.vocabSize = tok.size;
    const model = new Transformer(cfg, 5);
    const detailed = await generateDetailed(model, tok, "he", {
      maxTokens: 20, temperature: 0.8, seed: 1, stopOnEos: false,
    });
    expect(detailed.tokensGenerated).toBe(20);
    expect(detailed.elapsedMs).toBeGreaterThan(0);
    expect(detailed.tokensPerSecond).toBeGreaterThan(0);
    for (const ch of detailed.text) expect(tok.vocab).toContain(ch);

    const greedy = generate(model, tok, "he", { maxTokens: 10, temperature: 0, seed: 1 });
    const topKOne = await generateDetailed(model, tok, "he", {
      maxTokens: 10, temperature: 0.8, topK: 1, seed: 1, stopOnEos: false,
    });
    expect(topKOne.text).toBe(greedy);

    const stopped = await generateDetailed(model, tok, "he", {
      maxTokens: 20, temperature: 0.8, seed: 1, stopOnEos: true,
    });
    expect(stopped.tokensGenerated).toBeLessThanOrEqual(20);
  });

  it("never samples padding or unknown tokens into readable output", () => {
    const cfg = tinyConfig();
    const tok = Tokenizer.build(["alpha beta gamma", "delta epsilon"]);
    cfg.vocabSize = tok.size;
    const model = new Transformer(cfg, 101);
    for (const stopOnEos of [false, true]) {
      for (let seed = 0; seed < 5; seed++) {
        const out = generate(model, tok, "al", {
          maxTokens: 20, temperature: 1.2, topP: 1, seed, stopOnEos,
        });
        for (const special of ["<pad>", "<unk>", "</s>"]) {
          expect(out).not.toContain(special);
        }
      }
    }
  });

  it("nucleus sampling and repetition penalty stay within the model vocabulary", async () => {
    const cfg = tinyConfig();
    const tok = Tokenizer.build(["alpha beta gamma delta alpha beta"]);
    cfg.vocabSize = tok.size;
    const model = new Transformer(cfg, 17);
    for (const [topP, repetitionPenalty] of [[0.5, 1], [0.9, 1.3], [1, 2]] as const) {
      const out = await generateDetailed(model, tok, "al", {
        maxTokens: 12, temperature: 0.9, topP, repetitionPenalty, seed: 3, stopOnEos: false,
      });
      expect(out.tokensGenerated).toBe(12);
      for (const ch of out.text) expect(tok.vocab).toContain(ch);
    }
  });
});

describe("Dropout", () => {
  it("is a no-op at inference, so eval logits match a model without dropout", () => {
    const cfg = tinyConfig();
    const ids = Int32Array.from([1, 2, 3, 4]);
    const plain = new Transformer(cfg, 5);
    const withDropout = new Transformer({ ...cfg, dropout: 0.5 }, 5);
    const a = plain.forward(ids).logits;
    const b = withDropout.forward(ids).logits; // default mode is eval
    for (let i = 0; i < a.data.length; i++) expect(b.data[i]).toBeCloseTo(a.data[i], 5);
  });

  it("applies a mask during training and still produces finite gradients", () => {
    const cfg = tinyConfig({ dropout: 0.5 });
    const model = new Transformer(cfg, 7);
    const ids = Int32Array.from([1, 2, 3, 4]);
    const targets = Int32Array.from([2, 3, 4, 5]);
    model.setTraining(true);
    const { loss } = model.forward(ids, targets);
    loss!.backward();
    for (const p of model.parameters()) {
      expect(p.grad).not.toBeNull();
      for (const g of p.grad!) expect(Number.isFinite(g)).toBe(true);
    }
    model.setTraining(false);
  });

  it("defaults to zero when loading an older config without a dropout field", () => {
    const legacy = { layers: 1, heads: 2, dModel: 8, blockSize: 4, vocabSize: 12, dFF: 16 } as ModelConfig;
    expect(validateConfig(legacy)).toBeNull();
    const model = new Transformer(legacy, 3);
    expect(model.config.dropout).toBe(0);
  });
});

describe("Learning-rate schedule", () => {
  it("warms up linearly then decays cosine without exceeding the base rate", () => {
    const schedule = { type: "cosine" as const, warmupSteps: 10, totalSteps: 110, minLrRatio: 0.1 };
    expect(lrMultiplier(schedule, 0)).toBeCloseTo(0.1, 5);
    expect(lrMultiplier(schedule, 5)).toBeCloseTo(0.6, 5);
    expect(lrMultiplier(schedule, 9)).toBeCloseTo(1, 5);
    const atStart = lrMultiplier(schedule, 10);
    const mid = lrMultiplier(schedule, 60);
    const end = lrMultiplier(schedule, 110);
    expect(atStart).toBeCloseTo(1, 5);
    expect(mid).toBeLessThan(atStart);
    expect(mid).toBeGreaterThan(end);
    expect(end).toBeCloseTo(0.1, 5);
  });

  it("applies the schedule to the optimizer during real training", () => {
    const cfg = tinyConfig();
    const tok = Tokenizer.build(["hello world hello world"]);
    cfg.vocabSize = tok.size;
    const session = new TrainingSession(new Transformer(cfg, 3), tok, 0.01);
    session.setData(buildTrainingData(["hello world hello world"], tok, cfg.blockSize));
    session.configureSchedule({ type: "cosine", warmupSteps: 5, totalSteps: 60, minLrRatio: 0.1 });
    for (let i = 0; i < 5; i++) session.trainBatch(1, 1); // finish warmup
    const lrAfterWarmup = session.optimizer.learningRate;
    for (let i = 0; i < 40; i++) session.trainBatch(1, 1);
    expect(session.optimizer.learningRate).toBeLessThan(lrAfterWarmup);
    expect(session.optimizer.learningRate).toBeGreaterThan(0);
  });
});

describe("Checkpoints", () => {
  it("save/load preserves all weights, config and vocabulary", () => {
    const cfg = tinyConfig();
    const tok = Tokenizer.build(["abcdefghijkl"]);
    cfg.vocabSize = tok.size;
    const model = new Transformer(cfg, 99);
    const session = new TrainingSession(model, tok, 0.001);
    const data = buildTrainingData(["abcdefghijklabcdefghijkl"], tok, cfg.blockSize);
    session.setData(data);
    session.trainBatch(2, 1);
    const snapshot = createSnapshot(model, tok);
    const restored = loadSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(restored.tokenizer.vocab).toEqual(tok.vocab);
    expect(restored.model.config).toEqual(model.config);
    for (const [name, t] of model.weights) {
      expect(Array.from(restored.model.weights.get(name)!.data)).toEqual(Array.from(t.data));
    }
    const session2 = sessionFromSnapshot(snapshot, 0.001);
    const before = Array.from(session2.model.weights.get("wOut")!.data);
    session2.setData(data);
    session2.trainBatch(2, 1);
    const after = Array.from(session2.model.weights.get("wOut")!.data);
    expect(after.some((v, i) => Math.abs(v - before[i]) > 1e-8)).toBe(true);
  });

  it("continues from the exact step and Adam state after a reload", () => {
    const cfg = tinyConfig();
    const tok = Tokenizer.build(["abcdefghijklmnop"]);
    cfg.vocabSize = tok.size;
    const data = buildTrainingData(["abcdefghijklmnop".repeat(3)], tok, cfg.blockSize);
    const session = new TrainingSession(new Transformer(cfg, 7), tok, 0.01);
    session.setData(data);
    for (let i = 0; i < 3; i++) session.trainBatch(2, 1);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as ModelSnapshot;
    expect(snapshot.step).toBe(3);
    expect(snapshot.optimizer?.t).toBe(3);

    const restored = sessionFromSnapshot(snapshot, 0.01);
    expect(restored.step).toBe(3);
    expect(restored.optimizer.t).toBe(3);
    restored.setData(data);
    expect(Number.isFinite(restored.trainBatch(2, 1))).toBe(true);
    expect(restored.step).toBe(4);
  });

  it("rejects malformed snapshots", () => {
    expect(() => loadSnapshot({ version: 9 } as never)).toThrow();
    expect(() => loadSnapshot({ version: 1, config: {}, vocab: [], weights: {} } as never)).toThrow();
  });
});

describe("Training data", () => {
  it("builds real windows with shifted targets", () => {
    const tok = Tokenizer.build(["abcdef"]);
    const data = buildTrainingData(["abcdefgh"], tok, 4);
    expect(data.inputs.length).toBeGreaterThan(0);
    expect(data.totalTokens).toBe(9);
    expect(countCorpusTokens(["abcdefgh"], tok)).toBe(9);
    expect(countWindows(9, 4)).toBe(data.samples);
    for (let i = 0; i < data.inputs.length; i++) {
      expect(data.inputs[i].length).toBe(4);
      expect(data.targets[i].length).toBe(4);
      for (let t = 0; t < 3; t++) expect(data.targets[i][t]).toBe(data.inputs[i][t + 1]);
    }
  });

  it("separates documents with EOS, not padding", () => {
    const tok = Tokenizer.build(["abcdefgh"]);
    const data = buildTrainingData(["abcdefgh", "ijklmnop"], tok, 12);
    const stream = Array.from(data.inputs[0]);
    expect(stream).toContain(tok.eosId);
    expect(stream).not.toContain(tok.padId);
  });

  it("counts combined corpora with the exact engine window formula", () => {
    const tok = Tokenizer.build(["hello", "world"]);
    const texts = ["hello world", "another line"];
    const tokens = countCorpusTokens(texts, tok);
    const data = buildTrainingData(texts, tok, 8);
    expect(tokens).toBe(data.totalTokens);
    expect(countWindows(tokens, 8)).toBe(data.samples);
  });
});

describe("Real feedback training", () => {
  it("changes actual weights and measures held-out validation loss without stepping", () => {
    const train = "the quick brown fox jumps over the lazy dog again and again";
    const validation = "a held out sentence with different words for validation only";
    const tokenizer = Tokenizer.build([train, validation]);
    const cfg = tinyConfig({ vocabSize: tokenizer.size, blockSize: 4 });
    const session = new TrainingSession(new Transformer(cfg, 11), tokenizer, 0.05, 3);
    session.setData(buildTrainingData([train], tokenizer, cfg.blockSize));
    session.setValidationData(buildTrainingData([validation], tokenizer, cfg.blockSize));

    const before = createSnapshot(session.model, session.tokenizer, session.step, session.optimizer);
    const stepBefore = session.step;
    const trainLoss = session.trainBatch(2, 1);
    const validationLoss = session.validationLoss(2);
    const after = createSnapshot(session.model, session.tokenizer, session.step, session.optimizer);

    expect(session.step).toBe(stepBefore + 1);
    expect(before.weights.tokEmb).not.toBe(after.weights.tokEmb);
    expect(Number.isFinite(trainLoss)).toBe(true);
    expect(validationLoss).not.toBeNull();
    expect(Number.isFinite(validationLoss!)).toBe(true);
    expect(session.step).toBe(stepBefore + 1); // validation itself never trains
  });

  it("scores answers with the trained network so grounded ranking can use real weights", () => {
    const corpus = "User: code?\nDavidAI: zebra\n".repeat(60);
    const tokenizer = Tokenizer.build([corpus]);
    const cfg = tinyConfig({ vocabSize: tokenizer.size, blockSize: 8 });
    const session = new TrainingSession(new Transformer(cfg, 7), tokenizer, 0.08, 5);
    session.setData(buildTrainingData([corpus], tokenizer, cfg.blockSize));
    for (let i = 0; i < 80; i++) session.trainBatch(4, 1);

    const prompt = "DavidAI is a local neural assistant.\nUser: code?\nDavidAI:";
    const learned = scoreAnswer(session.model, tokenizer, prompt, "zebra");
    const unknown = scoreAnswer(session.model, tokenizer, prompt, "qqqqq");
    expect(Number.isFinite(learned)).toBe(true);
    expect(Number.isFinite(unknown)).toBe(true);
    expect(learned).toBeGreaterThan(unknown);
  });
});

describe("Checkpoint validation", () => {
  it("rejects incompatible or malformed snapshots before storage", () => {
    const tok = Tokenizer.build(["abcdefghijkl"]);
    const cfg = tinyConfig();
    cfg.vocabSize = tok.size;
    const snapshot = createSnapshot(new Transformer(cfg, 4), tok);
    expect(validateSnapshot(snapshot)).toBeNull();

    const badConfig = JSON.parse(JSON.stringify(snapshot)) as ModelSnapshot;
    badConfig.config.blockSize = 0;
    expect(validateSnapshot(badConfig)).toContain("Incompatible checkpoint");

    const badWeight = JSON.parse(JSON.stringify(snapshot)) as ModelSnapshot;
    badWeight.weights.unexpected = btoa("\u0000\u0000\u0000\u0000");
    expect(validateSnapshot(badWeight)).toContain("unexpected weight");

    const badBase64 = JSON.parse(JSON.stringify(snapshot)) as ModelSnapshot;
    badBase64.weights.tokEmb = "%%%";
    expect(validateSnapshot(badBase64)).toContain("malformed weight data");
  });
});
