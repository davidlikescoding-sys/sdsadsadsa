/**
 * Headless word-model trainer. Reuses the exact production engine and corpus
 * builder so the exported checkpoint is byte-compatible with the browser's
 * `davidai:wordModel` snapshot. Run through scripts/run-trainer.mjs (esbuild).
 *
 * All data is local. No network calls, no paid APIs.
 */
import fs from "node:fs";
import path from "node:path";
import { buildWordCorpus } from "../src/lib/word-corpus";
import { Tokenizer } from "../src/engine/tokenizer";
import { Transformer, type ModelConfig } from "../src/engine/transformer";
import { buildTrainingData, TrainingSession, countWindows, sessionFromSnapshot } from "../src/engine/session";
import { createSnapshot, loadSnapshot, type ModelSnapshot } from "../src/engine/serialization";
import type {
  Dataset, KnowledgeEntry, DictionaryWord, Memory, Correction,
} from "../src/lib/types";

interface CliArgs {
  data: string;
  out: string;
  steps: number;
  batch: number;
  lr: number;
  weightDecay: number;
  valFrac: number;
  resume?: string;
  extendVocab: boolean;
  seed: number;
  saveEvery: number;
  maxVocab: number;
  stage: string;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (name: string, fallback: number): number => {
    const raw = get(name);
    if (raw === undefined) return fallback;
    const v = Number(raw);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    data: get("data") ?? "scripts/exported-data.json",
    out: get("out") ?? "scripts/word-model-checkpoint.json",
    steps: Math.max(1, Math.floor(num("steps", 3000))),
    batch: Math.max(1, Math.floor(num("batch", 1))),
    lr: Math.min(0.2, Math.max(0.0001, num("lr", 0.03))),
    weightDecay: Math.max(0, Math.min(0.1, num("weightDecay", 0.01))),
    valFrac: Math.min(0.4, Math.max(0.05, num("valFrac", 0.1))),
    resume: get("resume"),
    extendVocab: argv.includes("--extend-vocab"),
    seed: Math.floor(num("seed", 1337)),
    saveEvery: Math.max(1, Math.floor(num("saveEvery", 500))),
    maxVocab: Math.max(512, Math.floor(num("maxVocab", 2000))),
    stage: (get("stage") ?? "all").toLowerCase(),
  };
}

/** Wrap a snapshot in the exact format accepted by Checkpoints → import. */
function wrapCheckpoint(snapshot: ModelSnapshot, loss: number | null = null): string {
  const weights = Object.values(snapshot.weights).reduce((n, v) => n + Math.floor(v.length * 3 / 4), 0);
  return JSON.stringify({
    app: "DavidAI-checkpoint",
    version: 1,
    meta: {
      name: `Trained word model — step ${snapshot.step} — ${snapshot.savedAt}`,
      config: snapshot.config,
      vocabSize: snapshot.vocab.length,
      trainingSteps: snapshot.step,
      sizeBytes: weights,
      datasetNames: ["Headless trainer"],
      loss,
      createdAt: snapshot.savedAt,
    },
    snapshot,
  });
}

/** Accept both wrapped checkpoint exports and bare snapshots for --resume. */
function unwrapCheckpoint(json: string): ModelSnapshot {
  const parsed = JSON.parse(json) as { snapshot?: ModelSnapshot } & ModelSnapshot;
  return (parsed.snapshot ?? parsed) as ModelSnapshot;
}

/**
 * Continue an existing checkpoint while adopting a new corpus vocabulary.
 * Shared tokens keep their learned embeddings; genuinely new tokens get small
 * deterministic embeddings so a short fine-tune can teach them.
 */
