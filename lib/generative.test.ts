import { describe, it, expect } from "vitest";
import { Tokenizer } from "@/engine/tokenizer";
import { createSnapshot, loadSnapshot } from "@/engine/serialization";
import { buildTrainingData, TrainingSession } from "@/engine/session";
import { Transformer } from "@/engine/transformer";
import { buildWordCorpus, wordPrompt } from "./word-corpus";
import { rankRetrievalCandidates } from "./learning";
import { selectSandboxAlternatives } from "./experimental";
import { TraceRecorder } from "./trace";
import type { Correction, Dataset, DictionaryWord, KnowledgeEntry, Memory } from "./types";

function dataset(text: string): Dataset {
  return {
    id: "d1", name: "Local notes", description: "", content: text, category: "test",
    hash: "h", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function word(value: string, definition: string): DictionaryWord {
  return {
    id: `w-${value}`, word: value, definition, partOfSpeech: "noun", example: `A ${value} example.`,
    related: [], useCount: 0, source: "bundled", reviewStatus: "approved",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function correction(status: Correction["status"], answer: string): Correction {
  return {
    id: `c-${status}`, feedbackId: "f1", conversationId: "conv1", question: "What does enormous mean",
    originalAnswer: "small", correctedAnswer: answer, explanation: "", status,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("word-level language model", () => {
  it("encodes whole words and restores tokenizer mode from a checkpoint", () => {
    const tokenizer = Tokenizer.buildWords(["enormous means very large", "tiny means very small"]);
    expect(tokenizer.mode).toBe("word");
    const encoded = tokenizer.encode("Enormous MEANS very large!");
    expect(Array.from(encoded)).toEqual([
      tokenizer.charToId.get("enormous"), tokenizer.charToId.get("means"),
      tokenizer.charToId.get("very"), tokenizer.charToId.get("large"),
    ]);
    expect(tokenizer.decode(encoded)).toBe("enormous means very large");
    const legacy = Tokenizer.build(["hello"]);
    expect(legacy.mode).toBe("char");
    const wordSnapshot = createSnapshot(new Transformer({ layers: 1, heads: 2, dModel: 8, blockSize: 4, dFF: 16, vocabSize: tokenizer.size }, 1), tokenizer, 3);
    expect(wordSnapshot.tokenizerMode).toBe("word");
    expect(loadSnapshot(wordSnapshot).tokenizer.mode).toBe("word");
    const legacySnapshot = createSnapshot(new Transformer({ layers: 1, heads: 2, dModel: 8, blockSize: 4, dFF: 16, vocabSize: legacy.size }, 1), legacy, 3);
    expect(loadSnapshot(legacySnapshot).tokenizer.mode).toBe("char");
  });

  it("turns local knowledge into training examples, not runtime answer rules", () => {
    const corpus = buildWordCorpus({
      datasets: [dataset("DavidAI is a local research assistant. DavidAI trains on local datasets. DavidAI keeps data in this browser. DavidAI uses real gradient descent. DavidAI answers from learned weights. DavidAI never calls an external API. DavidAI repeats these facts often.")],
      knowledge: [{ id: "k1", title: "Local AI", category: "General", content: "Local AI runs on this device.", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] as KnowledgeEntry[],
      dictionary: [word("enormous", "very large")],
      memories: [{ id: "m1", content: "Vocabulary: tiny means very small", kind: "vocabulary", conversationId: null, source: "user", hash: "mh", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", recallCount: 0 }] as Memory[],
      corrections: [correction("approved", "very big"), correction("pending", "not learned yet")],
    });
    const joined = corpus.texts.join("\n");
    expect(joined).toContain("What does enormous mean");
    expect(joined).toContain("enormous is very large");
    expect(joined).toContain("Context: enormous: very large");
    expect(joined).toContain("Context: very big");
    expect(joined).toContain("very big");
    expect(joined).not.toContain("not learned yet");
    expect(corpus.config.layers).toBe(2);
    expect(corpus.config.vocabSize).toBe(corpus.tokenizer.size);
    expect(wordPrompt("What does enormous mean", ["enormous: very large"])).toContain("Context: enormous: very large");
  });

  it("trains real word parameters and generates readable word tokens", () => {
    const corpus = buildWordCorpus({
      datasets: [dataset("DavidAI is a local research assistant. DavidAI trains on local datasets. DavidAI keeps data in this browser. DavidAI uses real gradient descent. DavidAI answers from learned weights. DavidAI never calls an external API. DavidAI repeats these facts often.")],
      knowledge: [], dictionary: [], memories: [], corrections: [],
    });
    const config = { ...corpus.config, layers: 1, heads: 2, dModel: 16, blockSize: 12, dFF: 32 };
    const session = new TrainingSession(new Transformer(config, 7), corpus.tokenizer, 0.03, 11);
    session.setData(buildTrainingData(corpus.texts, corpus.tokenizer, config.blockSize));
    const firstLoss = session.trainBatch(2, 1);
    for (let i = 0; i < 24; i++) session.trainBatch(2, 1);
    expect(session.step).toBe(25);
    expect(session.lossHistory.length).toBe(25);
    expect(Number.isFinite(firstLoss)).toBe(true);
    const generated = session.generate(wordPrompt("What is DavidAI", ["DavidAI is a local research assistant"]), {
      maxTokens: 8, temperature: 0.2, topK: 4, seed: 42, stopOnEos: true,
    });
    expect(generated.length).toBeGreaterThan(0);
    for (const token of generated.toLowerCase().match(/[a-z0-9']+/g) ?? []) {
      expect(corpus.tokenizer.charToId.has(token)).toBe(true);
    }
  });
});

describe("retrieval ranking", () => {
  it("ranks an approved correction above a dictionary definition even when the word model likes the definition text", () => {
    const ranked = rankRetrievalCandidates({
      candidates: [
        { text: "mean means Mean or intend to express or convey.", source: "Dictionary · mean", priority: 1, score: 0 },
        { text: "Enormous means very large.", source: "Approved correction", priority: 4, score: 2 },
      ],
      modelScore: (text) => (text.startsWith("mean") ? -1 : -8),
    });
    expect(ranked[0].source).toBe("Approved correction");
    expect(ranked[0].finalScore).toBeGreaterThan(ranked[1].finalScore);
  });

  it("ranks by question coverage when no character model is available", () => {
    const ranked = rankRetrievalCandidates({
      query: "What is a moose?",
      candidates: [
        { text: "average means Amount to or come to an average.", source: "Dictionary · average", priority: 1, score: 0, coverage: 0 },
        { text: "Moose are large mammals.", source: "Knowledge · animals", priority: 1, score: 0, coverage: 1 },
      ],
      useModelScore: false,
    });
    expect(ranked[0].source).toBe("Knowledge · animals");
    expect(Number.isFinite(ranked[0].finalScore)).toBe(true);
  });
});

describe("sandbox risk contract", () => {
  const choices = ["Hypothesis (unverified): A", "Possibility (untested): B", "Model hypothesis (unverified): C"];

  it("shows one answer at low risk, two alternatives at medium, and all plus recombination at high", () => {
    expect(selectSandboxAlternatives({ risk: "low", alternatives: choices, evidence: ["enormous: very large"] })).toEqual([]);
    expect(selectSandboxAlternatives({ risk: "medium", alternatives: choices, evidence: ["enormous: very large"] }))
      .toEqual(choices.slice(0, 2));
    const high = selectSandboxAlternatives({ risk: "high", alternatives: choices, evidence: ["enormous: very large", "tiny: very small"] });
    expect(high.slice(0, 3)).toEqual(choices);
    expect(high).toHaveLength(4);
    expect(high[3]).toContain("Combined simulation (unverified)");
    expect(high[3]).toContain("enormous: very large");
  });
});

describe("real activity trace", () => {
  it("records actual stage outcomes, timing and status without inventing stages", () => {
    const updates: string[] = [];
    const trace = new TraceRecorder("test run", "grounded", (run) => updates.push(run.status));
    const value = trace.runStage("Search dictionary", "Looked up one word", ["Dictionary"], () => ({
      value: "very large", retrieved: ["enormous: very large"], note: "one match",
    }));
    expect(value).toBe("very large");
    trace.skip("Search datasets", "No dataset matched", "nothing found");
    const run = trace.finish("done", {
      concepts: ["enormous"], approaches: [{ name: "Dictionary", selected: true, reason: "matched" }],
      selected: "Dictionary", uncertainties: [], construction: "Used the retrieved definition.",
    });
    expect(run.stages.map((s) => s.name)).toEqual(["Search dictionary", "Search datasets"]);
    expect(run.stages[0].status).toBe("success");
    expect(run.stages[0].retrieved).toEqual(["enormous: very large"]);
    expect(run.stages[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(run.stages[0].startedAt).getTime()).toBeGreaterThan(0);
    expect(run.stages[1].status).toBe("skipped");
    expect(run.status).toBe("complete");
    expect(run.reasoning?.selected).toBe("Dictionary");
    expect(updates[0]).toBe("running");
    expect(updates[updates.length - 1]).toBe("complete");
  });
});
