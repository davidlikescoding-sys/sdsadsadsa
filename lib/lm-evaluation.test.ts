import { describe, expect, it } from "vitest";
import { LM_EVAL_CASES, runLmEvaluation } from "./lm-evaluation";
import { Tokenizer } from "@/engine/tokenizer";
import { Transformer } from "@/engine/transformer";
import { TrainingSession } from "@/engine/session";

describe("language-model evaluation", () => {
  it("has well-formed, independent test cases", () => {
    expect(LM_EVAL_CASES.length).toBeGreaterThanOrEqual(10);
    const ids = new Set<string>();
    for (const testCase of LM_EVAL_CASES) {
      expect(ids.has(testCase.id)).toBe(false);
      ids.add(testCase.id);
      expect(testCase.choices.length).toBeGreaterThanOrEqual(2);
      expect(testCase.correct).toBeGreaterThanOrEqual(0);
      expect(testCase.correct).toBeLessThan(testCase.choices.length);
      expect(new Set(testCase.choices).size).toBe(testCase.choices.length);
    }
    // At least four independent categories must be represented.
    expect(new Set(LM_EVAL_CASES.map((c) => c.category)).size).toBeGreaterThanOrEqual(4);
  });

  it("reports honestly when no model is loaded", () => {
    const report = runLmEvaluation(null, 0);
    expect(report.modelReady).toBe(false);
    expect(report.correct).toBe(0);
    expect(report.total).toBe(LM_EVAL_CASES.length);
    expect(report.results.every((r) => r.chosen === -1)).toBe(true);
  });

  it("scores choices with the real model's forward pass", () => {
    const texts = LM_EVAL_CASES.flatMap((c) => [c.prompt, ...c.choices]);
    const tokenizer = Tokenizer.buildWords(texts, 512);
    const cfg = { layers: 1, heads: 2, dModel: 16, dFF: 32, blockSize: 32, vocabSize: tokenizer.size };
    const session = new TrainingSession(new Transformer(cfg, 42), tokenizer, 0.01);
    const report = runLmEvaluation(session, 7);
    expect(report.modelReady).toBe(true);
    expect(report.step).toBe(7);
    expect(report.results.every((r) => r.scores.length === LM_EVAL_CASES.find((c) => c.id === r.id)!.choices.length)).toBe(true);
    expect(report.results.every((r) => r.scores.every((s) => Number.isFinite(s)))).toBe(true);
  });
});