function resumeWithExpandedVocab(
  snapshot: ModelSnapshot,
  tokenizer: Tokenizer,
  config: ModelConfig,
  learningRate: number,
  seed: number,
): TrainingSession {
  const { model: oldModel, tokenizer: oldTokenizer } = loadSnapshot(snapshot);
  for (const key of ["layers", "heads", "dModel", "blockSize", "dFF"] as const) {
    if (oldModel.config[key] !== config[key]) {
      throw new Error(`Cannot expand vocabulary across different architecture (${key} changed). Reinitialize the model instead.`);
    }
  }

  const model = new Transformer(config, seedFromSeed(seed, "expand-vocab"));
  for (const [name, oldTensor] of oldModel.weights) {
    const next = model.weights.get(name);
    if (!next) throw new Error(`Expanded model is missing weight "${name}".`);
    if (next.data.length === oldTensor.data.length) next.data.set(oldTensor.data);
  }

  const oldEmb = oldModel.weights.get("tokEmb")!;
  const oldOut = oldModel.weights.get("wOut")!;
  const newEmb = model.weights.get("tokEmb")!;
  const newOut = model.weights.get("wOut")!;
  const oldV = oldTokenizer.size;
  const newV = tokenizer.size;
  const channels = config.dModel;
  if (newEmb.data.length !== newV * channels || newOut.data.length !== channels * newV) {
    throw new Error("Checkpoint vocabulary expansion produced an invalid weight shape.");
  }

  const oldIdByToken = new Map(oldTokenizer.vocab.map((token, id) => [token, id]));
  const rng = mulberry32(seedFromSeed(seed, "new-token-embeddings"));
  for (let newId = 0; newId < newV; newId++) {
    const oldId = oldIdByToken.get(tokenizer.vocab[newId]);
    if (oldId === undefined) {
      for (let c = 0; c < channels; c++) {
        newEmb.data[newId * channels + c] = (rng() * 2 - 1) * 0.02;
        newOut.data[c * newV + newId] = (rng() * 2 - 1) * 0.02;
      }
      continue;
    }
    for (let c = 0; c < channels; c++) {
      newEmb.data[newId * channels + c] = oldEmb.data[oldId * channels + c];
      newOut.data[c * newV + newId] = oldOut.data[c * oldV + oldId];
    }
  }

  const session = new TrainingSession(model, tokenizer, learningRate, seed ^ 0x5bf03635);
  session.step = Number.isFinite(snapshot.step) ? Math.max(0, Math.floor(snapshot.step ?? 0)) : 0;
  console.log(`expanded vocabulary ${oldV} -> ${newV} tokens; kept step ${session.step}`);
  return session;
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

interface ExportData {
  app?: string;
  data?: Record<string, unknown>;
}

function arr<T>(data: Record<string, unknown>, key: string): T[] {
  const value = data[key];
  return Array.isArray(value) ? value as T[] : [];
}

/** Load bundled WordNet words (the browser loads these lazily from public/data). */
function loadBundledDictionary(root: string): DictionaryWord[] {
  const file = path.join(root, "public", "data", "english-dictionary.json");
  if (!fs.existsSync(file)) return [];
  try {
    // The bundled file uses the compact schema { w, p, d, s, r, x, t },
    // identical to dictionary.ts's BulkEntry -> bulkToWord mapping.
    interface BulkEntry { w: string; p: string; d: string; s?: string[]; r?: string[]; x?: string; t?: string[] }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { entries?: BulkEntry[] };
    const now = new Date().toISOString();
    const validPos = new Set(["noun", "verb", "adjective", "adverb", "pronoun", "article", "preposition", "conjunction", "other"]);
    return (parsed.entries ?? []).map((e, i) => ({
      id: `bulk-${e.w}-${e.p}-${i}`,
      word: String(e.w ?? ""),
      definition: String(e.d ?? ""),
      partOfSpeech: (validPos.has(e.p) ? e.p : "other") as DictionaryWord["partOfSpeech"],
      example: String(e.x ?? ""),
      related: Array.isArray(e.r) ? e.r.map(String) : [],
      synonyms: Array.isArray(e.s) ? e.s.map(String) : [],
      topics: Array.isArray(e.t) ? e.t.map(String) : [],
      source: "bundled",
      reviewStatus: "approved" as const,
      createdAt: now,
      updatedAt: now,
      useCount: 0,
    })).filter((w) => w.word && w.definition);
  } catch {
    return [];
  }
}

/** Deterministic document-level split — no window overlap between train and test. */
function splitTexts(texts: string[], valFrac: number, seed: number): { train: string[]; validation: string[]; test: string[] } {
  const clean = Array.from(new Set(texts.filter((t) => t.trim().length > 0)));
  const order = clean.map((text, i) => ({ text, i }));
  const rng = mulberry32(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const nVal = Math.max(1, Math.floor(order.length * valFrac));
  const nTest = Math.max(1, Math.floor(order.length * valFrac));
  return {
    train: order.slice(0, Math.max(1, order.length - nVal - nTest)).map((x) => x.text),
    validation: order.slice(order.length - nVal - nTest, order.length - nTest).map((x) => x.text),
    test: order.slice(order.length - nTest).map((x) => x.text),
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const exportPath = path.resolve(root, args.data);
  if (!fs.existsSync(exportPath)) {
    throw new Error(`Export file not found: ${exportPath}. Export DavidAI data from Settings first.`);
  }
  const parsed = JSON.parse(fs.readFileSync(exportPath, "utf8")) as ExportData;
  if (parsed.app !== "DavidAI" || !parsed.data) {
    throw new Error("This is not a DavidAI export file.");
  }
  const d = parsed.data;
  const datasets = arr<Dataset>(d, "datasets");
  const knowledge = arr<KnowledgeEntry>(d, "knowledge");
  const userDictionary = arr<DictionaryWord>(d, "dictionary");
  const memories = arr<Memory>(d, "memories");
  const corrections = arr<Correction>(d, "corrections");
  const dictionary = [...loadBundledDictionary(root), ...userDictionary];

  const corpus = buildWordCorpus({ datasets, knowledge, dictionary, memories, corrections, maxVocab: args.maxVocab });

  // Category distribution (Phase 2 statistics). The tokenizer is always built
  // from the FULL corpus, so a stage change never invalidates the vocabulary.
  const distribution: Record<string, number> = {};
  for (const source of corpus.sources) distribution[source] = (distribution[source] ?? 0) + 1;

  const STAGE_SOURCES: Record<string, string[]> = {
    all: [...new Set(corpus.sources)],
    // Stage A: raw language structure and word meanings.
    language: ["datasets", "dictionary"],
    // Stage B: factual/educational material.
    knowledge: ["datasets", "knowledge", "dictionary", "memories"],
    // Stages C/D: instructions, Q&A and dialogue.
    instruction: ["instruction", "conversation", "corrections", "knowledge"],
    conversation: ["conversation", "corrections", "memories"],
    // Stage E: verified reasoning lessons and mathematical material.
    reasoning: ["knowledge", "instruction", "corrections"],
  };
  const sources = STAGE_SOURCES[args.stage];
  if (!sources) throw new Error(`Unknown stage "${args.stage}". Choose: ${Object.keys(STAGE_SOURCES).join(", ")}.`);
  const stageTexts = corpus.texts.filter((_, i) => sources.includes(corpus.sources[i]));

  const splits = splitTexts(stageTexts, args.valFrac, args.seed);

  const tokenCount = stageTexts.reduce((n, t) => n + corpus.tokenizer.encode(t).length + 1, 0);
  const windows = countWindows(tokenCount, corpus.config.blockSize);
  const unique = new Set(stageTexts.map((t) => t.trim().toLowerCase().replace(/\s+/g, " "))).size;
  console.log("=== DATASET STATISTICS ===");
  console.log(`stage:           ${args.stage}`);
  console.log(`categories:      ${Object.entries(distribution).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`examples:        ${stageTexts.length} / ${corpus.texts.length} total`);
  console.log(`unique examples: ${unique} (${((1 - unique / Math.max(1, stageTexts.length)) * 100).toFixed(1)}% duplicates)`);
  console.log(`vocabulary:      ${corpus.words}`);
  console.log(`tokens:          ${tokenCount}`);
  console.log(`avg seq length:  ${(tokenCount / Math.max(1, stageTexts.length)).toFixed(1)} tokens`);
  console.log(`windows:         ${windows}`);
  console.log(`train/val/test:  ${splits.train.length}/${splits.validation.length}/${splits.test.length} documents`);

  const seed = args.seed;
  let session: TrainingSession;
  if (args.resume) {
    const snapshot = unwrapCheckpoint(fs.readFileSync(path.resolve(root, args.resume), "utf8"));
    if (args.extendVocab) {
      session = resumeWithExpandedVocab(snapshot, corpus.tokenizer, corpus.config, args.lr, seed);
    } else {
      // Restore weights AND Adam moments so resuming is mathematically exact.
      session = sessionFromSnapshot(snapshot, args.lr, seed ^ 0x5bf03635);
      console.log(`resumed from step ${session.step} with optimizer state t=${session.optimizer.t}`);
    }
  } else {
    const model = new Transformer(corpus.config, seedFromSeed(seed, "wordlm", corpus.words));
    session = new TrainingSession(model, corpus.tokenizer, args.lr, seed ^ 0x9e3779b9);
  }
  session.setWeightDecay(args.weightDecay);
  session.setData(buildTrainingData(splits.train, session.tokenizer, session.model.config.blockSize));
  session.setValidationData(buildTrainingData(splits.validation, session.tokenizer, session.model.config.blockSize));
  const testData = buildTrainingData(splits.test, session.tokenizer, session.model.config.blockSize);

  session.configureSchedule({
    type: "cosine",
    warmupSteps: Math.min(50, Math.max(1, Math.floor(args.steps * 0.03))),
    totalSteps: session.step + args.steps,
    minLrRatio: 0.1,
  });

  console.log("\n=== TRAINING ===");
  console.log(`params: ${session.model.parameters().reduce((n, p) => n + p.data.length, 0).toLocaleString()}`);
  console.log(`steps: ${args.steps} · batch ${args.batch} · lr ${args.lr} · wd ${args.weightDecay}`);

  const outPath = path.resolve(root, args.out);
  const resumePath = `${outPath}.resume.json`;
  const start = session.step;
  let bestVal = Infinity;
  let bestStep = start;
  let worstGrad = 0;
  const t0 = Date.now();

  const measureVal = (): number => {
    let total = 0;
    const n = Math.min(64, testData.samples);
    for (let i = 0; i < n; i++) {
      const { loss } = session.model.forward(testData.inputs[i], testData.targets[i]);
      if (!loss || !Number.isFinite(loss.data[0])) return Infinity;
      total += loss.data[0];
    }
    return total / n;
  };

  for (let i = 0; i < args.steps; i++) {
    const loss = session.trainBatch(args.batch, 1);
    const step = session.step;
    if (!Number.isFinite(session.lastGradNorm)) throw new Error("Non-finite gradient norm — stopping the failing run.");
    worstGrad = Math.max(worstGrad, session.lastGradNorm);
    if (step % 100 === 0 || i === args.steps - 1) {
      const val = session.validationLoss(32) ?? Infinity;
      const ppl = Number.isFinite(loss) ? Math.exp(Math.min(20, loss)) : Infinity;
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const rate = ((step - start) / ((Date.now() - t0) / 1000)).toFixed(2);
      const gap = Number.isFinite(val) ? (val - loss).toFixed(4) : "n/a";
      console.log(`step ${step}/${start + args.steps} | train ${loss.toFixed(4)} (ppl ${ppl.toFixed(2)}) | val ${Number.isFinite(val) ? val.toFixed(4) : "n/a"} | gap ${gap} | grad ${session.lastGradNorm.toFixed(3)} | lr ${session.optimizer.learningRate.toFixed(5)} | ${rate} steps/s | ${elapsed}s`);
      // Never keep a worse model: stream the best validation checkpoint to disk.
      if (Number.isFinite(val) && val < bestVal) {
        bestVal = val;
        bestStep = step;
        const best = createSnapshot(session.model, session.tokenizer, step, session.optimizer);
        best.savedAt = new Date().toISOString();
        fs.writeFileSync(outPath, wrapCheckpoint(best, val));
      }
    }
    if (step % args.saveEvery === 0) {
      // Full optimizer state so an interrupted run resumes exactly.
      fs.writeFileSync(resumePath, wrapCheckpoint(session.snapshot()));
    }
  }

  // Reload the best model for honest, unseen test evaluation.
  if (fs.existsSync(outPath)) {
    const best = sessionFromSnapshot(unwrapCheckpoint(fs.readFileSync(outPath, "utf8")), args.lr, seed);
    session.model = best.model;
    session.tokenizer = best.tokenizer;
    session.optimizer = best.optimizer;
  }
  const testLoss = measureVal();
  console.log("\n=== FINAL (unseen test documents, best checkpoint) ===");
  console.log(`test loss:      ${Number.isFinite(testLoss) ? testLoss.toFixed(4) : "n/a"}`);
  console.log(`test perplexity:${Number.isFinite(testLoss) ? Math.exp(Math.min(20, testLoss)).toFixed(2) : "n/a"}`);
  console.log(`best val loss:  ${Number.isFinite(bestVal) ? bestVal.toFixed(4) : "n/a"} (step ${bestStep})`);
  console.log(`max grad norm:  ${worstGrad.toFixed(3)} (clipped to 1.0)`);
  console.log(`\nSaved best checkpoint (step ${bestStep}) to ${outPath}`);
}

function seedFromSeed(seed: number, ...parts: (string | number)[]): number {
  let h = seed >>> 0;
  for (const part of parts) {
    for (const ch of String(part)) {
      h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    }
  }
  return h;
}

main();
